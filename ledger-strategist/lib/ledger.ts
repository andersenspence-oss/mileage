// The ledger core. Pure functions, no database access, so the money math is
// directly unit-testable.
//
// Every transaction is turned into balanced postings (double entry):
//   - the register (bank or credit card) the money moved through
//   - the category account(s) it was spent on / earned from, or
//   - for a transfer, the other balance-sheet account
//
// Internally every posting is "debit-positive": an increase to an asset or
// expense is positive; an increase to a liability, equity, or income account
// is negative. Each transaction's postings sum to exactly zero, which is what
// keeps the books (and the QuickBooks IIF export) in balance.

export type AccountType =
  | "income" | "expense" | "cogs" | "bank" | "fixed_asset" | "other_asset"
  | "credit_card" | "liability" | "equity";

export const DEBIT_NORMAL = new Set(["bank", "fixed_asset", "other_asset", "expense", "cogs"]);
export const PL_TYPES = new Set(["income", "expense", "cogs"]);
export const REGISTER_TYPES = new Set(["bank", "credit_card"]);

export type LedgerAccount = {
  id: string;
  name: string;
  type: string;
  openingBalance: number; // shown the "normal" way: positive cash, positive amount owed
  startDate?: Date | null;
};

export type LedgerSplit = { accountId: string; amount: number; memo?: string | null };

export type LedgerTxn = {
  id: string;
  date: Date;
  amount: number; // always positive
  flow: string; // "in" = money into the register, "out" = money out of it
  registerAccountId: string | null;
  kind: string; // standard | transfer
  accountId: string | null; // single category
  transferAccountId?: string | null;
  splits?: LedgerSplit[];
};

export type Posting = { txnId: string; accountId: string | null; date: Date; amount: number };

const r2 = (n: number) => Math.round(n * 100) / 100 + 0; // + 0 turns -0 into 0

/** Category lines for a transaction: its splits, or its single category. */
export function categoryLines(t: LedgerTxn): LedgerSplit[] {
  if (t.splits && t.splits.length > 0) return t.splits;
  return [{ accountId: t.accountId ?? "", amount: t.amount }];
}

/** True when splits (if any) add up to the transaction amount. */
export function splitsBalance(t: Pick<LedgerTxn, "amount" | "splits">): boolean {
  if (!t.splits || t.splits.length === 0) return true;
  return Math.abs(r2(t.splits.reduce((s, x) => s + x.amount, 0)) - r2(t.amount)) < 0.005;
}

/**
 * Balanced postings for one transaction. An uncategorized transaction posts
 * its offset to accountId=null ("Uncategorized") so balances still add up.
 */
export function postings(t: LedgerTxn): Posting[] {
  if (!t.registerAccountId) return [];
  const sign = t.flow === "in" ? 1 : -1; // effect on the register, debit-positive
  const out: Posting[] = [{ txnId: t.id, accountId: t.registerAccountId, date: t.date, amount: r2(sign * t.amount) }];
  if (t.kind === "transfer") {
    out.push({ txnId: t.id, accountId: t.transferAccountId ?? null, date: t.date, amount: r2(-sign * t.amount) });
    return out;
  }
  for (const line of categoryLines(t)) {
    out.push({ txnId: t.id, accountId: line.accountId || null, date: t.date, amount: r2(-sign * line.amount) });
  }
  return out;
}

/** Convert a debit-positive balance into the way people read it for that account type. */
export function displayBalance(type: string, debitPositive: number): number {
  return r2(DEBIT_NORMAL.has(type) ? debitPositive : -debitPositive);
}
export function toDebitPositive(type: string, display: number): number {
  return DEBIT_NORMAL.has(type) ? display : -display;
}

/**
 * Register activity counts only after the account's go-live date; anything on
 * or before it is already reflected in the starting (opening) balance.
 */
export function countsForRegister(acc: LedgerAccount, date: Date): boolean {
  return !acc.startDate || date > acc.startDate;
}

