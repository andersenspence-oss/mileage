import { describe, it, expect } from "vitest";
import { readQbLists, buildIif, shapeForQb, cleanField, parseIif, type ExportAccount, type ExportSource } from "../lib/iif";

// Shape of a real "Lists to IIF Files" export from QuickBooks Desktop 2016
const T = "\t";
const LIST_EXPORT = [
  ["!HDR", "PROD", "VER", "REL", "IIFVER", "DATE", "TIME", "ACCNTNT", "ACCNTNTSPLITTIME"].join(T),
  ["HDR", "QuickBooks Pro", "Version 26.0D", "Release R16P", "1", "2026-10-20", "1760999999", "N", "0"].join(T),
  ["!ACCNT", "NAME", "REFNUM", "TIMESTAMP", "ACCNTTYPE", "OBAMOUNT", "DESC", "ACCNUM", "SCD", "BANKNUM", "EXTRA", "HIDDEN", "DELCOUNT", "USEID"].join(T),
  ["ACCNT", "Zions Checking", "1", "93", "BANK", "0.00", "", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "Chase Visa", "2", "94", "CCARD", "0.00", "", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "Automobile", "3", "95", "EXP", "0.00", "", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "Automobile:Fuel", "4", "96", "EXP", "0.00", "\"Gas, oil\"", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "PI Settlements", "5", "97", "INC", "0.00", "", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "Payroll Liabilities", "6", "98", "OCLIAB", "0.00", "", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "Estimates", "7", "99", "NONPOSTING", "0.00", "", "", "0", "", "", "N", "0", "N"].join(T),
  ["ACCNT", "Old Savings", "8", "100", "BANK", "0.00", "", "", "0", "", "", "Y", "0", "N"].join(T),
  ["!VEND", "NAME", "REFNUM", "TIMESTAMP", "PRINTAS", "ADDR1", "1099", "HIDDEN"].join(T),
  ["VEND", "Maverik", "11", "1", "", "", "N", "N"].join(T),
  ["VEND", "Red Rock Properties", "12", "1", "", "", "Y", "N"].join(T),
  ["VEND", "Gone Vendor", "13", "1", "", "", "N", "Y"].join(T),
  ["!CUST", "NAME", "REFNUM", "TIMESTAMP", "HIDDEN"].join(T),
  ["CUST", "Siegfried & Jensen", "21", "1", "N"].join(T),
].join("\r\n");

describe("reading QuickBooks 2016 lists", () => {
  const lists = readQbLists(LIST_EXPORT);
  it("reads accounts with full parent:child names and maps types", () => {
    expect(lists.accounts.map((a) => [a.qbName, a.type])).toEqual([
      ["Zions Checking", "bank"], ["Chase Visa", "credit_card"], ["Automobile", "expense"],
      ["Automobile:Fuel", "expense"], ["PI Settlements", "income"], ["Payroll Liabilities", "liability"],
      ["Old Savings", "bank"],
    ]);
    expect(lists.accounts.find((a) => a.qbName === "Old Savings")?.hidden).toBe(true);
    expect(lists.accounts.find((a) => a.qbName === "Automobile:Fuel")?.description).toBe("Gas, oil");
  });
  it("skips non-posting accounts and reports them", () => {
    expect(lists.skipped).toEqual(["Estimates (NONPOSTING)"]);
  });
  it("reads vendor and customer names, 1099 flags, and drops inactive names", () => {
    expect(lists.names).toEqual([
      { name: "Maverik", listType: "vendor", is1099: false },
      { name: "Red Rock Properties", listType: "vendor", is1099: true },
      { name: "Siegfried & Jensen", listType: "customer", is1099: false },
    ]);
  });
});

const accts = new Map<string, ExportAccount>([
  ["bank", { id: "bank", qbName: "Zions Checking", type: "bank" }],
  ["sav", { id: "sav", qbName: "Zions Savings", type: "bank" }],
  ["card", { id: "card", qbName: "Chase Visa", type: "credit_card" }],
  ["fuel", { id: "fuel", qbName: "Automobile:Fuel", type: "expense" }],
  ["rent", { id: "rent", qbName: "Rent", type: "expense" }],
  ["inc", { id: "inc", qbName: "PI Settlements", type: "income" }],
  ["wages", { id: "wages", qbName: "Payroll Expenses:Wages", type: "expense" }],
  ["plia", { id: "plia", qbName: "Payroll Liabilities", type: "liability" }],
  ["nolink", { id: "nolink", qbName: null, type: "expense" }],
]);
const d = (s: string) => new Date(s + "T00:00:00");
const src = (o: Partial<ExportSource>): ExportSource => ({
  id: "x", date: d("2026-10-05"), amount: 100, flow: "out", kind: "standard", registerAccountId: "bank",
  accountId: "fuel", transferAccountId: null, splits: [], payee: null, checkNum: null, memo: null, clearedOn: new Set(), ...o,
});
const shape = (o: Partial<ExportSource>) => {
  const r = shapeForQb(src(o), accts);
  if (!r.ok) throw new Error(r.problem);
  return r.txn;
};

