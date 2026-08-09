import { describe, it, expect } from "vitest";
import { detectDuplicates, detectUnusualAmounts, detectPossiblePersonal, detectAll, type TxnForAnomaly } from "../lib/anomalies";

const d = (s: string) => new Date(s + "T00:00:00");
const base = { entityId: "e1", accountId: "a1", accountName: "Supplies", flow: "out" };

describe("detectDuplicates", () => {
  it("flags same vendor + amount within the window", () => {
    const txns: TxnForAnomaly[] = [
      { ...base, id: "t1", date: d("2026-03-01"), amount: 500, vendor: "Acme" },
      { ...base, id: "t2", date: d("2026-03-02"), amount: 500, vendor: "Acme" },
    ];
    const flags = detectDuplicates(txns);
    expect(flags).toHaveLength(1);
    expect(flags[0].transactionId).toBe("t2");
    expect(flags[0].kind).toBe("duplicate");
  });

  it("ignores matches outside the window or across entities", () => {
    const txns: TxnForAnomaly[] = [
      { ...base, id: "t1", date: d("2026-03-01"), amount: 500, vendor: "Acme" },
      { ...base, id: "t2", date: d("2026-03-20"), amount: 500, vendor: "Acme" },
      { ...base, id: "t3", entityId: "e2", date: d("2026-03-01"), amount: 500, vendor: "Acme" },
    ];
    expect(detectDuplicates(txns)).toHaveLength(0);
  });
});

describe("detectUnusualAmounts", () => {
  it("flags a charge far above the account's normal range", () => {
    const txns: TxnForAnomaly[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        ...base, id: `n${i}`, date: d(`2026-01-${String(i + 1).padStart(2, "0")}`), amount: 100 + i, vendor: "Normal Vendor",
      })),
      { ...base, id: "big", date: d("2026-02-01"), amount: 2000, vendor: "Normal Vendor" },
    ];
    const flags = detectUnusualAmounts(txns);
    expect(flags.some((f) => f.transactionId === "big")).toBe(true);
  });
});

describe("detectPossiblePersonal", () => {
  it("flags personal-looking vendors", () => {
    const txns: TxnForAnomaly[] = [
      { ...base, id: "p1", date: d("2026-03-01"), amount: 220, vendor: "Costco Wholesale" },
      { ...base, id: "b1", date: d("2026-03-01"), amount: 220, vendor: "MedLine Supply" },
    ];
    const flags = detectPossiblePersonal(txns);
    expect(flags.map((f) => f.transactionId)).toEqual(["p1"]);
  });
});

describe("detectAll", () => {
  it("dedupes to one flag per transaction+kind", () => {
    const txns: TxnForAnomaly[] = [
      { ...base, id: "t1", date: d("2026-03-01"), amount: 500, vendor: "Costco" },
      { ...base, id: "t2", date: d("2026-03-02"), amount: 500, vendor: "Costco" },
    ];
    const flags = detectAll(txns);
    const keys = flags.map((f) => `${f.transactionId}|${f.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
