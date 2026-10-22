import { describe, it, expect } from "vitest";
import {
  parseCsv, guessMapping, normalizeRows, fingerprints, parseAmount, parseDate, cleanVendor, pickMatch,
} from "../lib/bankImport";

const run = (csv: string, type: "bank" | "credit_card" = "bank") => {
  const rows = parseCsv(csv);
  const m = guessMapping(rows, type);
  return { m, ...normalizeRows(rows, m) };
};

describe("values", () => {
  it("reads the amount formats banks use", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("-45.12")).toBe(-45.12);
    expect(parseAmount("(45.12)")).toBe(-45.12);
    expect(parseAmount("45.12-")).toBe(-45.12);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("reads the date formats banks use", () => {
    const want = new Date(2026, 9, 5).getTime();
    for (const s of ["10/05/2026", "10/5/26", "2026-10-05", "Oct 5, 2026", "20261005", "10/05/2026 08:14 AM"]) {
      expect(parseDate(s)?.getTime(), s).toBe(want);
    }
    expect(parseDate("05/10/2026", "dmy")?.getTime()).toBe(want);
    expect(parseDate("13/45/2026")).toBeNull();
  });
});

describe("real bank layouts", () => {
  it("Chase checking (Posting Date, Amount, Check or Slip #)", () => {
    const { rows, errors } = run(
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,\n" +
      "DEBIT,10/02/2026,\"MAVERIK #423 ST GEORGE UT\",-45.12,DEBIT_CARD,9954.88,,\n" +
      "CHECK,10/03/2026,CHECK 1042,-1200.00,CHECK_PAID,8754.88,1042,\n" +
      "CREDIT,10/04/2026,\"SIEGFRIED & JENSEN PAYMENT, INC\",5000.00,ACH_CREDIT,13754.88,,\n"
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.amount)).toEqual([-45.12, -1200, 5000]);
    expect(rows[1].checkNum).toBe("1042");
    expect(rows[2].description).toBe("SIEGFRIED & JENSEN PAYMENT, INC");
  });

  it("Chase credit card (charges negative, payments positive)", () => {
    const { rows, m } = run(
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
      "10/01/2026,10/02/2026,CANVA,Professional Services,Sale,-14.99,\n" +
      "10/03/2026,10/04/2026,Payment Thank You-Mobile,,Payment,750.00,\n",
      "credit_card"
    );
    expect(m.flipSign).toBe(false);
    expect(rows.map((r) => r.amount)).toEqual([-14.99, 750]);
  });

  it("American Express (charges positive) gets its sign flipped", () => {
    const { rows, m } = run(
      "Date,Description,Amount\n10/01/2026,DELTA AIR LINES,412.30\n10/02/2026,SWIG ST GEORGE,8.75\n10/05/2026,AUTOPAY PAYMENT - THANK YOU,-1500.00\n",
      "credit_card"
    );
    expect(m.flipSign).toBe(true);
    expect(rows.map((r) => r.amount)).toEqual([-412.3, -8.75, 1500]);
  });

  it("Capital One (separate Debit and Credit columns)", () => {
    const { rows, m } = run(
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n" +
      "2026-10-01,2026-10-02,4412,AMAZON MKTPL,Merchandise,63.40,\n" +
      "2026-10-06,2026-10-06,4412,CAPITAL ONE ONLINE PYMT,Payment/Credit,,500.00\n",
      "credit_card"
    );
    expect(m.amountCol).toBeNull();
    expect(rows.map((r) => r.amount)).toEqual([-63.4, 500]);
  });

  it("Wells Fargo (no header row at all)", () => {
    const { rows } = run(
      '"10/04/2026","-45.12","*","","PURCHASE AUTHORIZED ON 10/03 MAVERIK ST GEORGE UT S386"\n' +
      '"10/05/2026","2500.00","*","","DEPOSIT"\n'
    );
    expect(rows.map((r) => [r.amount, r.description.slice(0, 9)])).toEqual([[-45.12, "PURCHASE "], [2500, "DEPOSIT"]]);
  });

  it("Bank of America (summary block above the real header)", () => {
    const { rows, errors } = run(
      "Description,,Summary Amt.\nBeginning balance as of 10/01/2026,,\"1,000.00\"\nTotal credits,,\"5,000.00\"\n\n" +
      "Date,Description,Amount,Running Bal.\n" +
      "10/01/2026,Beginning balance as of 10/01/2026,,\"1,000.00\"\n" +
      "10/02/2026,\"RED ROCK PROPERTIES DES:RENT ID:XXXXX1234\",\"-4,200.00\",\"-3,200.00\"\n"
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(-4200);
  });

  it("reports unreadable lines instead of dropping them", () => {
    const { rows, errors } = run("Date,Description,Amount\n10/01/2026,OK,-5.00\nyesterday,BAD,-6.00\n");
    expect(rows).toHaveLength(1);
    expect(errors[0].problem).toMatch(/date/);
  });
});

describe("duplicates", () => {
  it("same file twice gives the same fingerprints; identical same-day charges stay separate", () => {
    const csv = "Date,Description,Amount\n10/01/2026,CAR WASH,-5.00\n10/01/2026,CAR WASH,-5.00\n10/02/2026,CAR WASH,-5.00\n";
    const a = fingerprints(run(csv).rows);
    const b = fingerprints(run(csv).rows);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
  });
});

describe("matching entries already in the books", () => {
  const d = (s: string) => new Date(s + "T00:00:00");
  const row = (o: object) => ({ line: 1, date: d("2026-10-06"), description: "x", amount: -1200, checkNum: null, memo: null, ...o });
  const cands = [
    { txnId: "a", date: d("2026-10-01"), amount: -1200, checkNum: "1041" },
    { txnId: "b", date: d("2026-10-04"), amount: -1200, checkNum: "1042" },
    { txnId: "c", date: d("2026-10-05"), amount: -1200, checkNum: null },
  ];
  it("prefers the matching check number", () => {
    expect(pickMatch(row({ checkNum: "1042" }), cands)?.txnId).toBe("b");
  });
  it("otherwise the closest date", () => {
    expect(pickMatch(row({}), cands)?.txnId).toBe("c");
  });
  it("never matches a different amount, direction, or a date more than a week off", () => {
    expect(pickMatch(row({ amount: -1199.99 }), cands)).toBeNull();
    expect(pickMatch(row({ amount: 1200 }), cands)).toBeNull();
    expect(pickMatch(row({ date: d("2026-11-01") }), cands)).toBeNull();
  });
});

describe("payee cleanup", () => {
  it("strips bank noise", () => {
    expect(cleanVendor("POS PURCHASE MAVERIK #423 ST GEORGE UT 10/04")).toBe("Maverik St George");
    expect(cleanVendor("RED ROCK PROPERTIES DES:RENT ID:XXXXX1234")).toMatch(/^Red Rock Properties/);
  });
});
