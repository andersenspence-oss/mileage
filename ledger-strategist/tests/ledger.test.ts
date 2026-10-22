import { describe, it, expect } from "vitest";
import {
  postings, plLines, accountBalances, registerRows, reconcileMath, splitsBalance,
  type LedgerTxn, type LedgerAccount,
} from "../lib/ledger";
import { profitAndLoss, balanceSheet, cashFlow } from "../lib/reports";

const d = (s: string) => new Date(s + "T00:00:00");

const accounts: LedgerAccount[] = [
  { id: "bank", name: "Checking", type: "bank", openingBalance: 10000 },
  { id: "card", name: "Visa", type: "credit_card", openingBalance: 500 }, // owed
  { id: "inc", name: "PI Settlement Income", type: "income", openingBalance: 0 },
  { id: "rent", name: "Rent", type: "expense", openingBalance: 0 },
  { id: "sup", name: "Supplies", type: "expense", openingBalance: 0 },
  { id: "wages", name: "Wages", type: "expense", openingBalance: 0 },
  { id: "ptax", name: "Payroll Taxes", type: "expense", openingBalance: 0 },
  { id: "plia", name: "Payroll Liabilities", type: "liability", openingBalance: 0 },
  { id: "draw", name: "Owner Draws", type: "equity", openingBalance: 0 },
  { id: "eq", name: "Owner Equity", type: "equity", openingBalance: 9500 },
];

const tx = (o: Partial<LedgerTxn> & { id: string; date: Date; amount: number; flow: string }): LedgerTxn => ({
  registerAccountId: "bank", kind: "standard", accountId: null, ...o,
});

const book: LedgerTxn[] = [
  tx({ id: "dep", date: d("2026-03-02"), amount: 5000, flow: "in", accountId: "inc" }),
  tx({ id: "rent", date: d("2026-03-03"), amount: 2000, flow: "out", accountId: "rent" }),
  // card charge split across two categories
  tx({ id: "chg", date: d("2026-03-05"), amount: 300, flow: "out", registerAccountId: "card",
       splits: [{ accountId: "sup", amount: 200 }, { accountId: "rent", amount: 100 }] }),
  // card refund
  tx({ id: "ref", date: d("2026-03-06"), amount: 50, flow: "in", registerAccountId: "card", accountId: "sup" }),
  // pay the card from checking (transfer)
  tx({ id: "pay", date: d("2026-03-20"), amount: 750, flow: "out", kind: "transfer", transferAccountId: "card" }),
  // payroll: net pay debit with withholdings held back, then the tax debit
  tx({ id: "net", date: d("2026-03-15"), amount: 800, flow: "out",
       splits: [{ accountId: "wages", amount: 1000 }, { accountId: "plia", amount: -200 }] }),
  tx({ id: "tax", date: d("2026-03-15"), amount: 280, flow: "out",
       splits: [{ accountId: "plia", amount: 200 }, { accountId: "ptax", amount: 80 }] }),
  // owner draw: balance sheet, not an expense
  tx({ id: "draw", date: d("2026-03-25"), amount: 1000, flow: "out", accountId: "draw" }),
];

describe("postings", () => {
  it("every transaction balances to zero", () => {
    for (const t of book) {
      const sum = postings(t).reduce((s, p) => s + p.amount, 0);
      expect(Math.abs(sum)).toBeLessThan(0.001);
    }
  });
  it("split totals are validated", () => {
    expect(splitsBalance(book[2])).toBe(true);
    expect(splitsBalance({ amount: 300, splits: [{ accountId: "sup", amount: 250 }] })).toBe(false);
  });
});

describe("balances", () => {
  const bal = accountBalances(book, accounts, d("2026-03-31"));
  it("checking reflects deposits, payments, card payment, payroll and draws", () => {
    // 10000 + 5000 - 2000 - 750 - 800 - 280 - 1000
    expect(bal.get("bank")).toBe(10170);
  });
  it("credit card shows amount owed: opening + charges - refunds - payments", () => {
    expect(bal.get("card")).toBe(500 + 300 - 50 - 750);
  });
  it("payroll liability nets to zero once taxes are paid", () => {
    expect(bal.get("plia")).toBe(0);
  });
});

describe("profit and loss", () => {
  const pl = profitAndLoss(book, accounts, d("2026-03-01"), d("2026-03-31"));
  it("splits land in each category, refunds net against them", () => {
    const by = Object.fromEntries(pl.expenseLines.map((l) => [l.name, l.amount]));
    expect(by["Rent"]).toBe(2100);
    expect(by["Supplies"]).toBe(150);
    expect(by["Wages"]).toBe(1000);
    expect(by["Payroll Taxes"]).toBe(80);
  });
  it("transfers and owner draws are not expenses", () => {
    expect(pl.totalExpense).toBe(2100 + 150 + 1000 + 80);
    expect(pl.netIncome).toBe(5000 - 3330);
  });
  it("plLines skips balance-sheet categories", () => {
    const lines = plLines(book, accounts);
    expect(lines.find((l) => l.accountId === "draw")).toBeUndefined();
    expect(lines.find((l) => l.accountId === "plia")).toBeUndefined();
  });
});

describe("balance sheet and cash flow", () => {
  it("balances with a credit card, payroll, transfers and draws", () => {
    const bs = balanceSheet(book, accounts, d("2026-03-31"));
    expect(bs.balances).toBe(true);
  });
  it("cash flow counts the card payment, not the card charges", () => {
    const cf = cashFlow(book, accounts, d("2026-03-01"), d("2026-03-31"));
    expect(cf.openingCash).toBe(10000);
    expect(cf.closingCash).toBe(10170);
    expect(cf.netChange).toBe(170);
    expect(cf.outLines.find((l) => l.name === "Supplies")).toBeUndefined();
    expect(cf.outLines.find((l) => l.name === "Transfer to Visa")?.amount).toBe(750);
  });
});

describe("register and go-live", () => {
  it("running balance on a card register reads as amount owed", () => {
    const rows = registerRows(accounts[1], book);
    expect(rows.map((r) => r.balance)).toEqual([800, 750, 0]);
  });
  it("activity on or before go-live is already inside the starting balance", () => {
    const live: LedgerAccount = { ...accounts[0], openingBalance: 8000, startDate: d("2026-03-03") };
    const rows = registerRows(live, book);
    expect(rows[0].txnId).not.toBe("dep");
    expect(rows[0].txnId).not.toBe("rent");
    const bs = balanceSheet(book, [live, ...accounts.slice(1)], d("2026-03-31"));
    expect(bs.balances).toBe(true);
    // the gap is shown, not hidden
    expect(bs.carriedFromQuickBooks).not.toBe(0);
    const full = balanceSheet(book, accounts, d("2026-03-31"));
    expect(full.carriedFromQuickBooks).toBe(0);
  });
});

describe("reconcile math", () => {
  it("difference reaches zero only when the right items are checked", () => {
    const items = [
      { key: "a", amount: 5000, cleared: true },
      { key: "b", amount: -2000, cleared: true },
      { key: "c", amount: -800, cleared: false },
    ];
    expect(reconcileMath(10000, 13000, items).balanced).toBe(true);
    expect(reconcileMath(10000, 12200, items).difference).toBe(-800);
    items[2].cleared = true;
    expect(reconcileMath(10000, 12200, items).balanced).toBe(true);
  });
});
