// Best-effort OCR using Tesseract.js (free, runs in the browser).
// Heads-up (also in the README): browser OCR is weaker than the native
// iPhone Vision framework, especially on glowing dashboard digits. It
// only ever produces tap-to-confirm suggestions — you always verify the
// number before saving, and blank means "type it yourself".
window.OCR = (() => {
  let workerPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load OCR library (offline?)"));
      document.head.appendChild(s);
    });
  }

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        if (!window.Tesseract) {
          await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
        }
        return await Tesseract.createWorker("eng");
      })();
    }
    return workerPromise;
  }

  async function recognize(blob, digitsOnly) {
    const worker = await getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: digitsOnly ? "0123456789." : "",
    });
    const { data } = await worker.recognize(blob);
    return data;
  }

  // Candidate odometer/tripometer readings, best first.
  async function mileageCandidates(blob) {
    try {
      const data = await recognize(blob, true);
      const found = [];
      const words = [];
      (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(w => words.push(w)))));
      if (!words.length && data.text) {
        data.text.split(/\s+/).forEach(t => words.push({ text: t, confidence: data.confidence || 50 }));
      }
      for (const w of words) {
        const matches = (w.text || "").match(/\d{1,6}(\.\d)?/g) || [];
        for (const m of matches) {
          const value = parseFloat(m);
          if (value > 0 && value < 1000000) {
            found.push({ text: m, value, confidence: w.confidence || 0 });
          }
        }
      }
      found.sort((a, b) => (b.text.replace(".", "").length + b.confidence / 40) - (a.text.replace(".", "").length + a.confidence / 40));
      const seen = new Set();
      return found.filter(c => !seen.has(c.text) && seen.add(c.text)).slice(0, 5);
    } catch (e) {
      console.warn("OCR failed", e);
      return [];
    }
  }

  // Best-effort receipt parse: total $, gallons, price/gal candidates.
  async function receiptCandidates(blob) {
    const result = { totals: [], gallons: [], prices: [] };
    try {
      const data = await recognize(blob, false);
      const lines = (data.text || "").split("\n");
      for (const line of lines) {
        const upper = line.toUpperCase();
        const nums = (line.replace(/\$/g, " ").match(/\d{1,4}[.,]\d{1,3}/g) || [])
          .map(t => parseFloat(t.replace(",", ".")))
          .filter(v => !isNaN(v));
        if (!nums.length) continue;
        const isGal = upper.includes("GAL");
        const isPrice = upper.includes("/GAL") || upper.includes("PRICE") || upper.includes("PER GAL");
        const isTotal = upper.includes("TOTAL") || upper.includes("AMOUNT") || upper.includes("SALE") || line.includes("$");
        for (const v of nums) {
          const c = { text: v.toFixed(v * 100 % 1 ? 3 : 2), value: v };
          if (isPrice && v > 1 && v < 10) result.prices.push(c);
          else if (isGal && v > 0 && v < 60) result.gallons.push(c);
          else if (isTotal && v > 1 && v < 500) result.totals.push(c);
        }
      }
      if (!result.totals.length) {
        for (const line of lines) {
          const nums = (line.match(/\d{1,3}\.\d{2}/g) || []).map(parseFloat);
          for (const v of nums) if (v > 5 && v < 500) result.totals.push({ text: v.toFixed(2), value: v });
        }
      }
      for (const key of ["totals", "gallons", "prices"]) {
        const seen = new Set();
        result[key] = result[key].filter(c => !seen.has(c.text) && seen.add(c.text)).slice(0, 4);
      }
    } catch (e) {
      console.warn("Receipt OCR failed", e);
    }
    return result;
  }

  return { mileageCandidates, receiptCandidates };
})();
