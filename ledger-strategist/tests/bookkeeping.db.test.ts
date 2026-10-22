// End-to-end bookkeeping against a real (scratch) SQLite database:
// QuickBooks lists in, bank + card downloads in, duplicates skipped, manual
// entries matched, card payment merged, payroll entered, accounts reconciled,
// and a balanced IIF file out.
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbFile = path.join(__dirname, "..", "prisma", "data", "test-bookkeeping.db");
process.env.DATABASE_URL = "file:./data/test-bookkeeping.db";

let bk: typeof import("../lib/bookkeeping");
let prisma: typeof import("../lib/db").prisma;

const T = "\t";
const QB_LISTS = [
  ["!ACCNT", "NAME", "ACCNTTYPE", "HIDDEN"].join(T),
  ...[
    ["Zions Checking", "BANK"], ["Chase Visa", "CCARD"], ["PI Settlements", "INC"], ["Rent", "EXP"],
    ["Automobile:Fuel", "EXP"], ["Office Supplies", "EXP"], ["Payroll Expenses:Wages", "EXP"],
    ["Payroll Expenses:Taxes", "EXP"], ["Payroll Expenses:Service Fees", "EXP"], ["Payroll Liabilities", "OCLIAB"],
    ["Owner Draws", "EQUITY"],
  ].map(([n, t]) => ["ACCNT", n, t, "N"].join(T)),
  ["!VEND", "NAME", "1099", "HIDDEN"].join(T),
  ["VEND", "ADP", "N", "N"].join(T),
  ["VEND", "Maverik", "N", "N"].join(T),
  ["VEND", "Red Rock Properties", "Y", "N"].join(T),
].join("\r\n");

const BANK_CSV_1 =
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n" +
  "CREDIT,10/02/2026,SIEGFRIED JENSEN ACH,8000.00,ACH_CREDIT,,\n" +
  "DEBIT,10/03/2026,RED ROCK PROPERTIES RENT,-4200.00,ACH_DEBIT,,\n" +
  "CHECK,10/05/2026,CHECK 1042,-150.00,CHECK_PAID,,1042\n" +
  "DEBIT,10/09/2026,ADP PAYROLL NET,-3100.00,ACH_DEBIT,,\n" +
  "DEBIT,10/09/2026,ADP TAX,-1265.00,ACH_DEBIT,,\n" +
  "DEBIT,10/20/2026,CHASE CREDIT CRD AUTOPAY,-300.00,ACH_DEBIT,,\n";

const CARD_CSV =
  "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
  "10/04/2026,10/05/2026,MAVERIK #423 ST GEORGE UT,Gas,Sale,-60.00,\n" +
  "10/06/2026,10/07/2026,OFFICE DEPOT,Shopping,Sale,-240.00,\n" +
  "10/21/2026,10/21/2026,Payment Thank You-Mobile,,Payment,300.00,\n";

const d = (s: string) => new Date(s + "T00:00:00");

beforeAll(async () => {
  fs.rmSync(dbFile, { force: true });
  execSync("npx prisma db push --skip-generate", { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });
  bk = await import("../lib/bookkeeping");
  prisma = (await import("../lib/db")).prisma;
}, 60000);

