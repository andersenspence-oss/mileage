// Mileage Log — main app: routing, views, and the IRS math.
window.App = (() => {

  // ---------- helpers ----------

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const todayISO = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const usDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return m + "/" + d + "/" + y;
  };
  const usDateTime = (isoString) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    let h = d.getHours(); const ampm = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear() + " " + h + ":" + String(d.getMinutes()).padStart(2, "0") + " " + ampm;
  };

  const isBusiness = (cat) => !CONFIG.nonBusinessCategories.includes(cat);

  function rateFor(dateISO) {
    for (const r of CONFIG.rates) {
      if (dateISO >= r.start && dateISO <= r.end) return r.ratePerMile;
    }
    return null;
  }

  // All the numbers derived from an entry, mirroring the sheet columns.
  function derived(e) {
    const mult = e.roundTrip ? 2 : 1;
    const formulaMiles = (e.beginOdometer != null && e.endOdometer != null && e.endOdometer >= e.beginOdometer)
      ? (e.endOdometer - e.beginOdometer) * mult : null;
    const tripMiles = e.tripometerMiles != null ? e.tripometerMiles * mult : null;
    const totalMiles = formulaMiles != null ? formulaMiles : tripMiles;
    const discrepancy = formulaMiles != null && tripMiles != null && Math.abs(formulaMiles - tripMiles) > 1.0;
    const biz = isBusiness(e.category);
    const rate = biz ? (e.rateOverride != null ? e.rateOverride : (rateFor(e.tripDate) || 0)) : 0;
    const deduction = (biz && !e.voided && totalMiles != null) ? Math.round(totalMiles * rate * 100) / 100 : 0;
    const flags = [];
    if (e.voided) flags.push("VOID: " + (e.voidReason || "voided by user"));
    if (discrepancy) flags.push("MILEAGE MISMATCH (trip vs odometer)");
    if (e.inProgress) flags.push("IN PROGRESS");
    if (e.auditNote) flags.push(e.auditNote);
    return { formulaMiles, tripMiles, totalMiles, discrepancy, isBusiness: biz, rate, deduction, flags: flags.join(" | ") };
  }

  function newEntry() {
    return {
      entryID: crypto.randomUUID(),
      kind: "trip",
      tripDate: todayISO(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      person: localStorage.getItem("profileName") || "",
      vehicleName: "",
      category: CONFIG.categories[0],
      whereText: "", purpose: "", notes: "",
      startLocation: "", endLocation: "",
      roundTrip: false,
      beginOdometer: null, endOdometer: null, tripometerMiles: null,
      inProgress: false, rateOverride: null,
      fuelTotal: null, fuelGallons: null, fuelPricePerGallon: null,
      driveIds: { begin: null, end: null, trip: null, receipt: null },
      syncState: "pending", lastSyncError: "",
      auditNote: "", voided: false, voidReason: "",
    };
  }

  // Resize/re-encode an image blob on a canvas.
  async function compressBlob(blob, maxDim, quality) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  }

  function blobURL(blob) { return URL.createObjectURL(blob); }

  // ---------- routing ----------

  async function route() {
    await DB.open();
    await seedVehicles();
    if (!localStorage.getItem("profileName")) { renderProfilePicker(); return; }
    const hash = location.hash || "#trips";
    const tab = hash.replace("#", "").split("?")[0];
    $$("#tabbar a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
    $("#tabbar").style.display = "";
    const params = new URLSearchParams(hash.split("?")[1] || "");
    if (tab === "log") await renderLog(params.get("edit"));
    else if (tab === "dash") await renderDashboard();
    else if (tab === "settings") await renderSettings();
    else await renderTrips();
    window.scrollTo(0, 0);
  }

  async function seedVehicles() {
    const vehicles = await DB.all("vehicles");
    if (vehicles.length) return;
    for (const v of CONFIG.seedVehicles) {
      await DB.put("vehicles", { id: crypto.randomUUID(), nickname: v.nickname, makeModel: v.makeModel, plate: v.plate, lastOdometer: null, createdAt: new Date().toISOString() });
    }
  }

  // ---------- profile picker ----------

  function renderProfilePicker() {
    $("#tabbar").style.display = "none";
    $("#view").innerHTML = `
      <div class="onboard">
        <div class="onboard-icon">&#128663;</div>
        <h1>Whose phone is this?</h1>
        <p class="muted">Every entry logged on this phone is tagged with this name in the mileage log. You can change it later in Settings.</p>
        ${CONFIG.profiles.map(p => `<button class="btn primary big" data-profile="${esc(p)}">${esc(p)}</button>`).join("")}
      </div>`;
    $$("[data-profile]").forEach(b => b.onclick = () => {
      localStorage.setItem("profileName", b.dataset.profile);
      location.hash = "#log";
      route();
    });
  }

  // ---------- Log / edit form ----------

  let pendingPhotos = {};   // kind -> blob (not yet saved)
  let removedPhotos = {};   // kind -> true

  async function renderLog(editId) {
    pendingPhotos = {}; removedPhotos = {};
    const vehicles = await DB.all("vehicles");
    let entry = editId ? await DB.get("entries", editId) : null;
    const isEdit = !!entry;
    if (!entry) entry = newEntry();
    if (!entry.vehicleName && vehicles[0]) entry.vehicleName = vehicles[0].nickname;

    const photoSlot = (kind, title) => `
      <div class="photo-row" id="slot-${kind}">
        <div class="thumb" id="thumb-${kind}">&#128247;</div>
        <div class="photo-label">
          <div>${title}</div>
          <div class="muted small" id="pstat-${kind}"></div>
        </div>
        <button type="button" class="btn" data-shoot="${kind}">&#128247; Camera</button>
        <button type="button" class="btn ghost" data-pick="${kind}">&#128193;</button>
        <input type="file" accept="image/*" capture="environment" id="file-cam-${kind}" hidden>
        <input type="file" accept="image/*" id="file-lib-${kind}" hidden>
      </div>
      <div class="chips" id="chips-${kind}"></div>`;

    const numRow = (id, label, placeholder, value) => `
      <label class="field"><span>${label}</span>
        <input type="text" inputmode="decimal" id="${id}" placeholder="${placeholder}" value="${value != null ? value : ""}">
      </label>`;

    $("#view").innerHTML = `
    <div class="page">
      <h1>${isEdit ? (entry.inProgress ? "Finish Trip" : "Edit Entry") : "Log a Trip"}</h1>

      <section class="card">
        <h2>Trip Info</h2>
        <label class="field"><span>Date</span><input type="date" id="f-date" value="${entry.tripDate}"></label>
        <label class="field"><span>Vehicle</span>
          <select id="f-vehicle">${vehicles.map(v => `<option ${v.nickname === entry.vehicleName ? "selected" : ""}>${esc(v.nickname)}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Category</span>
          <select id="f-category">${CONFIG.categories.map(c => `<option ${c === entry.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Where</span><input type="text" id="f-where" placeholder="e.g. St. George → Cedar City" value="${esc(entry.whereText)}"></label>
        <label class="field"><span id="purpose-label">Business purpose</span><input type="text" id="f-purpose" placeholder="e.g. patient consult" value="${esc(entry.purpose)}"></label>
        <label class="check"><input type="checkbox" id="f-fuelonly" ${entry.kind === "fuel" ? "checked" : ""}> Fuel purchase only (no trip mileage)</label>
      </section>

      <section class="card" id="mileage-card">
        <h2>Mileage</h2>
        ${photoSlot("begin", "Beginning odometer photo")}
        ${numRow("f-begin", "Beginning Mileage", "odometer at start", entry.beginOdometer)}
        ${photoSlot("end", "Ending odometer photo")}
        ${numRow("f-end", "Ending Mileage", "odometer at end", entry.endOdometer)}
        ${photoSlot("trip", "Tripometer photo")}
        ${numRow("f-trip", "Trip miles (tripometer)", "trip meter reading", entry.tripometerMiles)}
        <label class="check"><input type="checkbox" id="f-round" ${entry.roundTrip ? "checked" : ""}> Round trip (doubles the miles)</label>
        <div id="calc-line" class="calc"></div>
        <div id="warnings"></div>
        <div class="loc-row">
          <input type="text" id="f-startloc" placeholder="Start location (optional)" value="${esc(entry.startLocation)}">
          <button type="button" class="btn ghost" data-loc="f-startloc">&#128205;</button>
        </div>
        <div class="loc-row">
          <input type="text" id="f-endloc" placeholder="End location (optional)" value="${esc(entry.endLocation)}">
          <button type="button" class="btn ghost" data-loc="f-endloc">&#128205;</button>
        </div>
        <p class="muted small">You can save with just the beginning reading and finish the trip later — it shows as In Progress.</p>
      </section>

      <section class="card">
        <h2>Fuel <span class="muted">(optional)</span></h2>
        <label class="check" id="fuel-toggle-row"><input type="checkbox" id="f-fuel" ${entry.fuelTotal != null || entry.driveIds.receipt || entry.kind === "fuel" ? "checked" : ""}> Add fuel purchase to this trip</label>
        <div id="fuel-fields" hidden>
          ${photoSlot("receipt", "Receipt / pump photo")}
          ${numRow("f-fueltotal", "Total $", "0.00", entry.fuelTotal)}
          ${numRow("f-gallons", "Gallons", "0.000", entry.fuelGallons)}
          ${numRow("f-price", "Price / gallon", "0.00", entry.fuelPricePerGallon)}
        </div>
      </section>

      <section class="card" id="rate-card">
        <h2>Deduction</h2>
        <div id="rate-line" class="calc"></div>
        ${numRow("f-rateoverride", "Override rate ($/mi)", "blank = automatic", entry.rateOverride)}
      </section>

      <section class="card">
        <label class="field"><span>Notes</span><input type="text" id="f-notes" placeholder="optional" value="${esc(entry.notes)}"></label>
        <button class="btn primary big" id="save-btn">Save Trip</button>
        <p class="muted small center">Saved entries sync to the Google Sheet automatically — even if you're offline now.</p>
      </section>
    </div>`;

    // ----- wiring -----
    const refresh = () => updateLogDerived(entry, vehicles);

    for (const kind of ["begin", "end", "trip", "receipt"]) {
      $(`[data-shoot="${kind}"]`).onclick = () => $(`#file-cam-${kind}`).click();
      $(`[data-pick="${kind}"]`).onclick = () => $(`#file-lib-${kind}`).click();
      for (const src of ["cam", "lib"]) {
        $(`#file-${src}-${kind}`).onchange = async (e) => {
          const file = e.target.files[0];
          if (file) await onPhoto(kind, file);
          e.target.value = "";
        };
      }
      // show existing photo when editing
      DB.get("photos", entry.entryID + "_" + kind).then(p => {
        if (p) showThumb(kind, p.blob);
      });
    }

    $$("[data-loc]").forEach(b => b.onclick = () => fillLocation(b.dataset.loc));
    ["f-begin", "f-end", "f-trip", "f-round", "f-date", "f-category", "f-rateoverride", "f-vehicle"].forEach(id => {
      $("#" + id).addEventListener("input", refresh);
      $("#" + id).addEventListener("change", refresh);
    });
    const syncFuelVisibility = () => {
      const fuelOnly = $("#f-fuelonly").checked;
      $("#mileage-card").hidden = fuelOnly;
      $("#fuel-toggle-row").hidden = fuelOnly;
      $("#fuel-fields").hidden = !($("#f-fuel").checked || fuelOnly);
      $("#rate-card").hidden = fuelOnly || !isBusiness($("#f-category").value);
      $("#save-btn").textContent = fuelOnly ? "Save Fuel Purchase" : (isEdit ? "Save Changes" : "Save Trip");
    };
    $("#f-fuelonly").onchange = syncFuelVisibility;
    $("#f-fuel").onchange = syncFuelVisibility;
    $("#f-category").addEventListener("change", () => {
      $("#purpose-label").textContent = isBusiness($("#f-category").value) ? "Business purpose (required)" : "What (optional)";
      syncFuelVisibility();
    });
    ["f-fueltotal", "f-gallons"].forEach(id => $("#" + id).addEventListener("input", () => {
      const total = parseFloat($("#f-fueltotal").value), gal = parseFloat($("#f-gallons").value);
      if (!$("#f-price").value && total > 0 && gal > 0) $("#f-price").value = (total / gal).toFixed(3);
    }));
    $("#save-btn").onclick = () => saveEntry(entry, isEdit, vehicles);

    syncFuelVisibility();
    $("#purpose-label").textContent = isBusiness(entry.category) ? "Business purpose (required)" : "What (optional)";
    refresh();
  }

  function showThumb(kind, blob) {
    const t = $("#thumb-" + kind);
    if (!t) return;
    t.innerHTML = `<img src="${blobURL(blob)}" alt="">`;
    const stat = $("#pstat-" + kind);
    if (stat) { stat.textContent = "Photo attached"; stat.classList.add("ok"); }
  }

  async function onPhoto(kind, file) {
    // Keep a good-quality original (max 2000px) — the upload copy is
    // compressed separately at sync time.
    const original = await compressBlob(file, 2000, 0.85);
    pendingPhotos[kind] = original;
    delete removedPhotos[kind];
    showThumb(kind, original);
    const stat = $("#pstat-" + kind);
    const chips = $("#chips-" + kind);
    stat.textContent = "Reading numbers…";
    chips.innerHTML = "";
    try {
      if (kind === "receipt") {
        const r = await OCR.receiptCandidates(original);
        stat.textContent = "Photo attached";
        renderChips(chips, [
          { label: "Total $ — tap to use:", list: r.totals, target: "f-fueltotal" },
          { label: "Gallons:", list: r.gallons, target: "f-gallons" },
          { label: "Price/gal:", list: r.prices, target: "f-price" },
        ]);
      } else {
        const candidates = await OCR.mileageCandidates(original);
        stat.textContent = "Photo attached";
        const target = { begin: "f-begin", end: "f-end", trip: "f-trip" }[kind];
        renderChips(chips, [{ label: candidates.length ? "Read from photo — tap to use:" : "Couldn't read a number — type it in.", list: candidates, target }]);
      }
    } catch (e) {
      stat.textContent = "Photo attached (OCR unavailable)";
    }
  }

  function renderChips(container, groups) {
    container.innerHTML = groups.map(g => g.list.length || g.label.includes("Couldn") ? `
      <div class="chip-group"><span class="muted small">${g.label}</span>
        ${g.list.map(c => `<button type="button" class="chip" data-target="${g.target}" data-value="${c.text}">${c.text}</button>`).join("")}
      </div>` : "").join("");
    $$(".chip", container).forEach(chip => chip.onclick = () => {
      $("#" + chip.dataset.target).value = chip.dataset.value;
      $("#" + chip.dataset.target).dispatchEvent(new Event("input"));
      chip.classList.add("picked");
    });
  }

  function updateLogDerived(entry, vehicles) {
    const begin = parseFloat($("#f-begin").value), end = parseFloat($("#f-end").value), trip = parseFloat($("#f-trip").value);
    const mult = $("#f-round").checked ? 2 : 1;
    const calc = $("#calc-line"), warnings = $("#warnings");
    let calcText = "";
    if (!isNaN(begin) && !isNaN(end) && end >= begin) {
      calcText = "Calculated trip distance: <b>" + ((end - begin) * mult).toFixed(1) + " mi</b>";
    }
    calc.innerHTML = calcText;

    const warn = [];
    if (!isNaN(begin) && !isNaN(end) && end < begin) warn.push({ level: "err", text: "Ending mileage is LESS than beginning mileage." });
    if (!isNaN(begin) && !isNaN(end) && !isNaN(trip) && Math.abs((end - begin) * mult - trip * mult) > 1.0)
      warn.push({ level: "warn", text: "Tripometer and odometer difference disagree by more than 1 mile — the entry will be flagged." });
    const vehicle = vehicles.find(v => v.nickname === $("#f-vehicle").value);
    if (vehicle && vehicle.lastOdometer != null && !isNaN(begin) && Math.abs(begin - vehicle.lastOdometer) > 500)
      warn.push({ level: "warn", text: "Begin mileage is " + Math.abs(begin - vehicle.lastOdometer).toFixed(0) + " miles from this vehicle's last recorded odometer (" + vehicle.lastOdometer.toFixed(0) + ") — double-check." });
    warnings.innerHTML = warn.map(w => `<div class="${w.level}">${w.level === "err" ? "&#9888;&#65039;" : "&#9888;"} ${w.text}</div>`).join("");

    const dateISO = $("#f-date").value;
    const auto = rateFor(dateISO);
    const rate = parseFloat($("#f-rateoverride").value) || auto || 0;
    const miles = (!isNaN(begin) && !isNaN(end) && end >= begin) ? (end - begin) * mult : (!isNaN(trip) ? trip * mult : null);
    $("#rate-line").innerHTML =
      (auto != null ? "Automatic IRS rate: <b>" + (auto * 100).toFixed(1) + "¢/mi</b>" : "<span class='err'>No rate for this date — add it to js/config.js</span>") +
      (miles != null ? " &nbsp;·&nbsp; Estimated deduction: <b>$" + (miles * rate).toFixed(2) + "</b>" : "");
  }

  async function saveEntry(entry, isEdit, vehicles) {
    const fuelOnly = $("#f-fuelonly").checked;
    const showFuel = $("#f-fuel").checked || fuelOnly;
    const num = (id) => { const v = parseFloat($("#" + id).value); return isNaN(v) ? null : v; };
    const category = $("#f-category").value;
    const purpose = $("#f-purpose").value.trim();

    if (!fuelOnly && !$("#f-vehicle").value) return alert("Pick a vehicle first (add one in Settings).");
    if (isBusiness(category) && !purpose) return alert("Business trips need a short business purpose — it's what the IRS looks for first in an audit.");
    const begin = fuelOnly ? null : num("f-begin"), end = fuelOnly ? null : num("f-end"), trip = fuelOnly ? null : num("f-trip");
    if (fuelOnly && num("f-fueltotal") == null && !pendingPhotos.receipt && !entry.driveIds.receipt) return alert("Enter the fuel total (or attach the receipt photo) before saving.");
    if (!fuelOnly && begin == null && trip == null) return alert("Enter at least a Beginning Mileage (you can finish the trip later) or a tripometer reading.");
    if (begin != null && end != null && end < begin) return alert("Ending mileage can't be less than beginning mileage.");

    let auditNote = "";
    if (isEdit && entry.syncState === "synced" && !entry.inProgress) {
      auditNote = prompt("This entry is already in the Google Sheet. Briefly note what was fixed (kept in the row's Flags column for audit purposes):", "");
      if (auditNote === null) return;
    }

    Object.assign(entry, {
      kind: fuelOnly ? "fuel" : "trip",
      tripDate: $("#f-date").value || todayISO(),
      person: localStorage.getItem("profileName") || "",
      vehicleName: $("#f-vehicle").value,
      category,
      whereText: $("#f-where").value.trim(),
      purpose,
      notes: $("#f-notes").value.trim(),
      startLocation: $("#f-startloc").value.trim(),
      endLocation: $("#f-endloc").value.trim(),
      roundTrip: $("#f-round").checked,
      beginOdometer: begin, endOdometer: end, tripometerMiles: trip,
      inProgress: !fuelOnly && begin != null && end == null && trip == null,
      rateOverride: num("f-rateoverride"),
      fuelTotal: showFuel ? num("f-fueltotal") : null,
      fuelGallons: showFuel ? num("f-gallons") : null,
      fuelPricePerGallon: showFuel ? num("f-price") : null,
      syncState: "pending",
      updatedAt: new Date().toISOString(),
    });
    if (auditNote) {
      const stamp = usDate(todayISO()) + " by " + entry.person;
      entry.auditNote = (entry.auditNote ? entry.auditNote + "; " : "") + "Edited " + stamp + ": " + auditNote;
    }

    for (const [kind, blob] of Object.entries(pendingPhotos)) {
      await DB.put("photos", { id: entry.entryID + "_" + kind, blob });
      entry.driveIds[kind] = null; // photo changed -> re-upload
    }
    await DB.put("entries", entry);

    const vehicle = vehicles.find(v => v.nickname === entry.vehicleName);
    const newest = Math.max(entry.endOdometer || 0, entry.beginOdometer || 0);
    if (vehicle && newest > 0 && (vehicle.lastOdometer == null || newest > vehicle.lastOdometer)) {
      vehicle.lastOdometer = newest;
      await DB.put("vehicles", vehicle);
    }

    Sync.syncNow(false);
    location.hash = "#trips";
  }

  async function fillLocation(inputId) {
    if (!navigator.geolocation) return alert("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      let text = latitude.toFixed(5) + ", " + longitude.toFixed(5);
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
        const j = await r.json();
        if (j.address) {
          text = [j.address.house_number, j.address.road, j.address.city || j.address.town || j.address.village, j.address.state]
            .filter(Boolean).join(", ") || j.display_name || text;
        }
      } catch (e) { /* keep coordinates */ }
      $("#" + inputId).value = text;
    }, () => alert("Couldn't get your location. Check that location access is allowed for this site."));
  }

  // ---------- Trips list ----------

  async function renderTrips() {
    const entries = (await DB.all("entries")).sort((a, b) => (b.tripDate + b.createdAt).localeCompare(a.tripDate + a.createdAt));
    const { status, syncing } = Sync.getStatus();
    const badge = (e) => e.syncState === "synced" ? `<span class="badge ok">&#10003; synced</span>`
      : e.syncState === "failed" ? `<span class="badge err">&#9888; retry</span>`
      : `<span class="badge">&#8635; waiting</span>`;

    $("#view").innerHTML = `
    <div class="page">
      <h1>Trips</h1>
      <section class="card sync-card">
        <span id="sync-status" class="muted small">${esc(status || "")}</span>
        <button class="btn" id="sync-now" ${syncing ? "disabled" : ""}>Sync Now</button>
      </section>
      ${entries.length ? "" : `<section class="card center"><p>&#128663;</p><p class="muted">No trips yet. Tap <b>Log Trip</b> below to record your first one.</p></section>`}
      ${entries.map(e => {
        const d = derived(e);
        return `
        <section class="card entry ${e.voided ? "voided" : ""}" data-id="${e.entryID}">
          <div class="entry-top">
            <b>${usDate(e.tripDate)}</b>
            ${badge(e)}
          </div>
          <div class="entry-tags">
            <span class="tag ${d.isBusiness ? "biz" : ""}">${esc(e.category)}</span>
            <span class="muted small">${esc(e.vehicleName)}</span>
            <span class="muted small">${esc(e.person)}</span>
          </div>
          ${e.whereText || e.purpose ? `<div class="muted small">${esc([e.whereText, e.purpose].filter(Boolean).join(" — "))}</div>` : ""}
          <div class="entry-nums">
            ${e.voided ? `<span class="err"><b>VOID</b></span>`
              : e.kind === "fuel" ? `<b>Fuel ${e.fuelTotal != null ? "$" + e.fuelTotal.toFixed(2) : ""}</b>`
              : `${d.totalMiles != null ? `<b>${d.totalMiles.toFixed(1)} mi</b>` : ""}
                 ${d.deduction ? `<span class="ok">$${d.deduction.toFixed(2)} deduction</span>` : ""}
                 ${e.fuelTotal != null ? `<span class="muted small">+ fuel $${e.fuelTotal.toFixed(2)}</span>` : ""}`}
            ${e.inProgress ? `<span class="warn"><b>IN PROGRESS — tap to finish</b></span>` : ""}
            ${d.discrepancy ? `<span class="warn">&#9888;</span>` : ""}
          </div>
          ${e.lastSyncError ? `<div class="err small">${esc(e.lastSyncError.slice(0, 160))}</div>` : ""}
          <div class="entry-actions">
            <button class="btn small-btn" data-edit="${e.entryID}">${e.inProgress ? "Finish" : "Edit"}</button>
            ${!e.voided ? (e.syncState === "pending" && Date.now() - new Date(e.createdAt).getTime() < 300000
              ? `<button class="btn small-btn ghost" data-delete="${e.entryID}">Delete</button>`
              : `<button class="btn small-btn ghost" data-void="${e.entryID}">Void</button>`) : ""}
          </div>
        </section>`;
      }).join("")}
    </div>`;

    $("#sync-now").onclick = () => Sync.syncNow(true);
    Sync.onChange((text, isSyncing) => {
      const el = $("#sync-status");
      if (el) el.textContent = text;
      const btn = $("#sync-now");
      if (btn) btn.disabled = isSyncing;
      if (!isSyncing && location.hash.startsWith("#trips")) route();
    });
    $$("[data-edit]").forEach(b => b.onclick = () => { location.hash = "#log?edit=" + b.dataset.edit; });
    $$("[data-delete]").forEach(b => b.onclick = async () => {
      if (!confirm("Delete this unsynced draft? (Synced entries get voided instead, to keep the log audit-safe.)")) return;
      for (const kind of ["begin", "end", "trip", "receipt"]) await DB.del("photos", b.dataset.delete + "_" + kind);
      await DB.del("entries", b.dataset.delete);
      route();
    });
    $$("[data-void]").forEach(b => b.onclick = async () => {
      const reason = prompt("Void this entry? The row stays in the Google Sheet marked VOID (with your reason) and is excluded from all totals — cleaner for the IRS than deleting.\n\nReason:", "");
      if (reason === null) return;
      const e = await DB.get("entries", b.dataset.void);
      e.voided = true; e.voidReason = reason || "voided by user";
      e.syncState = "pending"; e.updatedAt = new Date().toISOString();
      await DB.put("entries", e);
      Sync.syncNow(false);
      route();
    });
  }

  // ---------- Dashboard ----------

  async function renderDashboard() {
    const all = await DB.all("entries");
    const yearRecords = await DB.all("yearRecords");
    const preset = localStorage.getItem("dashPreset") || "thisYear";
    const year = new Date().getFullYear();
    const customStart = localStorage.getItem("dashStart") || year + "-01-01";
    const customEnd = localStorage.getItem("dashEnd") || todayISO();

    let start, end, rangeLabel;
    if (preset === "lastYear") { start = (year - 1) + "-01-01"; end = (year - 1) + "-12-31"; rangeLabel = String(year - 1); }
    else if (preset === "custom") { start = customStart; end = customEnd; rangeLabel = usDate(start) + " – " + usDate(end); }
    else { start = year + "-01-01"; end = "9999-12-31"; rangeLabel = String(year); }

    const filtered = all.filter(e => !e.voided && e.tripDate >= start && e.tripDate <= end);
    const biz = filtered.filter(e => isBusiness(e.category));
    const sum = (list, fn) => list.reduce((acc, e) => acc + (fn(e) || 0), 0);
    const totalMilesOf = (e) => derived(e).totalMiles;
    const deductionOf = (e) => derived(e).deduction;

    const groups = (keyFn) => {
      const m = {};
      for (const e of filtered) {
        const k = keyFn(e) || "(none)";
        m[k] = m[k] || { miles: 0, ded: 0, fuel: 0 };
        m[k].miles += totalMilesOf(e) || 0;
        m[k].ded += deductionOf(e) || 0;
        m[k].fuel += e.fuelTotal || 0;
      }
      return Object.entries(m).sort((a, b) => b[1].miles - a[1].miles);
    };
    const groupRows = (list) => list.map(([k, v]) => `
      <div class="row"><span>${esc(k)}</span>
        <span class="right"><b>${v.miles.toFixed(1)} mi</b>
        ${v.ded ? `<span class="ok small"> $${v.ded.toFixed(2)}</span>` : ""}
        ${v.fuel ? `<span class="muted small"> fuel $${v.fuel.toFixed(2)}</span>` : ""}</span>
      </div>`).join("") || `<p class="muted small">Nothing in this range.</p>`;

    const bizUse = [];
    const byVehicle = groups(e => e.vehicleName);
    for (const [vname] of byVehicle) {
      const vEntries = filtered.filter(e => e.vehicleName === vname);
      const bMiles = sum(vEntries.filter(e => isBusiness(e.category)), totalMilesOf);
      if (!bMiles) continue;
      const rec = yearRecords.find(r => r.vehicleName === vname && String(r.year) === start.slice(0, 4));
      if (rec && rec.startOdometer != null && rec.endOdometer != null && rec.endOdometer > rec.startOdometer) {
        const annual = rec.endOdometer - rec.startOdometer;
        bizUse.push(`${vname}: <b>${(bMiles / annual * 100).toFixed(0)}%</b> business use (${bMiles.toFixed(0)} of ${annual.toFixed(0)} annual miles)`);
      } else {
        const logged = sum(vEntries, totalMilesOf);
        if (logged) bizUse.push(`${vname}: ${(bMiles / logged * 100).toFixed(0)}% of logged miles are business — record Jan 1 & Dec 31 odometers in Settings for the true annual %`);
      }
    }

    $("#view").innerHTML = `
    <div class="page">
      <h1>Dashboard</h1>
      <section class="card">
        <div class="seg">
          <button data-preset="thisYear" class="${preset === "thisYear" ? "on" : ""}">This Year</button>
          <button data-preset="lastYear" class="${preset === "lastYear" ? "on" : ""}">Last Year</button>
          <button data-preset="custom" class="${preset === "custom" ? "on" : ""}">Custom</button>
        </div>
        ${preset === "custom" ? `
          <label class="field"><span>From</span><input type="date" id="dash-start" value="${customStart}"></label>
          <label class="field"><span>To</span><input type="date" id="dash-end" value="${customEnd}"></label>` : ""}
      </section>
      <section class="card">
        <h2>Totals — ${rangeLabel}</h2>
        <div class="row"><span>Business miles</span><b>${sum(biz, totalMilesOf).toFixed(1)} mi</b></div>
        <div class="row"><span>Personal miles</span><b>${sum(filtered.filter(e => !isBusiness(e.category)), totalMilesOf).toFixed(1)} mi</b></div>
        <div class="row"><span>Total deduction</span><b class="ok">$${sum(biz, deductionOf).toFixed(2)}</b></div>
        <div class="row"><span>Fuel spend</span><b>$${sum(filtered, e => e.fuelTotal).toFixed(2)}</b></div>
        <div class="row"><span>Entries</span><b>${filtered.length}</b></div>
      </section>
      <section class="card"><h2>By Category</h2>${groupRows(groups(e => e.category))}</section>
      <section class="card"><h2>By Vehicle</h2>${groupRows(byVehicle)}
        ${bizUse.map(l => `<p class="muted small">${l}</p>`).join("")}
      </section>
      <section class="card"><h2>By Person</h2>${groupRows(groups(e => e.person))}</section>
      <section class="card">
        <h2>Export for Accountant</h2>
        <button class="btn" id="export-csv">&#11015; Download CSV</button>
        <button class="btn" id="export-print">&#128424; Printable Report / PDF</button>
        <p class="muted small">On the print screen, choose "Save as PDF" from the share options.</p>
      </section>
    </div>`;

    $$("[data-preset]").forEach(b => b.onclick = () => { localStorage.setItem("dashPreset", b.dataset.preset); renderDashboard(); });
    if (preset === "custom") {
      $("#dash-start").onchange = (e) => { localStorage.setItem("dashStart", e.target.value); renderDashboard(); };
      $("#dash-end").onchange = (e) => { localStorage.setItem("dashEnd", e.target.value); renderDashboard(); };
    }
    const exportSet = filtered.slice().sort((a, b) => a.tripDate.localeCompare(b.tripDate));
    $("#export-csv").onclick = () => downloadCSV(exportSet, rangeLabel);
    $("#export-print").onclick = () => printReport(exportSet, rangeLabel);
  }

  function downloadCSV(entries, rangeLabel) {
    const escCSV = (s) => {
      s = String(s == null ? "" : s);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headers = ["Date", "Where", "What", "Trip miles", "Begin Mileage", "End Mileage", "Using Formula mileage", "total mileage", "Notes", "Category", "Who's Phone / Driver", "Rate per Mile", "Deduction $", "Vehicle", "Business Purpose", "Start Location", "End Location", "Round Trip", "Fuel Total $", "Gallons", "Price/Gal", "Logged At", "Flags", "Entry ID"];
    const rows = entries.map(e => {
      const d = derived(e);
      return [usDate(e.tripDate), e.whereText, e.purpose, d.tripMiles, e.beginOdometer, e.endOdometer, d.formulaMiles, e.voided ? "" : d.totalMiles, e.notes, e.category, e.person, d.isBusiness ? d.rate : 0, d.deduction ? d.deduction.toFixed(2) : "", e.vehicleName, e.purpose, e.startLocation, e.endLocation, e.roundTrip ? "Yes" : "", e.fuelTotal, e.fuelGallons, e.fuelPricePerGallon, usDateTime(e.createdAt), d.flags, e.entryID]
        .map(v => escCSV(v == null ? "" : v)).join(",");
    });
    const blob = new Blob([headers.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Mileage Log " + rangeLabel.replace(/[/ ]/g, "-") + ".csv";
    a.click();
  }

  function printReport(entries, rangeLabel) {
    const sum = (list, fn) => list.reduce((acc, e) => acc + (fn(e) || 0), 0);
    const biz = entries.filter(e => isBusiness(e.category) && !e.voided);
    const rows = entries.map(e => {
      const d = derived(e);
      return `<tr>
        <td>${usDate(e.tripDate)}</td><td>${esc(e.vehicleName)}</td><td>${esc(e.category)}</td><td>${esc(e.person)}</td>
        <td>${esc([e.whereText, e.purpose].filter(Boolean).join(" — "))}</td>
        <td class="r">${e.beginOdometer != null ? e.beginOdometer : ""}</td>
        <td class="r">${e.endOdometer != null ? e.endOdometer : ""}</td>
        <td class="r">${e.voided ? "VOID" : (d.totalMiles != null ? d.totalMiles.toFixed(1) : "")}</td>
        <td class="r">${d.isBusiness && !e.voided ? d.rate.toFixed(3) : ""}</td>
        <td class="r">${d.deduction ? "$" + d.deduction.toFixed(2) : ""}</td>
        <td class="r">${e.fuelTotal != null ? "$" + e.fuelTotal.toFixed(2) : ""}</td>
      </tr>`;
    }).join("");
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><title>Mileage Log ${esc(rangeLabel)}</title><style>
      body{font-family:-apple-system,Segoe UI,sans-serif;font-size:11px;margin:24px}
      h1{font-size:16px} table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:3px 5px;text-align:left} .r{text-align:right}
      tfoot td{font-weight:bold}
    </style></head><body>
      <h1>Vehicle Mileage &amp; Fuel Log — ${esc(rangeLabel)}</h1>
      <table><thead><tr><th>Date</th><th>Vehicle</th><th>Category</th><th>Driver</th><th>Where / Purpose</th><th>Begin</th><th>End</th><th>Miles</th><th>Rate</th><th>Deduction</th><th>Fuel $</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7">Totals</td>
        <td class="r">${sum(biz, e => derived(e).totalMiles).toFixed(1)}</td><td></td>
        <td class="r">$${sum(biz, e => derived(e).deduction).toFixed(2)}</td>
        <td class="r">$${sum(entries.filter(e => !e.voided), e => e.fuelTotal).toFixed(2)}</td></tr></tfoot>
      </table>
      <p>Generated ${usDateTime(new Date().toISOString())} · ${entries.length} entries · Log kept contemporaneously with photo documentation of odometer readings and receipts.</p>
      <script>setTimeout(()=>window.print(),300)<\/script>
    </body></html>`);
    w.document.close();
  }

  // ---------- Settings ----------

  async function renderSettings() {
    const vehicles = await DB.all("vehicles");
    const yearRecords = await DB.all("yearRecords");
    const year = parseInt(localStorage.getItem("odoYear") || new Date().getFullYear(), 10);
    const pending = await Sync.pendingCount();

    $("#view").innerHTML = `
    <div class="page">
      <h1>Settings</h1>

      <section class="card">
        <h2>Profile</h2>
        <label class="field"><span>This phone belongs to</span>
          <select id="s-profile">${CONFIG.profiles.map(p => `<option ${p === localStorage.getItem("profileName") ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </label>
      </section>

      <section class="card">
        <h2>Google Sheets Sync</h2>
        ${GAuth.isConnected()
          ? `<div class="row"><span>Google account</span><b class="ok">${esc(GAuth.connectedEmail() || "Connected")}</b></div>
             <button class="btn" id="s-test">Test Sheet Connection</button>
             <div id="s-test-result" class="small"></div>
             <button class="btn ghost" id="s-disconnect">Disconnect Google</button>`
          : `<button class="btn primary" id="s-connect">Connect Google Account</button>
             <p class="muted small">Each phone signs in once with its own Google account; both accounts need Editor access to the sheet.</p>`}
        <div id="s-auth-error" class="err small"></div>
        ${pending ? `<div class="row"><span>Waiting to sync</span><b>${pending} entr${pending === 1 ? "y" : "ies"}</b></div>` : ""}
        <a class="btn ghost" href="https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}" target="_blank" rel="noopener">&#8599; Open the Google Sheet</a>
      </section>

      <section class="card">
        <h2>Vehicles</h2>
        <div id="vehicle-list">
          ${vehicles.map(v => `
            <div class="row vehicle" data-vid="${v.id}">
              <span>${esc(v.nickname)}<br><span class="muted small">${esc([v.makeModel, v.plate].filter(Boolean).join(" • "))}</span></span>
              <button class="btn small-btn" data-editveh="${v.id}">Edit</button>
            </div>`).join("")}
        </div>
        <div class="veh-form">
          <input type="hidden" id="v-id">
          <input type="text" id="v-nick" placeholder="Nickname (shown in the app)">
          <input type="text" id="v-make" placeholder="Make / model">
          <input type="text" id="v-plate" placeholder="License plate">
          <button class="btn" id="v-save">Add Vehicle</button>
        </div>
      </section>

      <section class="card">
        <h2>Annual Odometers <span class="muted">(Jan 1 / Dec 31)</span></h2>
        <p class="muted small">The IRS asks for total annual miles per vehicle on Schedule C / Form 4562 — record each vehicle's odometer at the start and end of the year.</p>
        <label class="field"><span>Year</span><input type="number" id="odo-year" value="${year}" min="2020" max="2040"></label>
        <div id="odo-forms">
          ${vehicles.map(v => {
            const rec = yearRecords.find(r => r.vehicleName === v.nickname && r.year === year) || {};
            return `
            <div class="odo-block" data-veh="${esc(v.nickname)}">
              <b>${esc(v.nickname)}</b>
              <div class="loc-row"><input type="text" inputmode="decimal" class="odo-start" placeholder="Jan 1 odometer" value="${rec.startOdometer != null ? rec.startOdometer : ""}">
                <button type="button" class="btn ghost odo-photo" data-kind="start">&#128247;</button></div>
              <div class="loc-row"><input type="text" inputmode="decimal" class="odo-end" placeholder="Dec 31 odometer" value="${rec.endOdometer != null ? rec.endOdometer : ""}">
                <button type="button" class="btn ghost odo-photo" data-kind="end">&#128247;</button></div>
              <input type="file" accept="image/*" capture="environment" class="odo-file" hidden>
              <button class="btn small-btn odo-save">Save</button>
              <span class="ok small odo-saved" hidden>Saved &#10003;</span>
            </div>`;
          }).join("")}
        </div>
      </section>

      <section class="card">
        <h2>IRS Mileage Rates <span class="muted">(from js/config.js)</span></h2>
        ${CONFIG.rates.map(r => `<div class="row"><span>${usDate(r.start)} – ${usDate(r.end)}</span><b>${(r.ratePerMile * 100).toFixed(1)}¢/mi</b></div>`).join("")}
      </section>

      <section class="card">
        <p class="muted small">Entries save on this phone first and sync to Google. Full-resolution photos are backed up to the Drive folder "${esc(CONFIG.driveFolderName)}". The Google Sheet is always the master copy — don't delete the Entry ID column.</p>
      </section>
    </div>`;

    $("#s-profile").onchange = (e) => localStorage.setItem("profileName", e.target.value);

    const connectBtn = $("#s-connect");
    if (connectBtn) connectBtn.onclick = async () => {
      $("#s-auth-error").textContent = "";
      try {
        await GAuth.connect();
        Sync.syncNow(false);
        renderSettings();
      } catch (e) {
        $("#s-auth-error").textContent = e.message || String(e);
      }
    };
    const disconnectBtn = $("#s-disconnect");
    if (disconnectBtn) disconnectBtn.onclick = () => { GAuth.disconnect(); renderSettings(); };
    const testBtn = $("#s-test");
    if (testBtn) testBtn.onclick = async () => {
      const out = $("#s-test-result");
      out.textContent = "Testing…";
      try {
        const title = await Sheets.firstSheetTitle();
        await Sheets.headerMap(title);
        out.innerHTML = `<span class="ok">&#10003; Connected — sheet tab "${esc(title)}" is ready.</span>`;
      } catch (e) {
        out.innerHTML = `<span class="err">&#10007; ${esc(e.message || e)}</span>`;
      }
    };

    $$("[data-editveh]").forEach(b => b.onclick = async () => {
      const v = await DB.get("vehicles", b.dataset.editveh);
      $("#v-id").value = v.id; $("#v-nick").value = v.nickname; $("#v-make").value = v.makeModel; $("#v-plate").value = v.plate;
      $("#v-save").textContent = "Save Vehicle";
    });
    $("#v-save").onclick = async () => {
      const nick = $("#v-nick").value.trim();
      if (!nick) return alert("Give the vehicle a nickname.");
      const id = $("#v-id").value;
      const existing = id ? await DB.get("vehicles", id) : null;
      await DB.put("vehicles", {
        id: id || crypto.randomUUID(),
        nickname: nick,
        makeModel: $("#v-make").value.trim(),
        plate: $("#v-plate").value.trim(),
        lastOdometer: existing ? existing.lastOdometer : null,
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
      });
      renderSettings();
    };

    $("#odo-year").onchange = (e) => { localStorage.setItem("odoYear", e.target.value); renderSettings(); };
    $$(".odo-block").forEach(block => {
      const vname = block.dataset.veh;
      let pendingKind = null;
      $$(".odo-photo", block).forEach(b => b.onclick = () => { pendingKind = b.dataset.kind; $(".odo-file", block).click(); });
      $(".odo-file", block).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !pendingKind) return;
        const blob = await compressBlob(file, 2000, 0.85);
        await DB.put("photos", { id: "year_" + vname + "_" + $("#odo-year").value + "_" + pendingKind, blob });
        const candidates = await OCR.mileageCandidates(blob);
        const input = $(pendingKind === "start" ? ".odo-start" : ".odo-end", block);
        if (candidates.length && !input.value) {
          if (confirm("Read \"" + candidates[0].text + "\" from the photo — use it? (Cancel to type it yourself)")) input.value = candidates[0].text;
        }
        e.target.value = "";
      };
      $(".odo-save", block).onclick = async () => {
        const y = parseInt($("#odo-year").value, 10);
        const id = vname + "_" + y;
        const startVal = parseFloat($(".odo-start", block).value);
        const endVal = parseFloat($(".odo-end", block).value);
        await DB.put("yearRecords", {
          id, vehicleName: vname, year: y,
          startOdometer: isNaN(startVal) ? null : startVal,
          endOdometer: isNaN(endVal) ? null : endVal,
          updatedAt: new Date().toISOString(),
        });
        $(".odo-saved", block).hidden = false;
      };
    });
  }

  // ---------- boot ----------

  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", () => {
    route().then(() => {
      if (GAuth.isConnected() && navigator.onLine) Sync.syncNow(false);
    });
  });

  return { derived, usDate, usDateTime, compressBlob, rateFor, isBusiness };
})();
