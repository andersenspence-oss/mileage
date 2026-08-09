import { describe, it, expect } from "vitest";
import { findCandidates, matchReceipts, documentationCoverage, type ReceiptLite, type TxnForMatch } from "../lib/receipts";

const d = (s: string) => new Date(s + "T00:00:00");

const txns: TxnForMatch[] = [
  { id: "t1", date: d("2026-07-03"), amount: 42.1, flow: "out", vendor: "Chevron", accountName: "Auto & Fuel" },
  { id: "t2", date: d("2026-07-03"), amount: 42.1, flow: "out", vendor: "Maverik", accountName: "Auto & Fuel" },
  { id: "t3", date: d("2026-07-10"), amount: 250, flow: "out", vendor: "Marriott", accountName: "Travel & Conferences" },
  { id: "t4", date: d("2026-07-11"), amount: 995, flow: "in", vendor: "Client", accountName: "Income" },
];

describe("findCandidates", () => {
  it("matches by amount + date window, ranks vendor matches higher", () => {
    const r: ReceiptLite = { id: "r1", date: d("2026-07-03"), amount: 42.1, vendor: "Chevron #123" };
    const c = findCandidates(r, txns);
    expect(c).toHaveLength(2);
    expect(c[0].transactionId).toBe("t1"); // vendor similarity wins the tie
    expect(c[0].reason).toContain("vendor matches");
  });

  it("never matches money-in transactions or amounts far apart", () => {
    const r: ReceiptLite = { id: "r2", date: d("2026-07-11"), amount: 995, vendor: "Client" };
    expect(findCandidates(r, txns)).toHaveLength(0);
    const r2: ReceiptLite = { id: "r3", date: d("2026-07-10"), amount: 500, vendor: "Marriott" };
    expect(findCandidates(r2, txns)).toHaveLength(0);
  });

  it("respects the date window", () => {
    const r: ReceiptLite = { id: "r4", date: d("2026-07-25"), amount: 250, vendor: "Marriott" };
    expect(findCandidates(r, txns)).toHaveLength(0);
  });
});

describe("matchReceipts", () => {
  it("auto-matches only clear single candidates", () => {
    const receipts: ReceiptLite[] = [
      { id: "amb", date: d("2026-07-03"), amount: 42.1, vendor: null }, // two equal candidates -> not auto
      { id: "clear", date: d("2026-07-10"), amount: 250, vendor: "Marriott" }, // one strong candidate -> auto
    ];
    const results = matchReceipts(receipts, txns);
    const byId = new Map(results.map((r) => [r.receiptId, r]));
    expect(byId.get("amb")!.auto).toBe(false);
    expect(byId.get("amb")!.candidate).not.toBeNull(); // still suggested
    expect(byId.get("clear")!.auto).toBe(true);
    expect(byId.get("clear")!.candidate!.transactionId).toBe("t3");
  });

  it("never lets two receipts auto-claim the same transaction", () => {
    const receipts: ReceiptLite[] = [
      { id: "a", date: d("2026-07-10"), amount: 250, vendor: "Marriott" },
      { id: "b", date: d("2026-07-10"), amount: 250, vendor: "Marriott" },
    ];
    const results = matchReceipts(receipts, txns);
    const autos = results.filter((r) => r.auto);
    expect(autos).toHaveLength(1);
  });
});

describe("documentationCoverage", () => {
  it("counts only receipt-sensitive categories at or above the floor", () => {
    const stats = documentationCoverage(
      [
        { id: "t1", accountName: "Auto & Fuel", amount: 100, flow: "out" },
        { id: "t2", accountName: "Travel & Conferences", amount: 250, flow: "out" },
        { id: "t3", accountName: "Rent", amount: 4000, flow: "out" }, // not sensitive
        { id: "t4", accountName: "Meals & Entertainment", amount: 40, flow: "out" }, // under floor
      ],
      new Set(["t1"])
    );
    expect(stats.sensitiveCount).toBe(2);
    expect(stats.documentedCount).toBe(1);
    expect(stats.coverage).toBe(0.5);
  });
});
