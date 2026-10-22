// The report engine. Pure functions: (transactions, accounts, dates) -> report.
// No database access here, so the money math is directly unit-testable.
//
// Transactions are ledger-shaped (see lib/ledger.ts): each moves money through
// a register (bank or credit card) and lands in a category, several split
// categories, or another balance-sheet account (a transfer). Older callers
// that pass only {date, amount, flow, accountId} still work: such rows are
// treated as running through the entity's first bank account.
import {
  plLines, accountBalances, categoryLines, countsForRegister,
  type LedgerTxn, type LedgerAccount, type LedgerSplit,
} from "./ledger";

export type TxnLite = {
  date: Date;
  amount: number;
  flow: string; // "in" | "out" relative to the register
  accountId: string | null;
  id?: string;
  registerAccountId?: string | null;
  kind?: string;
  transferAccountId?: string | null;
  splits?: LedgerSplit[];
};

export type AccountLite = {
  id: string;
  name: string;
  type: string; // income | expense | cogs | bank | fixed_asset | other_asset | credit_card | liability | equity
  openingBalance: number;
  startDate?: Date | null;
};

export type ReportLine = { name: string; amount: number };

/** Normalize report input into full ledger transactions. */
export function asLedger(txns: TxnLite[], accounts: AccountLite[]): LedgerTxn[] {
  const firstBank = accounts.find((a) => a.type === "bank")?.id ?? null;
  return txns.map((t, i) => ({
    id: t.id ?? `t${i}`,
    date: t.date,
    amount: t.amount,
    flow: t.flow,
    registerAccountId: t.registerAccountId ?? firstBank,
    kind: t.kind ?? "standard",
    accountId: t.accountId,
    transferAccountId: t.transferAccountId ?? null,
    splits: t.splits,
  }));
}

/** P&L-shaped lines (income in, expenses out; transfers and balance-sheet categories removed). */
function pl(txns: TxnLite[], accounts: AccountLite[]): TxnLite[] {
  return plLines(asLedger(txns, accounts), accounts as LedgerAccount[]);
}

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const inRange = (t: TxnLite, from: Date, to: Date) => t.date >= from && t.date <= to;

