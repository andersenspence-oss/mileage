// The report engine. Pure functions: (transactions, accounts, dates) -> report.
// No database access here, so the money math is directly unit-testable.
//
// Conventions:
//  - Transaction.amount is always positive; `flow` is "in" or "out".
//  - Cash basis: every transaction is assumed settled to cash, so cumulative
//    (in - out) is the change in cash, and the balance sheet balances by
//    construction when opening balances balance.

export type TxnLite = {
  date: Date;
  amount: number;
  flow: string; // "in" | "out"
  accountId: string | null;
};

export type AccountLite = {
  id: string;
  name: string;
  type: string; // income | expense | cogs | bank | fixed_asset | other_asset | credit_card | liability | equity
  openingBalance: number;
};

export type ReportLine = { name: string; amount: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
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
  const inScope = txns.filter((t) => inRange(t, from, to));
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
};

export function balanceSheet(
  txns: TxnLite[],
  accounts: AccountLite[],
  asOf: Date
): BalanceSheet {
  const upTo = txns.filter((t) => t.date <= asOf);
  const netCash = r2(upTo.reduce((s, t) => s + (t.flow === "in" ? t.amount : -t.amount), 0));

  const banks = accounts.filter((a) => a.type === "bank");
  const totalOpeningCash = banks.reduce((s, a) => s + a.openingBalance, 0);
  // net cash movement is attributed to bank accounts proportionally to opening
  // balance (single-bank entities — the common case — are exact)
  const cashLines: ReportLine[] = banks.map((a) => ({
    name: a.name,
    amount: r2(a.openingBalance + (totalOpeningCash > 0 ? netCash * (a.openingBalance / totalOpeningCash) : netCash / Math.max(banks.length, 1))),
  }));

  const assetLines = accounts
    .filter((a) => a.type === "fixed_asset" || a.type === "other_asset")
    .map((a) => ({ name: a.name, amount: r2(a.openingBalance) }));
  const liabilityLines = accounts
    .filter((a) => a.type === "liability" || a.type === "credit_card")
    .map((a) => ({ name: a.name, amount: r2(a.openingBalance) }));
  const equityLines = accounts
    .filter((a) => a.type === "equity")
    .map((a) => ({ name: a.name, amount: r2(a.openingBalance) }));

  // On a cash basis with all flows hitting cash, cumulative net income equals
  // cumulative net cash movement.
  const retainedEarnings = netCash;

  const totalAssets = r2(
    cashLines.reduce((s, l) => s + l.amount, 0) + assetLines.reduce((s, l) => s + l.amount, 0)
  );
  const totalLiabilities = r2(liabilityLines.reduce((s, l) => s + l.amount, 0));
  const totalEquity = r2(equityLines.reduce((s, l) => s + l.amount, 0) + retainedEarnings);

  return {
    asOf, cashLines, assetLines, liabilityLines, equityLines,
    retainedEarnings: r2(retainedEarnings),
    totalAssets, totalLiabilities, totalEquity,
    balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.05,
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

export function cashFlow(
  txns: TxnLite[],
  accounts: AccountLite[],
  from: Date,
  to: Date
): CashFlow {
  const openingBank = accounts.filter((a) => a.type === "bank").reduce((s, a) => s + a.openingBalance, 0);
  const before = txns.filter((t) => t.date < from);
  const openingCash = r2(
    openingBank + before.reduce((s, t) => s + (t.flow === "in" ? t.amount : -t.amount), 0)
  );
  const inScope = txns.filter((t) => inRange(t, from, to));
  const cashIn = r2(inScope.filter((t) => t.flow === "in").reduce((s, t) => s + t.amount, 0));
  const cashOut = r2(inScope.filter((t) => t.flow === "out").reduce((s, t) => s + t.amount, 0));
  const netChange = r2(cashIn - cashOut);

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const group = (flow: "in" | "out") => {
    const totals = new Map<string, number>();
    for (const t of inScope) {
      if (t.flow !== flow) continue;
      const name = (t.accountId && byId.get(t.accountId)?.name) || "Uncategorized";
      totals.set(name, (totals.get(name) ?? 0) + t.amount);
    }
    return [...totals.entries()].map(([name, amount]) => ({ name, amount: r2(amount) })).sort((a, b) => b.amount - a.amount);
  };

  return {
    from, to, cashIn, cashOut, netChange, openingCash,
    closingCash: r2(openingCash + netChange),
    inLines: group("in"),
    outLines: group("out"),
  };
}

// ---- monthly series + plain-language callouts ------------------------------

export type MonthPoint = { month: string; income: number; expense: number; net: number };

export function monthlySeries(txns: TxnLite[], monthKeys: string[]): MonthPoint[] {
  const map = new Map(monthKeys.map((m) => [m, { month: m, income: 0, expense: 0, net: 0 }]));
  for (const t of txns) {
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
  for (const t of txns) {
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
