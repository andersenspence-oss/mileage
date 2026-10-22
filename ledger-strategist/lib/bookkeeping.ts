// Bookkeeping operations against the database: categorizing, transfers,
// splits, bank imports, reconciliation, payroll, and QuickBooks 2016 export.
// The money math itself lives in pure modules (ledger, bankImport, iif) so it
// can be unit-tested; this file wires it to storage and enforces the rules
// that keep the books trustworthy:
//   - reconciled transactions can't have their amount, date, or account changed
//   - nothing is exported to QuickBooks twice
//   - nothing unbalanced is ever exported
import { prisma } from "./db";
import {
  postings, registerRows, reconcileMath, splitsBalance, displayBalance, countsForRegister,
  REGISTER_TYPES, PL_TYPES, type LedgerTxn, type LedgerAccount,
} from "./ledger";
import {
  parseCsv, guessMapping, normalizeRows, fingerprints, cleanVendor, pickMatch,
  type CsvMapping, type BankRow, type RowError, type MatchCandidate,
} from "./bankImport";
import { shapeForQb, buildIif, readQbLists, type ExportAccount, type IifTxn } from "./iif";
import { LEDGER_TXN_SELECT, toTxnLite } from "./reportData";
import { asLedger } from "./reports";
import { ruleSuggest, claudeSuggest, type Suggestion, type VendorHistory } from "./categorize";
import { claudeAvailable } from "./claude";

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const DAY = 86400000;

export class BookError extends Error {}

// ---- lookups ------------------------------------------------------------------------

export async function activeEntities() {
  return prisma.entity.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });
}

export async function registers(entityIds?: string[]) {
  return prisma.account.findMany({
    where: { type: { in: ["bank", "credit_card"] }, archived: false, ...(entityIds ? { entityId: { in: entityIds } } : {}) },
    include: { entity: true },
    orderBy: [{ entity: { sort: "asc" } }, { type: "asc" }, { name: "asc" }],
  });
}

/** Accounts a transaction can be assigned to, grouped for a picker. */
export async function pickerAccounts(entityId: string) {
  const accts = await prisma.account.findMany({ where: { entityId, archived: false }, orderBy: { name: "asc" } });
  const group = (types: string[]) => accts.filter((a) => types.includes(a.type));
  return {
    all: accts,
    groups: [
      { label: "Income", accounts: group(["income"]) },
      { label: "Expenses", accounts: group(["expense"]) },
      { label: "Cost of goods sold", accounts: group(["cogs"]) },
      { label: "Transfer to/from (bank and card accounts)", accounts: group(["bank", "credit_card"]) },
      { label: "Loans, equipment, owner (balance sheet)", accounts: group(["liability", "equity", "fixed_asset", "other_asset"]) },
    ].filter((g) => g.accounts.length > 0),
  };
}

type TxnWithClears = { clears: { reconciliationId: string | null; reconciliation?: { status: string } | null }[] };
/** A transaction is locked once it is part of a finished reconciliation. */
export function isLocked(t: TxnWithClears): boolean {
  return t.clears.some((c) => c.reconciliationId && c.reconciliation?.status === "finished");
}

async function loadTxn(id: string) {
  const t = await prisma.transaction.findUnique({
    where: { id },
    include: { entity: true, registerAccount: true, splits: true, clears: { include: { reconciliation: true } } },
  });
  if (!t) throw new BookError("That transaction no longer exists.");
  return t;
}

function markEditedAfterExport(t: { qbStatus: string }) {
  return t.qbStatus === "exported" ? { changedAfterExport: true } : {};
}

// ---- categorizing ----------------------------------------------------------------------

/** Learn "this vendor -> this account" for this entity. */
export async function learnRule(entitySlug: string, vendor: string | null, accountName: string, payeeName?: string | null) {
  const v = (vendor ?? "").trim();
  if (!v) return;
  const existing = await prisma.vendorRule.findFirst({ where: { vendorPattern: v, entitySlug } });
  if (existing) {
    await prisma.vendorRule.update({
      where: { id: existing.id },
      data: {
        accountName,
        hits: existing.accountName === accountName ? existing.hits + 1 : 1,
        ...(payeeName !== undefined ? { payeeName } : {}),
      },
    });
  } else {
    await prisma.vendorRule.create({ data: { vendorPattern: v, accountName, entitySlug, payeeName: payeeName ?? null } });
  }
}

/**
 * Put a transaction in a category. Picking a bank or credit card account
 * makes it a transfer (card payment, moving money between accounts).
 */
export async function applyCategory(txnId: string, accountId: string, opts: { learn?: boolean; suggestion?: "approved" | "edited" } = {}) {
  const t = await loadTxn(txnId);
  const acc = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acc || acc.entityId !== t.entityId) throw new BookError("That account belongs to a different entity.");
  if (REGISTER_TYPES.has(acc.type)) return setTransfer(txnId, accountId, opts);
  await prisma.$transaction([
    prisma.txnSplit.deleteMany({ where: { transactionId: t.id } }),
    prisma.transaction.update({
      where: { id: t.id },
      data: { accountId: acc.id, kind: "standard", transferAccountId: null, categoryStatus: "approved", ...markEditedAfterExport(t) },
    }),
    prisma.categorySuggestion.updateMany({ where: { transactionId: t.id, status: "pending" }, data: { status: opts.suggestion ?? "edited" } }),
  ]);
  if (opts.learn !== false) await learnRule(t.entity.slug, t.vendor, acc.name);
  return { merged: false as boolean, warning: null as string | null };
}

/**
 * Record a transaction as a transfer to another bank/card account. If the
 * other account's download already brought in the other half of the same
 * transfer (the "Payment - Thank you" line on the card), the two are merged
 * into one so it isn't counted or exported twice.
 */