/** Display balance of every account as of a date (inclusive). */
export function accountBalances(
  txns: LedgerTxn[],
  accounts: LedgerAccount[],
  asOf: Date
): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const dp = new Map<string, number>();
  for (const a of accounts) dp.set(a.id, toDebitPositive(a.type, a.openingBalance));
  for (const t of txns) {
    if (t.date > asOf) continue;
    for (const p of postings(t)) {
      if (!p.accountId) continue;
      const acc = byId.get(p.accountId);
      if (!acc) continue;
      if (REGISTER_TYPES.has(acc.type) && !countsForRegister(acc, p.date)) continue;
      dp.set(p.accountId, (dp.get(p.accountId) ?? 0) + p.amount);
    }
  }
  const out = new Map<string, number>();
  for (const a of accounts) out.set(a.id, displayBalance(a.type, dp.get(a.id) ?? 0));
  return out;
}

/**
 * Profit-and-loss lines in the shape the report engine already understands:
 * income as flow "in", expenses/cogs as flow "out". Refunds come through as
 * negative amounts so they net against the category. Balance-sheet categories
 * (owner draws, loan principal, equipment) and transfers are excluded, which
 * is what keeps them out of profit. Uncategorized money is reported as
 * accountId=null so nothing silently disappears.
 */
export type PLLine = { date: Date; amount: number; flow: string; accountId: string | null };

export function plLines(txns: LedgerTxn[], accounts: LedgerAccount[]): PLLine[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: PLLine[] = [];
  for (const t of txns) {
    if (t.kind === "transfer") continue;
    for (const line of categoryLines(t)) {
      const acc = line.accountId ? byId.get(line.accountId) : undefined;
      if (!acc) {
        out.push({ date: t.date, amount: line.amount, flow: t.flow, accountId: null });
        continue;
      }
      if (!PL_TYPES.has(acc.type)) continue;
      // money in to an income account = income; money out of one = negative income
      if (acc.type === "income") out.push({ date: t.date, amount: t.flow === "in" ? line.amount : -line.amount, flow: "in", accountId: acc.id });
      else out.push({ date: t.date, amount: t.flow === "out" ? line.amount : -line.amount, flow: "out", accountId: acc.id });
    }
  }
  return out;
}

// ---- register view ----------------------------------------------------------

export type RegisterRow = {
  txnId: string;
  date: Date;
  amount: number; // effect on the register, shown the normal way (+ = balance goes up)
  balance: number;
};

/**
 * Rows for one register, oldest first, with a running balance in the way the
 * statement shows it (cash on hand; amount owed on a card).
 */
export function registerRows(acc: LedgerAccount, txns: LedgerTxn[]): RegisterRow[] {
  const rows: { txnId: string; date: Date; amount: number }[] = [];
  for (const t of txns) {
    if (!countsForRegister(acc, t.date)) continue;
    for (const p of postings(t)) {
      if (p.accountId !== acc.id) continue;
      rows.push({ txnId: t.id, date: t.date, amount: displayBalance(acc.type, p.amount) });
    }
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.txnId.localeCompare(b.txnId));
  let bal = acc.openingBalance;
  return rows.map((r) => {
    bal = r2(bal + r.amount);
    return { ...r, balance: bal };
  });
}

// ---- reconciliation ------------------------------------------------------------

export type ReconItem = { key: string; amount: number; cleared: boolean };

/**
 * cleared balance = beginning balance + every checked item.
 * difference = statement ending balance - cleared balance; must reach 0.00.
 */
export function reconcileMath(beginning: number, ending: number, items: ReconItem[]) {
  const clearedIn = r2(items.filter((i) => i.cleared && i.amount > 0).reduce((s, i) => s + i.amount, 0));
  const clearedOut = r2(items.filter((i) => i.cleared && i.amount < 0).reduce((s, i) => s - i.amount, 0));
  const clearedBalance = r2(beginning + clearedIn - clearedOut);
  const difference = r2(ending - clearedBalance);
  return { clearedIn, clearedOut, clearedBalance, difference, balanced: Math.abs(difference) < 0.005 };
}