describe("shaping transactions the way QuickBooks records them", () => {
  it("bank payment -> Check, bank negative, category positive", () => {
    const t = shape({ payee: "Maverik", checkNum: "1042" });
    expect(t.trnsType).toBe("CHECK");
    expect(t.head).toMatchObject({ account: "Zions Checking", amount: -100 });
    expect(t.splits[0]).toMatchObject({ account: "Automobile:Fuel", amount: 100 });
  });
  it("bank deposit -> Deposit", () => {
    const t = shape({ flow: "in", accountId: "inc", amount: 5000 });
    expect(t.trnsType).toBe("DEPOSIT");
    expect(t.head.amount).toBe(5000);
    expect(t.splits[0].amount).toBe(-5000);
  });
  it("card charge -> Credit Card; card refund -> CCard Refund", () => {
    expect(shape({ registerAccountId: "card" }).trnsType).toBe("CREDIT CARD");
    expect(shape({ registerAccountId: "card", flow: "in" }).trnsType).toBe("CCARD REFUND");
  });
  it("card payment recorded on the card side is written as a check from the bank", () => {
    const t = shape({ registerAccountId: "card", flow: "in", kind: "transfer", transferAccountId: "bank", amount: 750 });
    expect(t.trnsType).toBe("CHECK");
    expect(t.head).toMatchObject({ account: "Zions Checking", amount: -750 });
    expect(t.splits[0]).toMatchObject({ account: "Chase Visa", amount: 750 });
  });
  it("bank to bank -> Transfer", () => {
    const t = shape({ kind: "transfer", transferAccountId: "sav", amount: 2000 });
    expect(t.trnsType).toBe("TRANSFER");
  });
  it("payroll split with negative withholding line balances", () => {
    const t = shape({ amount: 800, accountId: null, splits: [
      { accountId: "wages", amount: 1000, memo: "Gross wages" },
      { accountId: "plia", amount: -200, memo: "Withholdings" },
    ] });
    expect(t.splits.map((s) => s.amount)).toEqual([1000, -200]);
  });
  it("refuses accounts that are not linked to QuickBooks", () => {
    const r = shapeForQb(src({ accountId: "nolink" }), accts);
    expect(r.ok).toBe(false);
  });
  it("marks reconciled sides as cleared", () => {
    const t = shape({ clearedOn: new Set(["bank"]) });
    expect(t.head.cleared).toBe(true);
    expect(t.splits[0].cleared).toBe(false);
  });
});

describe("writing the IIF file", () => {
  it("produces tab-separated TRNS/SPL/ENDTRNS blocks QuickBooks can import, and reads back balanced", () => {
    const iif = buildIif([
      shape({ payee: "Maverik", checkNum: "1042", memo: "Fuel\tfor\ntruck" }),
      shape({ flow: "in", accountId: "inc", amount: 5000, date: d("2026-01-09") }),
    ]);
    expect(iif.split("\r\n")[0]).toBe("!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR");
    expect(iif).toContain("TRNS\t\tCHECK\t10/05/2026\tZions Checking\tMaverik\t-100.00\t1042\tFuel for truck\tN");
    expect(iif).toContain("SPL\t\tDEPOSIT\t01/09/2026\tPI Settlements\t\t-5000.00\t\t\tN");
    expect(iif.match(/^ENDTRNS$/gm)?.length).toBe(2);
    expect(iif.endsWith("\r\n")).toBe(true);
    // every TRNS block sums to zero
    const rows = parseIif(iif);
    let sum = 0;
    for (const r of rows) {
      if (r.type === "TRNS") sum = Number(r.fields.AMOUNT);
      else if (r.type === "SPL") sum += Number(r.fields.AMOUNT);
      else if (r.type === "ENDTRNS") expect(Math.abs(sum)).toBeLessThan(0.001);
    }
  });
  it("refuses to write an unbalanced transaction", () => {
    const t = shape({});
    t.splits[0].amount = 90;
    expect(() => buildIif([t])).toThrow(/does not balance/);
  });
  it("cleans text QuickBooks 2016 would choke on", () => {
    expect(cleanField("Café “Rio” — lunch\tmeeting")).toBe("Cafe 'Rio' - lunch meeting");
    expect(cleanField("A very long payee name that keeps going past forty one", 41)).toHaveLength(41);
  });
});