export async function setTransfer(txnId: string, otherAccountId: string, opts: { learn?: boolean; suggestion?: "approved" | "edited" } = {}) {
  const t = await loadTxn(txnId);
  if (!t.registerAccountId) throw new BookError("This transaction isn't in a bank or card account.");
  if (otherAccountId === t.registerAccountId) throw new BookError("A transfer needs two different accounts.");
  const other = await prisma.account.findUnique({ where: { id: otherAccountId } });
  if (!other || other.entityId !== t.entityId) throw new BookError("That account belongs to a different entity.");

  await prisma.$transaction([
    prisma.txnSplit.deleteMany({ where: { transactionId: t.id } }),
    prisma.transaction.update({
      where: { id: t.id },
      data: { kind: "transfer", transferAccountId: other.id, accountId: null, categoryStatus: "approved", ...markEditedAfterExport(t) },
    }),
    prisma.categorySuggestion.updateMany({ where: { transactionId: t.id, status: "pending" }, data: { status: opts.suggestion ?? "edited" } }),
  ]);
  if (opts.learn !== false) await learnRule(t.entity.slug, t.vendor, other.name);

  // look for the other half: same amount, opposite direction, in the other account, within a week
  const oppositeFlow = t.flow === "out" ? "in" : "out";
  const candidates = await prisma.transaction.findMany({
    where: {
      id: { not: t.id }, entityId: t.entityId, registerAccountId: other.id, flow: oppositeFlow,
      amount: { gte: t.amount - 0.004, lte: t.amount + 0.004 },
      date: { gte: new Date(t.date.getTime() - 7 * DAY), lte: new Date(t.date.getTime() + 7 * DAY) },
      origin: { not: "demo" },
      OR: [{ categoryStatus: { in: ["uncategorized", "suggested"] } }, { kind: "transfer", transferAccountId: t.registerAccountId }],
    },
    include: { clears: { include: { reconciliation: true } } },
    orderBy: { date: "asc" },
  });
  const c = candidates.sort((a, b) => Math.abs(a.date.getTime() - t.date.getTime()) - Math.abs(b.date.getTime() - t.date.getTime()))[0];
  if (!c) return { merged: false, warning: null };
  if (isLocked(c) || c.qbStatus === "exported") {
    return { merged: false, warning: `The other side of this transfer (${c.date.toLocaleDateString()}) is already reconciled or sent to QuickBooks; check it isn't counted twice.` };
  }
  const cClear = c.clears.find((x) => x.accountId === other.id);
  await prisma.$transaction(async (tx) => {
    if (cClear) {
      await tx.txnClear.upsert({
        where: { transactionId_accountId: { transactionId: t.id, accountId: other.id } },
        update: { importFingerprint: cClear.importFingerprint, bankDescription: cClear.bankDescription, cleared: cClear.cleared },
        create: { transactionId: t.id, accountId: other.id, importFingerprint: cClear.importFingerprint, bankDescription: cClear.bankDescription, cleared: cClear.cleared },
      });
    }
    await tx.transaction.delete({ where: { id: c.id } });
  });
  return { merged: true, warning: null };
}

export type SplitInput = { accountId: string; amount: number; memo?: string };

/** Split one transaction across several categories. Must add up to the penny. */
export async function saveSplits(txnId: string, lines: SplitInput[]) {
  const t = await loadTxn(txnId);
  const clean = lines.filter((l) => l.accountId && l.amount !== 0);
  if (clean.length === 0) throw new BookError("Add at least one split line.");
  if (!splitsBalance({ amount: t.amount, splits: clean })) {
    const sum = r2(clean.reduce((s, l) => s + l.amount, 0));
    throw new BookError(`The splits add up to $${sum.toFixed(2)} but the transaction is $${t.amount.toFixed(2)} (off by $${r2(t.amount - sum).toFixed(2)}).`);
  }
  const accts = await prisma.account.findMany({ where: { id: { in: clean.map((l) => l.accountId) } } });
  if (accts.some((a) => a.entityId !== t.entityId)) throw new BookError("A split uses an account from a different entity.");
  if (accts.some((a) => REGISTER_TYPES.has(a.type))) throw new BookError("Splits can't go to a bank or card account; record that part as its own transfer.");
  if (clean.length === 1) return applyCategory(txnId, clean[0].accountId);
  await prisma.$transaction([
    prisma.txnSplit.deleteMany({ where: { transactionId: t.id } }),
    prisma.txnSplit.createMany({ data: clean.map((l, i) => ({ transactionId: t.id, accountId: l.accountId, amount: r2(l.amount), memo: l.memo || null, sort: i })) }),
    prisma.transaction.update({ where: { id: t.id }, data: { accountId: null, kind: "standard", transferAccountId: null, categoryStatus: "approved", ...markEditedAfterExport(t) } }),
    prisma.categorySuggestion.updateMany({ where: { transactionId: t.id, status: "pending" }, data: { status: "edited" } }),
  ]);
  return { merged: false, warning: null };
}

export type TxnEdit = {
  date?: Date; amount?: number; flow?: "in" | "out"; payee?: string | null; checkNum?: string | null;
  memo?: string | null; vendor?: string | null;
};