describe("a month of real bookkeeping", () => {
  let entityId = "", bankId = "", cardId = "";
  const acct = async (name: string) => (await prisma.account.findFirstOrThrow({ where: { entityId, name } })).id;

  it("adds a newly purchased entity and loads its QuickBooks 2016 lists", async () => {
    const e = await bk.createEntity({ name: "Whiplash Center of Utah", kind: "clinic", acquiredOn: d("2026-01-01") });
    entityId = e.id;
    const r = await bk.importQbLists(entityId, QB_LISTS);
    expect(r.created).toBe(11);
    expect(r.names).toBe(3);
    bankId = await acct("Zions Checking");
    cardId = await acct("Chase Visa");
    // go live Sept 30: statement balances that day
    await prisma.account.update({ where: { id: bankId }, data: { startDate: d("2026-09-30"), openingBalance: 10000 } });
    await prisma.account.update({ where: { id: cardId }, data: { startDate: d("2026-09-30"), openingBalance: 0 } });
    // re-importing the lists links instead of duplicating
    const again = await bk.importQbLists(entityId, QB_LISTS);
    expect(again.created).toBe(0);
    expect(await prisma.account.count({ where: { entityId } })).toBe(11);
  });

  it("enters a hand-written check and an ADP payroll before the bank download", async () => {
    await bk.addManual({ entityId, registerAccountId: bankId, date: d("2026-10-01"), amount: 150, flow: "out", checkNum: "1042", payee: "Maverik", categoryAccountId: await acct("Office Supplies") });
    const wrong = bk.createPayroll({
      entityId, bankAccountId: bankId, payDate: d("2026-10-08"),
      wageLines: [{ accountId: await acct("Payroll Expenses:Wages"), amount: 4000 }],
      employeeTaxes: 700, otherDeductions: 200, employerTaxes: 565, netPay: 3000,
      liabilityAccountId: await acct("Payroll Liabilities"), employerTaxAccountId: await acct("Payroll Expenses:Taxes"),
    });
    await expect(wrong).rejects.toThrow(/off by \$-100.00/);
    const run = await bk.createPayroll({
      entityId, bankAccountId: bankId, payDate: d("2026-10-08"),
      wageLines: [{ accountId: await acct("Payroll Expenses:Wages"), amount: 4000 }],
      employeeTaxes: 700, otherDeductions: 200, employerTaxes: 565, netPay: 3100,
      liabilityAccountId: await acct("Payroll Liabilities"), employerTaxAccountId: await acct("Payroll Expenses:Taxes"),
      payeeName: "ADP",
    });
    expect(run.taxDebit).toBe(1265);
    expect(run.txnIds).toHaveLength(2);
  });

  it("imports the bank download: new lines added, check and payroll matched, not duplicated", async () => {
    const b = await prisma.importBatch.create({ data: { registerAccountId: bankId, fileName: "oct.csv", rawCsv: BANK_CSV_1 } });
    const pv = await bk.previewImport(b.id);
    expect(pv.counts).toEqual({ new: 3, duplicate: 0, match: 3, beforeGoLive: 0 });
    const r = await bk.commitImport(b.id, pv.mapping);
    expect(r).toEqual({ added: 3, matched: 3, duplicates: 0 });
    // a payee QuickBooks already knows is filled in from the bank text
    const rent = await prisma.transaction.findFirstOrThrow({ where: { entityId, amount: 4200 } });
    expect(rent.payee).toBe("Red Rock Properties");
  });

  it("downloading the same month again adds nothing", async () => {
    const b = await prisma.importBatch.create({ data: { registerAccountId: bankId, fileName: "oct-again.csv", rawCsv: BANK_CSV_1 } });
    const pv = await bk.previewImport(b.id);
    expect(pv.counts.duplicate).toBe(6);
    const r = await bk.commitImport(b.id, pv.mapping);
    expect(r.added).toBe(0);
  });

  it("imports the card, and merges the card payment with the bank side", async () => {
    const b = await prisma.importBatch.create({ data: { registerAccountId: cardId, fileName: "visa.csv", rawCsv: CARD_CSV } });
    const pv = await bk.previewImport(b.id);
    expect(pv.counts.new).toBe(3);
    await bk.commitImport(b.id, pv.mapping);
    const bankPay = await prisma.transaction.findFirstOrThrow({ where: { registerAccountId: bankId, amount: 300 } });
    const res = await bk.applyCategory(bankPay.id, cardId);
    expect(res.merged).toBe(true);
    // the card's "Payment Thank You" line was folded in: one transaction, both bank lines remembered
    expect(await prisma.transaction.count({ where: { entityId, amount: 300 } })).toBe(1);
    expect(await prisma.txnClear.count({ where: { transactionId: bankPay.id, importFingerprint: { not: null } } })).toBe(2);
    // and downloading the card again does not bring the payment back
    const b2 = await prisma.importBatch.create({ data: { registerAccountId: cardId, fileName: "visa2.csv", rawCsv: CARD_CSV } });
    expect((await bk.previewImport(b2.id)).counts.duplicate).toBe(3);
  });

  it("categorizes the rest, including a split", async () => {
    const find = (where: object) => prisma.transaction.findFirstOrThrow({ where: { entityId, ...where } });
    await bk.applyCategory((await find({ amount: 8000 })).id, await acct("PI Settlements"));
    await bk.applyCategory((await find({ amount: 4200 })).id, await acct("Rent"));
    await bk.applyCategory((await find({ amount: 60 })).id, await acct("Automobile:Fuel"));
    const od = await find({ amount: 240 });
    await expect(bk.saveSplits(od.id, [{ accountId: await acct("Office Supplies"), amount: 200 }])).rejects.toThrow(/off by \$40.00/);
    await bk.saveSplits(od.id, [
      { accountId: await acct("Office Supplies"), amount: 200 },
      { accountId: await acct("Owner Draws"), amount: 40, memo: "personal" },
    ]);
    expect(await prisma.transaction.count({ where: { entityId, categoryStatus: { in: ["uncategorized", "suggested"] } } })).toBe(0);
  });

  it("reconciles the bank statement to the penny", async () => {
    // statement: 10000 + 8000 - 4200 - 150 - 3100 - 1265 - 300 = 8985
    const rec = await bk.startRecon(bankId, d("2026-10-31"), 8985);
    const { items, math } = await bk.reconItems(rec.id);
    expect(items).toHaveLength(6);
    expect(rec.beginningBalance).toBe(10000);
    expect(math.balanced).toBe(false);
    const partial = await bk.saveRecon(rec.id, items.slice(0, 5).map((i) => i.key), false);
    expect(partial.difference).toBe(-300);
    await expect(bk.saveRecon(rec.id, items.slice(0, 5).map((i) => i.key), true)).rejects.toThrow(/difference/);
    const done = await bk.saveRecon(rec.id, items.map((i) => i.key), true);
    expect(done.balanced).toBe(true);
    // reconciled entries are locked
    const rent = await prisma.transaction.findFirstOrThrow({ where: { entityId, amount: 4200 } });
    await expect(bk.editTxn(rent.id, { amount: 4100 })).rejects.toThrow(/reconciled/);
    await expect(bk.deleteTxn(rent.id)).rejects.toThrow(/reconciled/);
    // but the category can still be corrected
    await bk.applyCategory(rent.id, await acct("Office Supplies"));
    await bk.applyCategory(rent.id, await acct("Rent"));
  });

  it("reconciles the card (amount owed)", async () => {
    // owed: 0 + 60 + 240 - 300 = 0
    const rec = await bk.startRecon(cardId, d("2026-10-31"), 0);
    const { items } = await bk.reconItems(rec.id);
    expect(items).toHaveLength(3);
    expect((await bk.saveRecon(rec.id, items.map((i) => i.key), true)).balanced).toBe(true);
  });

  it("exports one balanced QuickBooks file and never the same transaction twice", async () => {
    const pv = await bk.exportPreview(entityId, d("2026-10-31"));
    expect(pv.problems).toEqual([]);
    expect(pv.ready).toHaveLength(8);
    const batch = await bk.createExport(entityId, d("2026-10-31"));
    expect(batch.iif).toContain("TRNS\t\tCHECK\t10/01/2026\tZions Checking\tMaverik\t-150.00\t1042");
    expect(batch.iif).toContain("SPL\t\tCHECK\t10/08/2026\tPayroll Liabilities\t\t-900.00");
    // the card payment goes in once, as a check from the bank to the card, already cleared on both sides
    expect(batch.iif).toContain("TRNS\t\tCHECK\t10/20/2026\tZions Checking\t\t-300.00\t\t");
    expect(batch.iif).toMatch(/SPL\t\tCHECK\t10\/20\/2026\tChase Visa\t\t300\.00\t\t[^\t]*\tY/);
    expect(batch.iif.match(/^ENDTRNS/gm)?.length).toBe(8);
    expect((await bk.exportPreview(entityId, d("2026-10-31"))).ready).toHaveLength(0);
    // undo puts them back (only for a file that was never imported into QuickBooks)
    await bk.undoExport(batch.id);
    expect((await bk.exportPreview(entityId, d("2026-10-31"))).ready).toHaveLength(8);
    await bk.createExport(entityId, d("2026-10-31"));
  });

  it("sells the entity: history kept, refuses permanent delete", async () => {
    await bk.sellEntity(entityId, d("2026-12-31"));
    expect((await prisma.entity.findUniqueOrThrow({ where: { id: entityId } })).status).toBe("sold");
    await expect(bk.deleteEntity(entityId)).rejects.toThrow(/Mark it sold/);
    await bk.reactivateEntity(entityId);
    expect((await prisma.entity.findUniqueOrThrow({ where: { id: entityId } })).status).toBe("active");
  });
});
