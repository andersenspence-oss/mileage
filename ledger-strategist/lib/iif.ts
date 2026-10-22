// QuickBooks 2016 Desktop bridge: IIF ("Intuit Interchange Format") files.
//
// Reading: QuickBooks exports its lists with
//   File > Utilities > Export > Lists to IIF Files
// (check Chart of Accounts, Customer List, Vendor List, Employee List, Other
// Names List). That gives us the exact account and payee names QuickBooks
// knows, so everything we send back lands in the right place.
//
// Writing: QuickBooks imports transactions with
//   File > Utilities > Import > IIF Files
// Each transaction is one TRNS line (the bank or card side) plus one SPL line
// per category, and the amounts must sum to exactly zero.
//
// Pure functions only; no database access.

export type IifRow = { type: string; fields: Record<string, string> };

/** Parse any IIF file into typed rows using its "!HEADER" lines for column names. */
export function parseIif(text: string): IifRow[] {
  const headers = new Map<string, string[]>();
  const rows: IifRow[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const cells = raw.split("\t").map(unquote);
    const first = cells[0];
    if (first.startsWith("!")) {
      headers.set(first.slice(1).toUpperCase(), cells.slice(1).map((c) => c.toUpperCase()));
      continue;
    }
    const type = first.toUpperCase();
    const cols = headers.get(type);
    if (!cols) continue;
    const fields: Record<string, string> = {};
    cols.forEach((c, i) => { fields[c] = cells[i + 1] ?? ""; });
    rows.push({ type, fields });
  }
  return rows;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/""/g, '"');
  return t;
}

// QuickBooks account type -> this app's account type
const QB_TYPE_MAP: Record<string, string> = {
  BANK: "bank",
  CCARD: "credit_card",
  AR: "other_asset",
  OCASSET: "other_asset",
  OASSET: "other_asset",
  FIXASSET: "fixed_asset",
  AP: "liability",
  OCLIAB: "liability",
  LTLIAB: "liability",
  EQUITY: "equity",
  INC: "income",
  EXINC: "income",
  COGS: "cogs",
  EXP: "expense",
  EXEXP: "expense",
};

export type QbAccount = { qbName: string; type: string; qbType: string; hidden: boolean; accountNumber?: string; description?: string };
export type QbNameEntry = { name: string; listType: "vendor" | "customer" | "other" | "employee"; is1099: boolean };

export type QbLists = { accounts: QbAccount[]; names: QbNameEntry[]; skipped: string[] };

/** Pull the chart of accounts and name lists out of a QuickBooks list export. */
export function readQbLists(text: string): QbLists {
  const accounts: QbAccount[] = [];
  const names: QbNameEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const r of parseIif(text)) {
    const f = r.fields;
    if (r.type === "ACCNT") {
      const qbType = (f.ACCNTTYPE ?? "").toUpperCase();
      const type = QB_TYPE_MAP[qbType];
      if (!f.NAME) continue;
      if (!type) { skipped.push(`${f.NAME} (${qbType || "no type"})`); continue; }
      accounts.push({
        qbName: f.NAME, type, qbType,
        hidden: (f.HIDDEN ?? "").toUpperCase() === "Y",
        accountNumber: f.ACCNUM || undefined,
        description: f.DESC || undefined,
      });
    } else if (r.type === "VEND" || r.type === "CUST" || r.type === "OTHERNAME" || r.type === "EMP") {
      const name = f.NAME;
      if (!name || seen.has(name.toLowerCase())) continue;
      if ((f.HIDDEN ?? "").toUpperCase() === "Y") continue;
      seen.add(name.toLowerCase());
      const listType = r.type === "VEND" ? "vendor" : r.type === "CUST" ? "customer" : r.type === "EMP" ? "employee" : "other";
      names.push({ name, listType, is1099: (f["1099"] ?? "").toUpperCase() === "Y" });
    }
  }
  return { accounts, names, skipped };
}

// ---- export -----------------------------------------------------------------

/** One side of an exported transaction, already resolved to QuickBooks names. */
export type IifLine = { account: string; amount: number; memo?: string; name?: string; cleared?: boolean };