/** Edit the details of a transaction; reconciled ones keep their date and amount. */
export async function editTxn(txnId: string, e: TxnEdit) {
  const t = await loadTxn(txnId);
  const moneyChange =
    (e.date && e.date.getTime() !== t.date.getTime()) ||
    (e.amount !== undefined && r2(e.amount) !== r2(t.amount)) ||
    (e.flow && e.flow !== t.flow);
  if (moneyChange && isLocked(t)) throw new BookError("This transaction is reconciled. Its date and amount match the bank statement and can't be changed. Undo that reconciliation first if it's truly wrong.");
  if (e.amount !== undefined && !(e.amount > 0)) throw new BookError("Amount must be more than zero.");
  if (moneyChange && t.splits.length > 0 && e.amount !== undefined && r2(e.amount) !== r2(t.amount)) {
    throw new BookError("This transaction is split. Change the split lines along with the amount (remove the split first).");
  }
  await prisma.transaction.update({
    where: { id: t.id },
    data: {
      ...(e.date ? { date: e.date } : {}),
      ...(e.amount !== undefined ? { amount: r2(e.amount) } : {}),
      ...(e.flow ? { flow: e.flow } : {}),
      ...(e.payee !== undefined ? { payee: e.payee || null } : {}),
      ...(e.checkNum !== undefined ? { checkNum: e.checkNum || null } : {}),
      ...(e.memo !== undefined ? { memo: e.memo || null } : {}),
      ...(e.vendor !== undefined ? { vendor: e.vendor || null } : {}),
      ...markEditedAfterExport(t),
    },
  });
}

export async function deleteTxn(txnId: string) {
  const t = await loadTxn(txnId);
  if (isLocked(t)) throw new BookError("This transaction is reconciled and can't be deleted. Undo that reconciliation first.");
  if (t.qbStatus === "exported") throw new BookError("This transaction was already sent to QuickBooks. Delete it in QuickBooks, or undo that export batch first.");
  // Note: deleting a line that came from a bank download frees its fingerprint, so
  // downloading those dates again brings it back. That's the honest outcome: the bank
  // says it happened. To keep something out of the books, categorize it instead.
  await prisma.transaction.delete({ where: { id: t.id } });
}

export type ManualEntry = {
  entityId: string;
  registerAccountId: string;
  date: Date;
  amount: number;
  flow: "in" | "out";
  payee?: string | null;
  checkNum?: string | null;
  memo?: string | null;
  categoryAccountId?: string | null; // a category, or a bank/card account for a transfer
  origin?: string;
  payrollRunId?: string | null;
  splits?: SplitInput[];
};

/** Add a check, deposit, charge, or transfer by hand. The bank download will match it later. */
export async function addManual(m: ManualEntry) {
  const reg = await prisma.account.findUnique({ where: { id: m.registerAccountId } });
  if (!reg || !REGISTER_TYPES.has(reg.type) || reg.entityId !== m.entityId) throw new BookError("Pick the bank or card account this went through.");
  if (!(m.amount > 0)) throw new BookError("Amount must be more than zero.");
  const qbStatus = reg.startDate && m.date <= reg.startDate ? "in_qb" : "pending";
  const t = await prisma.transaction.create({
    data: {
      entityId: m.entityId, registerAccountId: reg.id, date: m.date, amount: r2(m.amount), flow: m.flow,
      vendor: m.payee || null, payee: m.payee || null, description: m.memo || (m.checkNum ? `Check ${m.checkNum}` : null),
      checkNum: m.checkNum || null, memo: m.memo || null, origin: m.origin ?? "manual",
      payrollRunId: m.payrollRunId ?? null, categoryStatus: "uncategorized", source: "manual", qbStatus,
    },
  });
  if (m.splits && m.splits.length > 1) await saveSplits(t.id, m.splits);
  else if (m.splits && m.splits.length === 1) await applyCategory(t.id, m.splits[0].accountId, { learn: false });
  else if (m.categoryAccountId) await applyCategory(t.id, m.categoryAccountId, { learn: false });
  return t.id;
}

// ---- suggestions ------------------------------------------------------------------------------

/**
 * Suggest categories for uncategorized transactions: this entity's learned
 * rules first, then this entity's own history, then Claude (if a key is set)
 * choosing only from this entity's chart of accounts. Nothing is applied.
 */
export async function generateSuggestions(opts: { entityIds?: string[]; useClaude?: boolean } = {}) {
  const ents = await prisma.entity.findMany({ where: { status: "active", ...(opts.entityIds ? { id: { in: opts.entityIds } } : {}) } });
  let made = 0;
  let claudeUsed = false;
  for (const e of ents) {
    const pending = await prisma.transaction.findMany({
      where: { entityId: e.id, categoryStatus: "uncategorized" },
      orderBy: { date: "desc" }, take: 200,
    });
    if (pending.length === 0) continue;
    const accounts = await prisma.account.findMany({ where: { entityId: e.id, archived: false } });
    const nameSet = new Set(accounts.map((a) => a.name));
    const rules = (await prisma.vendorRule.findMany({ where: { OR: [{ entitySlug: e.slug }, { entitySlug: null }] }, orderBy: { hits: "desc" } }))
      .filter((r) => nameSet.has(r.accountName))
      .sort((a, b) => (a.entitySlug ? 0 : 1) - (b.entitySlug ? 0 : 1));
    const done = await prisma.transaction.findMany({
      where: { entityId: e.id, categoryStatus: { in: ["categorized", "approved"] }, vendor: { not: null }, accountId: { not: null } },
      select: { vendor: true, account: { select: { name: true } } },
    });
    const counts = new Map<string, Map<string, number>>();
    for (const t of done) {
      const v = t.vendor!.toLowerCase().trim();
      const m = counts.get(v) ?? counts.set(v, new Map()).get(v)!;
      m.set(t.account!.name, (m.get(t.account!.name) ?? 0) + 1);
    }
    const history: VendorHistory = new Map();
    for (const [v, m] of counts) {
      const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      history.set(v, { accountName: best[0], count: best[1] });
    }
    const suggestions: Suggestion[] = [];
    const rest: typeof pending = [];
    for (const t of pending) {
      const s = ruleSuggest({ id: t.id, vendor: t.vendor, description: t.description, amount: t.amount, date: t.date, entityName: e.name, entityKind: e.kind }, rules, history);
      if (s) suggestions.push(s); else rest.push(t);
    }
    if (rest.length && opts.useClaude !== false && claudeAvailable()) {
      const names = accounts.filter((a) => PL_TYPES.has(a.type) || REGISTER_TYPES.has(a.type) || ["liability", "equity"].includes(a.type)).map((a) => a.name);
      try {
        suggestions.push(...(await claudeSuggest(rest.slice(0, 50).map((t) => ({
          id: t.id, vendor: t.vendor, description: [t.description, t.flow === "in" ? "(money in)" : "(money out)"].filter(Boolean).join(" "),
          amount: t.amount, date: t.date, entityName: e.name, entityKind: e.kind,
        })), names)));
        claudeUsed = true;
      } catch { /* rules-only is still useful */ }
    }
    for (const s of suggestions) {
      await prisma.categorySuggestion.deleteMany({ where: { transactionId: s.transactionId, status: "pending" } });
      await prisma.categorySuggestion.create({ data: { transactionId: s.transactionId, suggestedAccountName: s.suggestedAccountName, confidence: s.confidence, rationale: s.rationale, source: s.source } });
      await prisma.transaction.update({ where: { id: s.transactionId }, data: { categoryStatus: "suggested" } });
      made++;
    }
  }
  return { made, claudeUsed };
}

