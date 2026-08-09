import { describe, it, expect } from "vitest";
import {
  profitAndLoss, balanceSheet, cashFlow, monthlySeries, spendingCallouts,
  type TxnLite, type AccountLite,
} from "../lib/reports";

// A tiny hand-built ledger with totals we can verify on paper.
const accounts: AccountLite[] = [
  { id: "inc", name: "Service Income", type: "income", openingBalance: 0 },
  { id: "exp1", name: "Rent", type: "expense", openingBalance: 0 },
  { id: "exp2", name: "Marketing", type: "expense", openingBalance: 0 },
  { id: "bank", name: "Checking", type: "bank", openingBalance: 10000 },
  { id: "fa", name: "Equipment", type: "fixed_asset", openingBalance: 5000 },
  { id: "liab", name: "Loan", type: "liability", openingBalance: 3000 },
  { id: "eq", name: "Owner's Equity", type: "equity", openingBalance: 12000 }, // 10000 + 5000 - 3000
];

const d = (s: string) => new Date(s + "T00:00:00");

const txns: TxnLite[] = [
  { date: d("2026-01-05"), amount: 1000, flow: "in", accountId: "inc" },
  { date: d("2026-01-20"), amount: 2000, flow: "in", accountId: "inc" },
  { date: d("2026-01-10"), amount: 500, flow: "out", accountId: "exp1" },
  { date: d("2026-01-15"), amount: 250, flow: "out", accountId: "exp2" },
  { date: d("2026-02-03"), amount: 3000, flow: "in", accountId: "inc" },
  { date: d("2026-02-10"), amount: 500, flow: "out", accountId: "exp1" },
  { date: d("2026-02-14"), amount: 100, flow: "out", accountId: null }, // uncategorized
];

describe("profitAndLoss", () => {
  it("computes known totals for January", () => {
    const pl = profitAndLoss(txns, accounts, d("2026-01-01"), d("2026-01-31"));
    expect(pl.totalIncome).toBe(3000);
    expect(pl.totalExpense).toBe(750);
    expect(pl.netIncome).toBe(2250);
    expect(pl.incomeLines).toEqual([{ name: "Service Income", amount: 3000 }]);
    expect(pl.expenseLines).toEqual([
      { name: "Rent", amount: 500 },
      { name: "Marketing", amount: 250 },
    ]);
  });

  it("includes uncategorized amounts in totals and reports them separately", () => {
    const pl = profitAndLoss(txns, accounts, d("2026-02-01"), d("2026-02-28"));
    expect(pl.uncategorizedExpense).toBe(100);
    expect(pl.totalExpense).toBe(600);
    expect(pl.netIncome).toBe(2400);
  });

  it("returns zeros for an empty range", () => {
    const pl = profitAndLoss(txns, accounts, d("2025-01-01"), d("2025-01-31"));
    expect(pl.totalIncome).toBe(0);
    expect(pl.netIncome).toBe(0);
  });
});

describe("balanceSheet", () => {
  it("balances and carries cumulative net income into cash + retained earnings", () => {
    const bs = balanceSheet(txns, accounts, d("2026-02-28"));
    // cumulative net cash = 3000-750 + 3000-600 = 4650
    expect(bs.retainedEarnings).toBe(4650);
    expect(bs.cashLines[0].amount).toBe(14650); // 10000 opening + 4650
    expect(bs.totalAssets).toBe(19650); // cash + 5000 equipment
    expect(bs.totalLiabilities).toBe(3000);
    expect(bs.totalEquity).toBe(16650); // 12000 + 4650
    expect(bs.balances).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
  });

  it("respects the as-of date", () => {
    const bs = balanceSheet(txns, accounts, d("2026-01-31"));
    expect(bs.retainedEarnings).toBe(2250);
    expect(bs.balances).toBe(true);
  });
});

describe("cashFlow", () => {
  it("computes opening/closing cash correctly for February", () => {
    const cf = cashFlow(txns, accounts, d("2026-02-01"), d("2026-02-28"));
    expect(cf.openingCash).toBe(12250); // 10000 + Jan net 2250
    expect(cf.cashIn).toBe(3000);
    expect(cf.cashOut).toBe(600);
    expect(cf.netChange).toBe(2400);
    expect(cf.closingCash).toBe(14650);
  });

  it("cross-checks: P&L net income equals cash-flow net change (cash basis)", () => {
    const from = d("2026-01-01"), to = d("2026-02-28");
    const pl = profitAndLoss(txns, accounts, from, to);
    const cf = cashFlow(txns, accounts, from, to);
    expect(pl.netIncome).toBe(cf.netChange);
  });

  it("cross-checks: cash-flow closing cash equals balance-sheet cash", () => {
    const cf = cashFlow(txns, accounts, d("2026-01-01"), d("2026-02-28"));
    const bs = balanceSheet(txns, accounts, d("2026-02-28"));
    const bsCash = bs.cashLines.reduce((s, l) => s + l.amount, 0);
    expect(cf.closingCash).toBe(bsCash);
  });
});

describe("monthlySeries", () => {
  it("groups by month", () => {
    const series = monthlySeries(txns, ["2026-01", "2026-02"]);
    expect(series).toEqual([
      { month: "2026-01", income: 3000, expense: 750, net: 2250 },
      { month: "2026-02", income: 3000, expense: 600, net: 2400 },
    ]);
  });
});

describe("spendingCallouts", () => {
  it("flags a >20% expense increase in plain language", () => {
    const t: TxnLite[] = [
      { date: d("2026-01-10"), amount: 1000, flow: "out", accountId: "exp2" },
      { date: d("2026-02-10"), amount: 1500, flow: "out", accountId: "exp2" },
    ];
    const callouts = spendingCallouts("Test Co", t, accounts, "2026-02", "2026-01");
    expect(callouts).toHaveLength(1);
    expect(callouts[0].text).toContain("Marketing");
    expect(callouts[0].text).toContain("up 50%");
  });

  it("stays quiet for small changes", () => {
    const t: TxnLite[] = [
      { date: d("2026-01-10"), amount: 1000, flow: "out", accountId: "exp2" },
      { date: d("2026-02-10"), amount: 1050, flow: "out", accountId: "exp2" },
    ];
    expect(spendingCallouts("Test Co", t, accounts, "2026-02", "2026-01")).toHaveLength(0);
  });
});
