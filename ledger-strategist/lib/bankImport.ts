// Bank and credit card CSV import. Pure functions: parsing, column detection,
// normalizing, duplicate fingerprints, and matching against entries that were
// already typed in (checks, payroll, card payments). No database access.
//
// Every bank lays its CSV out differently, so the importer guesses the
// columns, shows a preview, lets the bookkeeper correct the guess once, and
// remembers it for that account.

export type CsvMapping = {
  headerRow: number; // index of the header line in the file
  dateCol: number;
  descCol: number;
  amountCol: number | null; // single signed amount column, or...
  debitCol: number | null; // ...separate money-out column
  creditCol: number | null; // ...and money-in column
  checkCol: number | null;
  memoCol: number | null;
  flipSign: boolean; // some card companies show charges as positive numbers
  dateOrder: "mdy" | "ymd" | "dmy";
};

export type BankRow = {
  line: number; // 1-based line in the file, for the preview
  date: Date;
  description: string;
  amount: number; // signed: + money into the register, - money out (a card charge is -)
  checkNum: string | null;
  memo: string | null;
};

export type RowError = { line: number; problem: string; raw: string };

// ---- CSV parsing --------------------------------------------------------------

/** RFC 4180 CSV: quoted fields, embedded commas/quotes/newlines, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
  return rows;
}

// ---- values ---------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(raw: string, order: CsvMapping["dateOrder"] = "mdy"): Date | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i, "");
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const a = +mt[1], b = +mt[2];
    y = +mt[3]; if (y < 100) y += 2000;
    if (order === "dmy") { d = a; m = b; } else { m = a; d = b; }
  } else if ((mt = s.match(/^([A-Za-z]{3,4})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
    m = MONTHS[mt[1].toLowerCase()] ?? 0; d = +mt[2]; y = +mt[3];
  } else if ((mt = s.match(/^(\d{1,2})\s+([A-Za-z]{3,4})[a-z]*\.?,?\s+(\d{4})$/))) {
    d = +mt[1]; m = MONTHS[mt[2].toLowerCase()] ?? 0; y = +mt[3];
  } else if ((mt = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? dt : null;
}

/** "$1,234.56", "-1234.56", "(123.45)", "1234.56-", "" -> number | null */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (/^(CR)$/i.test(s)) return null;
  s = s.replace(/\s?(CR|DR)$/i, (x) => { if (/DR/i.test(x)) neg = !neg; return ""; });
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  return neg ? -n : n;
}

// ---- column detection ---------------------------------------------------------------