/** Approve the pending suggestion on one transaction. */
export async function approveSuggestion(txnId: string) {
  const t = await prisma.transaction.findUnique({
    where: { id: txnId },
    include: { suggestions: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const s = t?.suggestions[0];
  if (!t || !s) throw new BookError("There's no suggestion on that transaction to approve.");
  const acc = await prisma.account.findFirst({ where: { entityId: t.entityId, name: s.suggestedAccountName, archived: false } });
  if (!acc) throw new BookError(`"${s.suggestedAccountName}" isn't in this entity's chart of accounts. Pick a category instead.`);
  return applyCategory(txnId, acc.id, { suggestion: "approved" });
}

/** One click: approve every suggestion at or above a confidence level. */
export async function approveConfident(minConfidence: number, entityIds?: string[]) {
  const list = await prisma.transaction.findMany({
    where: {
      categoryStatus: "suggested",
      ...(entityIds ? { entityId: { in: entityIds } } : {}),
      suggestions: { some: { status: "pending", confidence: { gte: minConfidence } } },
    },
    select: { id: true },
  });
  let ok = 0;
  for (const t of list) {
    try { await approveSuggestion(t.id); ok++; } catch { /* left in the queue */ }
  }
  return ok;
}

// ---- bank and card imports ------------------------------------------------------------------

export type ImportPreview = {
  mapping: CsvMapping;
  header: string[];
  rows: (BankRow & { status: "new" | "duplicate" | "match" | "before_go_live"; matchNote?: string })[];
  errors: RowError[];
  counts: { new: number; duplicate: number; match: number; beforeGoLive: number };
};

/** Entries already in the books that a bank line could be the bank's record of. */
async function matchCandidates(accountId: string): Promise<(MatchCandidate & { label: string })[]> {
  const txns = await prisma.transaction.findMany({
    where: { OR: [{ registerAccountId: accountId }, { transferAccountId: accountId }], origin: { not: "demo" } },
    select: { ...LEDGER_TXN_SELECT, checkNum: true, payee: true, vendor: true, clears: { where: { accountId }, select: { importFingerprint: true } } },
  });
  const out: (MatchCandidate & { label: string })[] = [];
  for (const t of txns) {
    if (t.clears.some((c) => c.importFingerprint)) continue; // already matched to a bank line here
    const p = postings(asLedger([toTxnLite(t)], [])[0]).find((x) => x.accountId === accountId);
    if (!p) continue;
    out.push({ txnId: t.id, date: t.date, amount: p.amount, checkNum: t.checkNum, label: t.payee || t.vendor || "entry" });
  }
  return out;
}

export async function previewImport(batchId: string, mapping?: CsvMapping): Promise<ImportPreview> {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const reg = await prisma.account.findUniqueOrThrow({ where: { id: batch.registerAccountId } });
  const raw = parseCsv(batch.rawCsv);
  const saved = batch.mappingJson ? (JSON.parse(batch.mappingJson) as CsvMapping) : reg.csvProfileJson ? (JSON.parse(reg.csvProfileJson) as CsvMapping) : null;
  const m = mapping ?? saved ?? guessMapping(raw, reg.type as "bank" | "credit_card");
  const { rows, errors } = normalizeRows(raw, m);
  const fps = fingerprints(rows);
  const existing = new Set(
    (await prisma.txnClear.findMany({ where: { accountId: reg.id, importFingerprint: { in: fps } }, select: { importFingerprint: true } }))
      .map((c) => c.importFingerprint!)
  );
  const cands = await matchCandidates(reg.id);
  const used = new Set<string>();
  const counts = { new: 0, duplicate: 0, match: 0, beforeGoLive: 0 };
  const out = rows.map((r, i) => {
    if (existing.has(fps[i])) { counts.duplicate++; return { ...r, status: "duplicate" as const }; }
    const pick = pickMatch(r, cands.filter((c) => !used.has(c.txnId)));
    if (pick) {
      used.add(pick.txnId);
      counts.match++;
      return { ...r, status: "match" as const, matchNote: `matches ${(pick as { label?: string }).label ?? "an entry"} already entered on ${pick.date.toLocaleDateString()}` };
    }
    if (reg.startDate && r.date <= reg.startDate) { counts.beforeGoLive++; return { ...r, status: "before_go_live" as const }; }
    counts.new++;
    return { ...r, status: "new" as const };
  });
  const header = m.headerRow >= 0 ? raw[m.headerRow] : (raw[0] ?? []).map((_, i) => `Column ${i + 1}`);
  return { mapping: m, header, rows: out, errors, counts };
}

/**
 * Bring the bank lines into the books: skip ones already imported, attach
 * ones that match an entry already typed in, add the rest as new
 * transactions waiting for a category. Lines dated on or before the
 * account's go-live date come in as history only (already in QuickBooks).
 */
export async function commitImport(batchId: string, mapping: CsvMapping) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status !== "preview") throw new BookError("This file was already imported.");
  const reg = await prisma.account.findUniqueOrThrow({ where: { id: batch.registerAccountId }, include: { entity: true } });
  const raw = parseCsv(batch.rawCsv);
  const { rows } = normalizeRows(raw, mapping);
  const fps = fingerprints(rows);
  const existing = new Set(
    (await prisma.txnClear.findMany({ where: { accountId: reg.id, importFingerprint: { in: fps } }, select: { importFingerprint: true } }))
      .map((c) => c.importFingerprint!)
  );
  const cands = await matchCandidates(reg.id);
  const used = new Set<string>();
  const rules = await prisma.vendorRule.findMany({ where: { OR: [{ entitySlug: reg.entity.slug }, { entitySlug: null }], payeeName: { not: null } } });
  let added = 0, matched = 0, duplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (existing.has(fps[i])) { duplicates++; continue; }
    existing.add(fps[i]);
    const pick = pickMatch(r, cands.filter((c) => !used.has(c.txnId)));
    if (pick) {
      used.add(pick.txnId);
      await prisma.txnClear.upsert({
        where: { transactionId_accountId: { transactionId: pick.txnId, accountId: reg.id } },
        update: { importFingerprint: fps[i], bankDescription: r.description },
        create: { transactionId: pick.txnId, accountId: reg.id, importFingerprint: fps[i], bankDescription: r.description },
      });
      matched++;
      continue;
    }
    const vendor = cleanVendor(r.description);
    const payeeRule = rules.find((x) => vendor.toLowerCase().includes(x.vendorPattern.toLowerCase()));
    await prisma.transaction.create({
      data: {
        entityId: reg.entityId, registerAccountId: reg.id, date: r.date, amount: Math.abs(r.amount), flow: r.amount > 0 ? "in" : "out",
        vendor, description: r.description, payee: payeeRule?.payeeName ?? null, checkNum: r.checkNum, memo: r.memo,
        origin: "import", source: "bank", categoryStatus: "uncategorized",
        qbStatus: reg.startDate && r.date <= reg.startDate ? "in_qb" : "pending",
        clears: { create: { accountId: reg.id, importFingerprint: fps[i], bankDescription: r.description } },
      },
    });
    added++;
  }
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "imported", added, matched, duplicates, mappingJson: JSON.stringify(mapping) } });
  await prisma.account.update({ where: { id: reg.id }, data: { csvProfileJson: JSON.stringify(mapping) } });
  if (added > 0) await generateSuggestions({ entityIds: [reg.entityId] });
  return { added, matched, duplicates };
}