function sumByAccount(
  txns: TxnLite[],
  accounts: AccountLite[],
  accountTypes: string[],
  flow: "in" | "out"
): ReportLine[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  for (const t of txns) {
    if (t.flow !== flow) continue;
    const acc = t.accountId ? byId.get(t.accountId) : undefined;
    if (!acc || !accountTypes.includes(acc.type)) continue;
    totals.set(acc.name, (totals.get(acc.name) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

export type ProfitAndLoss = {
  from: Date;
  to: Date;
  incomeLines: ReportLine[];
  cogsLines: ReportLine[];
  expenseLines: ReportLine[];
  uncategorizedIncome: number;
  uncategorizedExpense: number;
  totalIncome: number;
  totalCogs: number;
  grossProfit: number;
  totalExpense: number;
  netIncome: number;
};

export function profitAndLoss(
  txns: TxnLite[],
  accounts: AccountLite[],
  from: Date,
  to: Date
): ProfitAndLoss {
  const inScope = pl(txns, accounts).filter((t) => inRange(t, from, to));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const incomeLines = sumByAccount(inScope, accounts, ["income"], "in");
  const cogsLines = sumByAccount(inScope, accounts, ["cogs"], "out");
  const expenseLines = sumByAccount(inScope, accounts, ["expense"], "out");

  let uncategorizedIncome = 0;
  let uncategorizedExpense = 0;
  for (const t of inScope) {
    const acc = t.accountId ? byId.get(t.accountId) : undefined;
    if (!acc) {
      if (t.flow === "in") uncategorizedIncome += t.amount;
      else uncategorizedExpense += t.amount;
    }
  }

  const totalIncome = r2(incomeLines.reduce((s, l) => s + l.amount, 0) + uncategorizedIncome);
  const totalCogs = r2(cogsLines.reduce((s, l) => s + l.amount, 0));
  const grossProfit = r2(totalIncome - totalCogs);
  const totalExpense = r2(expenseLines.reduce((s, l) => s + l.amount, 0) + uncategorizedExpense);
  const netIncome = r2(grossProfit - totalExpense);

  return {
    from, to, incomeLines, cogsLines, expenseLines,
    uncategorizedIncome: r2(uncategorizedIncome),
    uncategorizedExpense: r2(uncategorizedExpense),
    totalIncome, totalCogs, grossProfit, totalExpense, netIncome,
  };
}

export type BalanceSheet = {
  asOf: Date;
  cashLines: ReportLine[];
  assetLines: ReportLine[];
  liabilityLines: ReportLine[];
  equityLines: ReportLine[];
  retainedEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balances: boolean;
  carriedFromQuickBooks: number; // 0 when the app's own numbers balance
};

export function balanceSheet(
  txns: TxnLite[],
  accounts: AccountLite[],
  asOf: Date
): BalanceSheet {
  const ledger = asLedger(txns, accounts);
  const bal = accountBalances(ledger, accounts as LedgerAccount[], asOf);
  const line = (a: AccountLite) => ({ name: a.name, amount: bal.get(a.id) ?? 0 });

  const cashLines = accounts.filter((a) => a.type === "bank").map(line);
  const assetLines = accounts.filter((a) => a.type === "fixed_asset" || a.type === "other_asset").map(line);
  const liabilityLines = accounts.filter((a) => a.type === "liability" || a.type === "credit_card").map(line);
  const equityLines = accounts.filter((a) => a.type === "equity").map(line);

  // Retained earnings = cumulative profit (uncategorized money included, so
  // nothing silently drops out of the balance).
  const lines = pl(txns, accounts).filter((t) => t.date <= asOf);
  const retainedEarnings = r2(lines.reduce((s, t) => s + (t.flow === "in" ? t.amount : -t.amount), 0));

  const totalAssets = r2(cashLines.reduce((s, l) => s + l.amount, 0) + assetLines.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = r2(liabilityLines.reduce((s, l) => s + l.amount, 0));
  let totalEquity = r2(equityLines.reduce((s, l) => s + l.amount, 0) + retainedEarnings);

  // QuickBooks 2016 holds the official opening balances for loans, equity,
  // and assets; this app usually knows only the bank and card statement
  // balances at go-live. Rather than hide the gap, show it as its own clearly
  // labeled line so the page balances and the reader knows why.
  const carriedFromQuickBooks = r2(totalAssets - totalLiabilities - totalEquity);
  if (Math.abs(carriedFromQuickBooks) >= 0.05) {
    equityLines.push({ name: "Opening balances carried in QuickBooks (not tracked here)", amount: carriedFromQuickBooks });
    totalEquity = r2(totalEquity + carriedFromQuickBooks);
  }

  return {
    asOf, cashLines, assetLines, liabilityLines, equityLines,
    retainedEarnings,
    totalAssets, totalLiabilities, totalEquity,
    balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.05,
    carriedFromQuickBooks: Math.abs(carriedFromQuickBooks) >= 0.05 ? carriedFromQuickBooks : 0,
  };
}

export type CashFlow = {
  from: Date;
  to: Date;
  cashIn: number;
  cashOut: number;
  netChange: number;
  openingCash: number;
  closingCash: number;
  inLines: ReportLine[];
  outLines: ReportLine[];
};

/**
 * Cash = bank accounts only. A credit card charge is not cash until the card
 * is paid; the payment shows up here as a transfer out of the bank.
 */
export function cashFlow(
  txns: TxnLite[],
  accounts: AccountLite[],
  from: Date,
  to: Date
): CashFlow {
  const ledger = asLedger(txns, accounts);
  const banks = accounts.filter((a) => a.type === "bank");
  const bankIds = new Set(banks.map((a) => a.id));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const dayBefore = new Date(from.getTime() - 1);
  const sumBanks = (m: Map<string, number>) => r2(banks.reduce((s, a) => s + (m.get(a.id) ?? 0), 0));
  const openingCash = sumBanks(accountBalances(ledger, accounts as LedgerAccount[], dayBefore));
  const closingCash = sumBanks(accountBalances(ledger, accounts as LedgerAccount[], to));

  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const t of ledger) {
    if (!inRange(t, from, to)) continue;
    if (!t.registerAccountId || !bankIds.has(t.registerAccountId)) {
      // money leaving another account INTO a bank via transfer (e.g. loan proceeds recorded on the loan side)
      if (t.kind === "transfer" && t.transferAccountId && bankIds.has(t.transferAccountId)) {
        const reg = t.registerAccountId ? byId.get(t.registerAccountId) : undefined;
        const acc = byId.get(t.transferAccountId)!;
        if (!countsForRegister(acc as LedgerAccount, t.date)) continue;
        const label = `Transfer ${t.flow === "out" ? "from" : "to"} ${reg?.name ?? "other account"}`;
        if (t.flow === "out") add(ins, label, t.amount); else add(outs, label, t.amount);
      }
      continue;
    }
    const reg = byId.get(t.registerAccountId)!;
    if (!countsForRegister(reg as LedgerAccount, t.date)) continue;
    const target = t.flow === "in" ? ins : outs;
    if (t.kind === "transfer") {
      const other = t.transferAccountId ? byId.get(t.transferAccountId) : undefined;
      if (other && bankIds.has(other.id)) continue; // bank-to-bank: no net cash effect, both sides in banks
      add(target, `Transfer ${t.flow === "in" ? "from" : "to"} ${other?.name ?? "other account"}`, t.amount);
      continue;
    }
    for (const l of categoryLines(t)) {
      add(target, (l.accountId && byId.get(l.accountId)?.name) || "Uncategorized", l.amount);
    }
  }
  const lines = (m: Map<string, number>) =>
    [...m.entries()].map(([name, amount]) => ({ name, amount: r2(amount) })).filter((l) => l.amount !== 0).sort((a, b) => b.amount - a.amount);
  const inLines = lines(ins);
  const outLines = lines(outs);
  const cashIn = r2(inLines.reduce((s, l) => s + l.amount, 0));
  const cashOut = r2(outLines.reduce((s, l) => s + l.amount, 0));
  return { from, to, cashIn, cashOut, netChange: r2(cashIn - cashOut), openingCash, closingCash, inLines, outLines };
}

// ---- monthly series + plain-language callouts ------------------------------

export type MonthPoint = { month: string; income: number; expense: number; net: number };

export function monthlySeries(txns: TxnLite[], monthKeys: string[], accounts?: AccountLite[]): MonthPoint[] {
  const map = new Map(monthKeys.map((m) => [m, { month: m, income: 0, expense: 0, net: 0 }]));
  for (const t of accounts ? pl(txns, accounts) : txns) {
    const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    const p = map.get(key);
    if (!p) continue;
    if (t.flow === "in") p.income += t.amount;
    else p.expense += t.amount;
  }
  return monthKeys.map((m) => {
    const p = map.get(m)!;
    return { month: m, income: r2(p.income), expense: r2(p.expense), net: r2(p.income - p.expense) };
  });
}

export type Callout = { severity: "info" | "warn" | "bad"; text: string };

/**
 * Compare the latest complete month against the one before it, per expense
 * account, and describe the biggest movements in plain language.
 */
export function spendingCallouts(
  entityName: string,
  txns: TxnLite[],
  accounts: AccountLite[],
  currMonth: string,
  prevMonth: string
): Callout[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const totals = new Map<string, { curr: number; prev: number }>();
  for (const t of pl(txns, accounts)) {
    if (t.flow !== "out" || !t.accountId) continue;
    const acc = byId.get(t.accountId);
    if (!acc || acc.type !== "expense") continue;
    const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    if (key !== currMonth && key !== prevMonth) continue;
    const e = totals.get(acc.name) ?? { curr: 0, prev: 0 };
    if (key === currMonth) e.curr += t.amount;
    else e.prev += t.amount;
    totals.set(acc.name, e);
  }
  const callouts: Callout[] = [];
  for (const [name, { curr, prev }] of totals) {
    if (prev < 100) continue; // too small to be meaningful
    const change = (curr - prev) / prev;
    if (Math.abs(change) < 0.2) continue;
    const dir = change > 0 ? "up" : "down";
    callouts.push({
      severity: change > 0.4 ? "warn" : "info",
      text: `${entityName}: ${name} spending is ${dir} ${Math.abs(Math.round(change * 100))}% vs last month (${Math.round(prev).toLocaleString()} → ${Math.round(curr).toLocaleString()}).`,
    });
  }
  return callouts.sort((a, b) => (a.severity === "warn" ? -1 : 1) - (b.severity === "warn" ? -1 : 1)).slice(0, 3);
}