const H = {
  date: /^(posting|posted|post|transaction|trans\.?|txn)?\s*date$|^date$|^date posted$|^trans(action)? date$/i,
  amount: /^(transaction )?amount( \(usd\))?$|^amt$|^amount usd$/i,
  debit: /debit|withdrawal|money out|charges?$|^paid out$/i,
  credit: /credit|deposit|money in|payments?$|^paid in$/i,
  check: /check|cheque|chk|^ref(erence)?( ?(no|number|#))?$|^num(ber)?$/i,
  memo: /^memo$|^notes?$|extended description|category/i,
};

/** Find the header row: the first row with a recognizable date column whose next rows hold real dates. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i];
    if (r.length < 2) continue;
    const dateIdx = r.findIndex((c) => H.date.test(c));
    if (dateIdx >= 0) return i;
  }
  // no recognizable header: first row whose first date-like cell parses
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].some((c) => parseDate(c))) return i - 1; // data starts here, no header
  }
  return 0;
}

export function guessMapping(rows: string[][], registerType: "bank" | "credit_card"): CsvMapping {
  const headerRow = findHeaderRow(rows);
  const header = headerRow >= 0 ? rows[headerRow].map((c) => c.toLowerCase()) : [];
  const data = rows.slice(headerRow + 1, headerRow + 40);
  const width = Math.max(...rows.slice(Math.max(headerRow, 0)).map((r) => r.length), 0);
  const find = (re: RegExp, not: number[] = []) => header.findIndex((c, i) => !not.includes(i) && re.test(c));

  let dateCol = find(H.date);
  if (dateCol < 0) {
    let best = -1, bestCount = 0;
    for (let c = 0; c < width; c++) {
      const n = data.filter((r) => r[c] && parseDate(r[c])).length;
      if (n > bestCount) { best = c; bestCount = n; }
    }
    dateCol = Math.max(best, 0);
  }
  // prefer "posting date" over "transaction date" when a file has both? No: use
  // the transaction date the bookkeeper recognizes; keep the first match.

  let amountCol = find(H.amount, [dateCol]);
  let debitCol = amountCol < 0 ? find(H.debit, [dateCol]) : -1;
  let creditCol = amountCol < 0 ? find(H.credit, [dateCol, debitCol]) : -1;
  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) {
    // no headers we know: the most "amount-looking" column
    debitCol = -1; creditCol = -1;
    let best = -1, bestCount = 0;
    for (let c = 0; c < width; c++) {
      if (c === dateCol) continue;
      const n = data.filter((r) => r[c] && parseAmount(r[c]) !== null && /\d\.\d{2}\)?-?$/.test(r[c])).length;
      if (n > bestCount) { best = c; bestCount = n; }
    }
    amountCol = best;
  }
  const used = [dateCol, amountCol, debitCol, creditCol].filter((x) => x >= 0);
  // "Description" beats "Payee"/"Name" beats "Details" (Chase's Details column is just DEBIT/CREDIT)
  let descCol = -1;
  for (const re of [/description/i, /payee|merchant/i, /^name$/i, /narrative|details|transaction$/i]) {
    descCol = find(re, used);
    if (descCol >= 0) break;
  }
  if (descCol < 0) {
    // the column with the longest text on average
    let best = -1, bestLen = 0;
    for (let c = 0; c < width; c++) {
      if (used.includes(c)) continue;
      const avg = data.reduce((s, r) => s + (r[c] && parseAmount(r[c]) === null && !parseDate(r[c]) ? r[c].length : 0), 0) / Math.max(data.length, 1);
      if (avg > bestLen) { best = c; bestLen = avg; }
    }
    descCol = Math.max(best, 0);
  }
  const checkCol = find(H.check, [...used, descCol]);
  const memoCol = find(H.memo, [...used, descCol, checkCol]);

  // date order: if any first number > 12 it's day-first; 4-digit first = ymd
  let dateOrder: CsvMapping["dateOrder"] = "mdy";
  const samples = data.map((r) => r[dateCol] ?? "").filter(Boolean);
  if (samples.some((s) => /^\d{4}/.test(s))) dateOrder = "ymd";
  else if (samples.some((s) => { const m = s.match(/^(\d{1,2})[-/.](\d{1,2})/); return !!m && +m[1] > 12; })) dateOrder = "dmy";

  // Card companies that show purchases as positive numbers (American Express,
  // Discover, some Visa issuers) need the sign flipped so a charge is money out.
  let flipSign = false;
  if (registerType === "credit_card" && amountCol >= 0) {
    const amts = data.map((r) => parseAmount(r[amountCol] ?? "")).filter((n): n is number => n !== null && n !== 0);
    const positive = amts.filter((n) => n > 0).length;
    if (amts.length > 0 && positive / amts.length > 0.6) flipSign = true;
  }

  return {
    headerRow, dateCol, descCol,
    amountCol: amountCol >= 0 ? amountCol : null,
    debitCol: debitCol >= 0 ? debitCol : null,
    creditCol: creditCol >= 0 ? creditCol : null,
    checkCol: checkCol >= 0 ? checkCol : null,
    memoCol: memoCol >= 0 ? memoCol : null,
    flipSign, dateOrder,
  };
}

/** Apply a mapping to every data row. Rows that can't be read are reported, never silently dropped. */
export function normalizeRows(rows: string[][], m: CsvMapping): { rows: BankRow[]; errors: RowError[] } {
  const out: BankRow[] = [];
  const errors: RowError[] = [];
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const rawDate = r[m.dateCol] ?? "";
    const date = parseDate(rawDate, m.dateOrder);
    // summary/footer lines ("Total", "Ending balance") have no date: skip quietly if they also lack an amount
    let amount: number | null = null;
    if (m.amountCol !== null) amount = parseAmount(r[m.amountCol] ?? "");
    else {
      const debit = m.debitCol !== null ? parseAmount(r[m.debitCol] ?? "") : null;
      const credit = m.creditCol !== null ? parseAmount(r[m.creditCol] ?? "") : null;
      if (debit !== null || credit !== null) amount = Math.round(((credit !== null ? Math.abs(credit) : 0) - (debit !== null ? Math.abs(debit) : 0)) * 100) / 100;
    }
    if (/^(beginning|ending|opening|closing) balance/i.test(r[m.descCol] ?? "")) continue;
    if (!date) {
      if (amount !== null && r.some((c) => c)) errors.push({ line, problem: `couldn't read the date "${rawDate}"`, raw: r.join(", ") });
      continue;
    }
    if (amount === null) {
      // pending / informational lines with no amount
      if (r.some((c, idx) => idx !== m.dateCol && c)) errors.push({ line, problem: "no amount on this line", raw: r.join(", ") });
      continue;
    }
    const description = (r[m.descCol] ?? "").replace(/\s+/g, " ").trim();
    if (/^(beginning|ending|opening|closing) balance/i.test(description)) continue;
    if (amount === 0) continue;
    if (m.flipSign) amount = -amount;
    out.push({
      line, date, description: description || "(no description)", amount,
      checkNum: m.checkCol !== null ? (r[m.checkCol] || "").replace(/^0+/, "") || null : null,
      memo: m.memoCol !== null ? r[m.memoCol] || null : null,
    });
  }
  return { rows: out, errors };
}

// ---- duplicates ---------------------------------------------------------------------

export function normDesc(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A stable fingerprint per bank line. Two identical charges on the same day
 * (two $5.00 car washes) get occurrence numbers 0 and 1, so they import as two
 * transactions, yet downloading the same month again still recognizes both.
 */
export function fingerprints(rows: BankRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${ymd(r.date)}|${r.amount.toFixed(2)}|${normDesc(r.description)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

// ---- payee cleanup --------------------------------------------------------------------

const NOISE = [
  /\b(pos|dbt|debit|card|visa|mc|checkcard|check card|purchase|recurring|pmt|payment|ach|web|ppd|ccd|pre-?authorized|withdrawal|deposit|online|transfer|xfer|ref(erence)?|id|des|indn|co id|trace)\b\.?/gi,
  /\b(x{2,}|\*{2,})\d{2,}\b/gi, // XXXX1234
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // dates
  /#\s?\d+/g, // store numbers
  /\b\d{5,}\b/g, // long reference numbers
  /\b[A-Z]{2}\s*$/g, // trailing state code
];

/**
 * "POS PURCHASE MAVERIK #423 ST GEORGE UT 10/04" -> "Maverik St George".
 * Used as the vendor for rules and suggestions; the full bank text is kept too.
 */
export function cleanVendor(desc: string): string {
  let s = ` ${desc} `;
  for (const re of NOISE) s = s.replace(re, " ");
  s = s.replace(/[*_]/g, " ").replace(/[^A-Za-z0-9&'.\- ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return desc.trim().slice(0, 40);
  const words = s.split(" ").slice(0, 4);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ---- matching to entries already in the books -------------------------------------------------

export type MatchCandidate = {
  txnId: string;
  date: Date;
  amount: number; // signed effect on this register, same convention as BankRow.amount
  checkNum: string | null;
};

/**
 * A bank line matches an entry that's already in the books (a check she
 * wrote, an ADP payroll entry, the other side of a card payment) when the
 * amount and direction agree exactly and the dates are within a week. A
 * matching check number wins; otherwise the closest date.
 */
export function pickMatch(row: BankRow, candidates: MatchCandidate[], maxDays = 7): MatchCandidate | null {
  const dayMs = 86400000;
  const pool = candidates.filter(
    (c) => Math.abs(c.amount - row.amount) < 0.005 && Math.abs(c.date.getTime() - row.date.getTime()) <= maxDays * dayMs
  );
  if (pool.length === 0) return null;
  if (row.checkNum) {
    const byCheck = pool.find((c) => c.checkNum && c.checkNum.replace(/^0+/, "") === row.checkNum);
    if (byCheck) return byCheck;
    // a different check number is a different check
    const others = pool.filter((c) => !c.checkNum);
    if (others.length === 0) return null;
    return others.sort((a, b) => Math.abs(a.date.getTime() - row.date.getTime()) - Math.abs(b.date.getTime() - row.date.getTime()))[0];
  }
  return pool.sort((a, b) => Math.abs(a.date.getTime() - row.date.getTime()) - Math.abs(b.date.getTime() - row.date.getTime()))[0];
}