// ---- registers --------------------------------------------------------------------------------

export async function registerView(accountId: string) {
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, include: { entity: true } });
  const txns = await prisma.transaction.findMany({
    where: { OR: [{ registerAccountId: accountId }, { transferAccountId: accountId }] },
    include: {
      account: true, transferAccount: true, registerAccount: true, splits: { include: { account: true } },
      clears: { include: { reconciliation: true } },
    },
  });
  const ledger = asLedger(txns.map((t) => toTxnLite({ ...t, splits: t.splits })), []);
  const rows = registerRows(acc as LedgerAccount, ledger);
  const byId = new Map(txns.map((t) => [t.id, t]));
  return {
    account: acc,
    rows: rows.map((r) => {
      const t = byId.get(r.txnId)!;
      const clear = t.clears.find((c) => c.accountId === accountId);
      return { ...r, txn: t, cleared: !!clear?.cleared, reconciled: clear?.reconciliation?.status === "finished", fromBank: !!clear?.importFingerprint };
    }),
    balance: rows.length ? rows[rows.length - 1].balance : acc.openingBalance,
    preGoLiveCount: txns.filter((t) => !countsForRegister(acc as LedgerAccount, t.date)).length,
  };
}

// ---- reconciliation --------------------------------------------------------------------------

export async function lastFinishedRecon(accountId: string) {
  return prisma.reconciliation.findFirst({ where: { registerAccountId: accountId, status: "finished" }, orderBy: { statementDate: "desc" } });
}

export async function startRecon(accountId: string, statementDate: Date, endingBalance: number) {
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!REGISTER_TYPES.has(acc.type)) throw new BookError("Only bank and credit card accounts are reconciled.");
  const open = await prisma.reconciliation.findFirst({ where: { registerAccountId: accountId, status: "in_progress" } });
  if (open) return open;
  const last = await lastFinishedRecon(accountId);
  if (last && statementDate <= last.statementDate) throw new BookError(`This account is already reconciled through ${last.statementDate.toLocaleDateString()}. Pick a later statement date.`);
  if (acc.startDate && statementDate <= acc.startDate) throw new BookError("That statement ends before this account's go-live date.");
  return prisma.reconciliation.create({
    data: { registerAccountId: accountId, statementDate, endingBalance: r2(endingBalance), beginningBalance: last ? last.endingBalance : acc.openingBalance },
  });
}