export type IifTxn = {
  ref: string; // our transaction id, used only for error messages
  trnsType: "CHECK" | "DEPOSIT" | "CREDIT CARD" | "CCARD REFUND" | "TRANSFER" | "GENERAL JOURNAL";
  date: Date;
  docNum?: string;
  name?: string;
  memo?: string;
  head: IifLine; // TRNS line (the bank / card side)
  splits: IifLine[]; // SPL lines; head.amount + sum(splits) must be 0
};

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** QuickBooks 2016 reads IIF as plain ANSI text: no tabs, line breaks, or fancy characters inside a field. */
export function cleanField(s: string | undefined | null, max = 4000): string {
  if (!s) return "";
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // é -> e
    .replace(/[‘’]/g, "'").replace(/[“”]/g, "'").replace(/"/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, max);
}

export function iifDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export function txnBalances(t: IifTxn): boolean {
  return Math.abs(r2(t.head.amount + t.splits.reduce((s, l) => s + l.amount, 0))) < 0.005;
}

/**
 * Build the IIF text. Throws if any transaction doesn't balance; nothing
 * unbalanced ever reaches QuickBooks.
 */
export function buildIif(txns: IifTxn[]): string {
  const out: string[] = [
    ["!TRNS", "TRNSID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "CLEAR"].join("\t"),
    ["!SPL", "SPLID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "CLEAR"].join("\t"),
    "!ENDTRNS",
  ];
  for (const t of txns) {
    if (!txnBalances(t)) throw new Error(`Transaction ${t.ref} does not balance; export stopped.`);
    const date = iifDate(t.date);
    const doc = cleanField(t.docNum, 11);
    const line = (kind: "TRNS" | "SPL", l: IifLine) =>
      [
        kind, "", t.trnsType, date,
        cleanField(l.account, 159),
        cleanField(l.name ?? (kind === "TRNS" ? t.name : undefined), 41),
        r2(l.amount).toFixed(2),
        doc,
        cleanField(l.memo ?? t.memo, 4000),
        l.cleared ? "Y" : "N",
      ].join("\t");
    out.push(line("TRNS", t.head));
    for (const s of t.splits) out.push(line("SPL", s));
    out.push("ENDTRNS");
  }
  return out.join("\r\n") + "\r\n";
}

// ---- shaping a ledger transaction into a QuickBooks transaction ------------------

export type ExportAccount = { id: string; qbName: string | null; type: string };

export type ExportSource = {
  id: string;
  date: Date;
  amount: number;
  flow: string; // in | out relative to register
  kind: string; // standard | transfer
  registerAccountId: string;
  accountId: string | null;
  transferAccountId: string | null;
  splits: { accountId: string; amount: number; memo: string | null }[];
  payee: string | null; // already validated against QuickBooks names, else null
  checkNum: string | null;
  memo: string | null;
  clearedOn: Set<string>; // register account ids where this is reconciled
};

export type ShapeResult = { ok: true; txn: IifTxn } | { ok: false; problem: string };

/**
 * Turn one of our transactions into the QuickBooks transaction a bookkeeper
 * would have typed in by hand:
 *   bank out -> Check          bank in -> Deposit
 *   card out -> Credit Card    card in -> Credit Card Refund
 *   bank <-> bank              -> Transfer
 *   bank -> card / loan / owner -> Check written to that account (how QuickBooks records a card payment)
 */
export function shapeForQb(src: ExportSource, accounts: Map<string, ExportAccount>): ShapeResult {
  const reg = accounts.get(src.registerAccountId);
  if (!reg) return { ok: false, problem: "its bank or card account is missing" };
  const need = (id: string | null | undefined, what: string): string | { problem: string } => {
    const a = id ? accounts.get(id) : undefined;
    if (!a) return { problem: `${what} is not set` };
    if (!a.qbName) return { problem: `${what} is not linked to a QuickBooks account` };
    return a.qbName;
  };
  const regName = need(reg.id, "the bank/card account");
  if (typeof regName !== "string") return { ok: false, problem: regName.problem };

  const sign = src.flow === "in" ? 1 : -1;
  const memo = src.memo ?? undefined;
  const cleared = (id: string) => src.clearedOn.has(id);

  if (src.kind === "transfer") {
    const other = src.transferAccountId ? accounts.get(src.transferAccountId) : undefined;
    const otherName = need(src.transferAccountId, "the transfer account");
    if (typeof otherName !== "string" || !other) return { ok: false, problem: typeof otherName === "string" ? "transfer account missing" : otherName.problem };
    // Always write it from the bank's point of view when a bank is involved.
    let bank = reg, bankName = regName, far = other, farName = otherName, bankSign = sign;
    if (reg.type !== "bank" && other.type === "bank") {
      bank = other; bankName = otherName; far = reg; farName = regName; bankSign = -sign;
    }
    const head: IifLine = { account: bankName, amount: r2(bankSign * src.amount), cleared: cleared(bank.id) };
    const spl: IifLine = { account: farName, amount: r2(-bankSign * src.amount), cleared: cleared(far.id) };
    let trnsType: IifTxn["trnsType"];
    if (bank.type === "bank" && far.type === "bank") trnsType = "TRANSFER";
    else if (bank.type === "bank") trnsType = bankSign < 0 ? "CHECK" : "DEPOSIT";
    else trnsType = "GENERAL JOURNAL";
    return { ok: true, txn: { ref: src.id, trnsType, date: src.date, docNum: src.checkNum ?? undefined, name: src.payee ?? undefined, memo, head, splits: [spl] } };
  }

  const lines = src.splits.length > 0
    ? src.splits
    : [{ accountId: src.accountId ?? "", amount: src.amount, memo: null as string | null }];
  const splits: IifLine[] = [];
  for (const l of lines) {
    const n = need(l.accountId, "a category");
    if (typeof n !== "string") return { ok: false, problem: n.problem };
    splits.push({ account: n, amount: r2(-sign * l.amount), memo: l.memo ?? undefined, cleared: cleared(l.accountId) });
  }
  const head: IifLine = { account: regName, amount: r2(sign * src.amount), cleared: cleared(reg.id) };
  let trnsType: IifTxn["trnsType"];
  if (reg.type === "bank") trnsType = sign < 0 ? "CHECK" : "DEPOSIT";
  else if (reg.type === "credit_card") trnsType = sign < 0 ? "CREDIT CARD" : "CCARD REFUND";
  else trnsType = "GENERAL JOURNAL";
  return { ok: true, txn: { ref: src.id, trnsType, date: src.date, docNum: src.checkNum ?? undefined, name: src.payee ?? undefined, memo, head, splits } };
}