export async function reconItems(reconId: string) {
  const recon = await prisma.reconciliation.findUniqueOrThrow({ where: { id: reconId } });
  const view = await registerView(recon.registerAccountId);
  const items = view.rows
    .filter((r) => r.date <= recon.statementDate && !r.reconciled)
    .map((r) => {
      const clear = r.txn.clears.find((c) => c.accountId === recon.registerAccountId);
      return {
        key: r.txnId, date: r.date, amount: r.amount,
        cleared: !!clear?.cleared,
        label: r.txn.payee || r.txn.vendor || r.txn.description || "(no description)",
        checkNum: r.txn.checkNum, fromBank: r.fromBank,
      };
    });
  return { recon, account: view.account, items, math: reconcileMath(recon.beginningBalance, recon.endingBalance, items) };
}

/** Save check marks; finish only when the difference is exactly zero. */
export async function saveRecon(reconId: string, clearedKeys: string[], finish: boolean, endingBalance?: number) {
  const recon0 = await prisma.reconciliation.findUniqueOrThrow({ where: { id: reconId } });
  if (recon0.status !== "in_progress") throw new BookError("This reconciliation is already finished.");
  if (endingBalance !== undefined && Number.isFinite(endingBalance)) {
    await prisma.reconciliation.update({ where: { id: reconId }, data: { endingBalance: r2(endingBalance) } });
  }
  const { recon, items } = await reconItems(reconId);
  const set = new Set(clearedKeys);
  for (const it of items) {
    const cleared = set.has(it.key);
    await prisma.txnClear.upsert({
      where: { transactionId_accountId: { transactionId: it.key, accountId: recon.registerAccountId } },
      update: { cleared, reconciliationId: cleared ? recon.id : null },
      create: { transactionId: it.key, accountId: recon.registerAccountId, cleared, reconciliationId: cleared ? recon.id : null },
    });
  }
  const math = reconcileMath(recon.beginningBalance, recon.endingBalance, items.map((i) => ({ ...i, cleared: set.has(i.key) })));
  if (finish) {
    if (!math.balanced) throw new BookError(`Not balanced yet: the difference is $${math.difference.toFixed(2)}. It has to be $0.00 to finish.`);
    await prisma.reconciliation.update({ where: { id: recon.id }, data: { status: "finished", finishedAt: new Date() } });
  }
  return math;
}

/** Undo the most recent finished reconciliation for an account (it reopens for editing). */
export async function undoRecon(reconId: string) {
  const recon = await prisma.reconciliation.findUniqueOrThrow({ where: { id: reconId } });
  const last = await lastFinishedRecon(recon.registerAccountId);
  if (!last || last.id !== recon.id) throw new BookError("Only the most recent reconciliation can be undone.");
  const exported = await prisma.txnClear.count({ where: { reconciliationId: recon.id, transaction: { qbStatus: "exported" } } });
  await prisma.reconciliation.update({ where: { id: recon.id }, data: { status: "in_progress", finishedAt: null } });
  return { exported };
}

export async function discardRecon(reconId: string) {
  const recon = await prisma.reconciliation.findUniqueOrThrow({ where: { id: reconId } });
  if (recon.status !== "in_progress") throw new BookError("Only an unfinished reconciliation can be discarded.");
  await prisma.txnClear.updateMany({ where: { reconciliationId: recon.id }, data: { reconciliationId: null, cleared: false } });
  await prisma.reconciliation.delete({ where: { id: recon.id } });
}

// ---- payroll ---------------------------------------------------------------------------------------

export type PayrollInput = {
  entityId: string;
  bankAccountId: string;
  payDate: Date;
  wageLines: { accountId: string; amount: number; memo?: string }[]; // gross pay by wage account
  employeeTaxes: number; // federal/state income tax + employee FICA withheld
  otherDeductions: number; // 401(k), HSA, garnishments withheld (paid separately)
  employerTaxes: number; // employer FICA, FUTA, SUTA
  netPay: number; // the direct deposit / check total ADP takes from the bank
  liabilityAccountId: string; // e.g. Payroll Liabilities
  employerTaxAccountId: string; // e.g. Payroll Expenses:Taxes
  fee?: number;
  feeAccountId?: string | null;
  payeeName?: string | null;
};

export function payrollCheck(p: Pick<PayrollInput, "wageLines" | "employeeTaxes" | "otherDeductions" | "netPay">) {
  const gross = r2(p.wageLines.reduce((s, l) => s + l.amount, 0));
  const expectedNet = r2(gross - p.employeeTaxes - p.otherDeductions);
  return { gross, expectedNet, difference: r2(p.netPay - expectedNet), ok: Math.abs(p.netPay - expectedNet) < 0.005 };
}

/**
 * Record one ADP payroll as the bank debits ADP actually makes:
 *   1. Net pay:  gross wages, less withholdings held in Payroll Liabilities
 *   2. Taxes:    the withheld taxes (clearing the liability) + employer taxes
 *   3. ADP fee:  if entered
 * When the bank download arrives, these match the ADP lines automatically.
 */
export async function createPayroll(p: PayrollInput) {
  const chk = payrollCheck(p);
  if (chk.gross <= 0) throw new BookError("Enter the gross wages.");
  if (!chk.ok) throw new BookError(`These don't add up: gross $${chk.gross.toFixed(2)} minus withholdings should leave net pay of $${chk.expectedNet.toFixed(2)}, but net pay was entered as $${p.netPay.toFixed(2)} (off by $${chk.difference.toFixed(2)}). Check the numbers against the ADP payroll summary.`);
  const run = await prisma.payrollRun.create({ data: { entityId: p.entityId, bankAccountId: p.bankAccountId, payDate: p.payDate, dataJson: JSON.stringify(p) } });
  const withheld = r2(p.employeeTaxes + p.otherDeductions);
  const ids: string[] = [];
  ids.push(await addManual({
    entityId: p.entityId, registerAccountId: p.bankAccountId, date: p.payDate, amount: p.netPay, flow: "out",
    payee: p.payeeName ?? null, memo: "Payroll: net pay", origin: "payroll", payrollRunId: run.id,
    splits: [
      ...p.wageLines.map((l) => ({ accountId: l.accountId, amount: l.amount, memo: l.memo || "Gross wages" })),
      ...(withheld > 0 ? [{ accountId: p.liabilityAccountId, amount: -withheld, memo: "Withheld from paychecks" }] : []),
    ],
  }));
  const taxDebit = r2(p.employeeTaxes + p.employerTaxes);
  if (taxDebit > 0) {
    ids.push(await addManual({
      entityId: p.entityId, registerAccountId: p.bankAccountId, date: p.payDate, amount: taxDebit, flow: "out",
      payee: p.payeeName ?? null, memo: "Payroll: tax deposit", origin: "payroll", payrollRunId: run.id,
      splits: [
        ...(p.employeeTaxes > 0 ? [{ accountId: p.liabilityAccountId, amount: p.employeeTaxes, memo: "Employee taxes withheld" }] : []),
        ...(p.employerTaxes > 0 ? [{ accountId: p.employerTaxAccountId, amount: p.employerTaxes, memo: "Employer payroll taxes" }] : []),
      ],
    }));
  }
  if (p.fee && p.fee > 0 && p.feeAccountId) {
    ids.push(await addManual({
      entityId: p.entityId, registerAccountId: p.bankAccountId, date: p.payDate, amount: p.fee, flow: "out",
      payee: p.payeeName ?? null, memo: "Payroll: service fee", origin: "payroll", payrollRunId: run.id, categoryAccountId: p.feeAccountId,
    }));
  }
  return { runId: run.id, txnIds: ids, taxDebit };
}

export async function deletePayroll(runId: string) {
  const txns = await prisma.transaction.findMany({ where: { payrollRunId: runId }, include: { clears: { include: { reconciliation: true } } } });
  if (txns.some((t) => isLocked(t) || t.qbStatus === "exported")) throw new BookError("Part of this payroll is reconciled or already sent to QuickBooks, so it can't be deleted here.");
  await prisma.transaction.deleteMany({ where: { payrollRunId: runId } });
  await prisma.payrollRun.delete({ where: { id: runId } });
}

// ---- QuickBooks 2016 bridge --------------------------------------------------------------------------

/**
 * Load the chart of accounts and name lists exported from QuickBooks 2016.
 * Accounts are matched to existing ones by name; new ones are created. Safe
 * to run again any time the QuickBooks lists change.
 */
export async function importQbLists(entityId: string, text: string) {
  const lists = readQbLists(text);
  if (lists.accounts.length === 0) throw new BookError("No accounts were found in that file. In QuickBooks use File > Utilities > Export > Lists to IIF Files and check Chart of Accounts.");
  let created = 0, linked = 0;
  for (const a of lists.accounts) {
    const leaf = a.qbName;
    const existing =
      (await prisma.account.findFirst({ where: { entityId, qbName: a.qbName } })) ??
      (await prisma.account.findFirst({ where: { entityId, name: leaf, fromQb: false } }));
    if (existing) {
      await prisma.account.update({ where: { id: existing.id }, data: { qbName: a.qbName, name: leaf, type: a.type, fromQb: true, archived: a.hidden } });
      linked++;
    } else {
      await prisma.account.create({ data: { entityId, name: leaf, qbName: a.qbName, type: a.type, fromQb: true, archived: a.hidden, openingBalance: 0 } });
      created++;
    }
  }
  let names = 0;
  for (const n of lists.names) {
    await prisma.qbName.upsert({
      where: { entityId_name: { entityId, name: n.name } },
      update: { listType: n.listType, is1099: n.is1099 },
      create: { entityId, name: n.name, listType: n.listType, is1099: n.is1099 },
    });
    names++;
  }
  return { created, linked, names, skipped: lists.skipped };
}

export type ExportProblem = { txnId: string; date: Date; label: string; amount: number; problem: string };

/** Everything ready to go to QuickBooks for one entity, plus anything that's blocking. */
export async function exportPreview(entityId: string, through: Date) {
  const txns = await prisma.transaction.findMany({
    where: { entityId, qbStatus: "pending", origin: { not: "demo" }, date: { lte: through } },
    include: { splits: true, clears: { include: { reconciliation: true } } },
    orderBy: { date: "asc" },
  });
  const accts = await prisma.account.findMany({ where: { entityId } });
  const amap = new Map<string, ExportAccount>(accts.map((a) => [a.id, { id: a.id, qbName: a.fromQb ? a.qbName : null, type: a.type }]));
  const qbNames = new Map((await prisma.qbName.findMany({ where: { entityId } })).map((n) => [n.name.toLowerCase(), n.name]));
  const ready: IifTxn[] = [];
  const readyIds: string[] = [];
  const problems: ExportProblem[] = [];
  let waiting = 0;
  for (const t of txns) {
    const label = t.payee || t.vendor || t.description || "(no description)";
    if (t.categoryStatus !== "approved" && t.categoryStatus !== "categorized") { waiting++; continue; }
    if (!t.registerAccountId) { problems.push({ txnId: t.id, date: t.date, label, amount: t.amount, problem: "not in a bank or card account" }); continue; }
    if (t.kind !== "transfer" && !t.accountId && t.splits.length === 0) { waiting++; continue; }
    const payee = t.payee ? qbNames.get(t.payee.toLowerCase()) ?? null : null;
    const r = shapeForQb({
      id: t.id, date: t.date, amount: t.amount, flow: t.flow, kind: t.kind, registerAccountId: t.registerAccountId,
      accountId: t.accountId, transferAccountId: t.transferAccountId,
      splits: t.splits.sort((a, b) => a.sort - b.sort).map((s) => ({ accountId: s.accountId, amount: s.amount, memo: s.memo })),
      payee, checkNum: t.checkNum,
      memo: [t.memo, !payee && (t.payee || t.vendor) ? (t.payee || t.vendor) : null, t.description && t.description !== t.memo ? t.description : null].filter(Boolean).join(" | ") || null,
      clearedOn: new Set(t.clears.filter((c) => c.reconciliation?.status === "finished").map((c) => c.accountId)),
    }, amap);
    if (!r.ok) { problems.push({ txnId: t.id, date: t.date, label, amount: t.amount, problem: r.problem }); continue; }
    ready.push(r.txn);
    readyIds.push(t.id);
  }
  const total = r2(ready.reduce((s, t) => s + Math.abs(t.head.amount), 0));
  return { ready, readyIds, problems, waiting, total };
}

export async function createExport(entityId: string, through: Date) {
  const pv = await exportPreview(entityId, through);
  if (pv.ready.length === 0) throw new BookError("Nothing is ready to send to QuickBooks yet.");
  const iif = buildIif(pv.ready);
  const batch = await prisma.exportBatch.create({ data: { entityId, throughDate: through, txnCount: pv.ready.length, total: pv.total, iif } });
  await prisma.transaction.updateMany({ where: { id: { in: pv.readyIds } }, data: { qbStatus: "exported", exportBatchId: batch.id, changedAfterExport: false } });
  return batch;
}

/** Only for a file that was NOT imported into QuickBooks: puts its transactions back in line. */
export async function undoExport(batchId: string) {
  const b = await prisma.exportBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (b.status !== "exported") throw new BookError("That export was already undone.");
  await prisma.transaction.updateMany({ where: { exportBatchId: b.id }, data: { qbStatus: "pending", exportBatchId: null } });
  await prisma.exportBatch.update({ where: { id: b.id }, data: { status: "undone" } });
}

// ---- entities --------------------------------------------------------------------------------------

export function slugify(name: string) {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "entity";
}

export async function createEntity(input: { name: string; kind: string; acquiredOn?: Date | null; notes?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new BookError("Give the entity a name.");
  let slug = slugify(name);
  for (let i = 2; await prisma.entity.findUnique({ where: { slug } }); i++) slug = `${slugify(name)}-${i}`;
  const maxSort = (await prisma.entity.aggregate({ _max: { sort: true } }))._max.sort ?? 0;
  return prisma.entity.create({
    data: { name, slug, kind: input.kind || "operating", notes: input.notes || null, acquiredOn: input.acquiredOn ?? null, sort: maxSort + 1, status: "active" },
  });
}

/** Mark an entity sold: its history stays for taxes and reports; it leaves the daily screens. */
export async function sellEntity(entityId: string, soldOn: Date) {
  const pendingExport = await prisma.transaction.count({ where: { entityId, qbStatus: "pending", origin: { not: "demo" }, categoryStatus: { in: ["approved", "categorized"] }, date: { lte: soldOn } } });
  await prisma.entity.update({ where: { id: entityId }, data: { status: "sold", soldOn } });
  return { pendingExport };
}

export async function reactivateEntity(entityId: string) {
  await prisma.entity.update({ where: { id: entityId }, data: { status: "active", soldOn: null } });
}

/** Permanently remove an entity. Only allowed when it holds no real bookkeeping. */
export async function deleteEntity(entityId: string) {
  const real = await prisma.transaction.count({ where: { entityId, origin: { not: "demo" } } });
  if (real > 0) throw new BookError("This entity has real transactions. Mark it sold instead; its history is needed for taxes.");
  await prisma.entity.delete({ where: { id: entityId } });
}

// ---- status for the bookkeeping home ---------------------------------------------------------------

export async function entityStatus(entityId: string) {
  const regs = await prisma.account.findMany({ where: { entityId, type: { in: ["bank", "credit_card"] }, archived: false } });
  const [toCategorize, readyToExport, changedAfterExport, lastExport, qbAccounts] = await Promise.all([
    prisma.transaction.count({ where: { entityId, categoryStatus: { in: ["uncategorized", "suggested"] }, origin: { not: "demo" } } }),
    prisma.transaction.count({ where: { entityId, qbStatus: "pending", origin: { not: "demo" }, categoryStatus: { in: ["approved", "categorized"] } } }),
    prisma.transaction.count({ where: { entityId, changedAfterExport: true } }),
    prisma.exportBatch.findFirst({ where: { entityId, status: "exported" }, orderBy: { createdAt: "desc" } }),
    prisma.account.count({ where: { entityId, fromQb: true } }),
  ]);
  const regStatus = await Promise.all(regs.map(async (r) => {
    const last = await lastFinishedRecon(r.id);
    const lastImport = await prisma.importBatch.findFirst({ where: { registerAccountId: r.id, status: "imported" }, orderBy: { createdAt: "desc" } });
    const open = await prisma.reconciliation.findFirst({ where: { registerAccountId: r.id, status: "in_progress" } });
    return { account: r, lastRecon: last, lastImport, openRecon: open };
  }));
  return { regs: regStatus, toCategorize, readyToExport, changedAfterExport, lastExport, qbAccounts };
}

export { displayBalance };
export type { LedgerTxn };
