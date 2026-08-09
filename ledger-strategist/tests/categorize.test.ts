import { describe, it, expect } from "vitest";
import { ruleSuggest, type TxnForSuggestion, type VendorHistory } from "../lib/categorize";

const txn: TxnForSuggestion = {
  id: "t1", vendor: "Google Ads", description: "Card purchase", amount: 340,
  date: new Date("2026-05-01"), entityName: "Clinic", entityKind: "clinic",
};

describe("ruleSuggest", () => {
  it("prefers a learned vendor rule and grows confidence with hits", () => {
    const s = ruleSuggest(txn, [{ vendorPattern: "google ads", accountName: "Marketing & Advertising", hits: 4 }], new Map());
    expect(s?.suggestedAccountName).toBe("Marketing & Advertising");
    expect(s?.confidence).toBeGreaterThan(0.85);
    expect(s?.source).toBe("rule");
  });

  it("falls back to vendor history with at least 2 occurrences", () => {
    const history: VendorHistory = new Map([["google ads", { accountName: "Marketing & Advertising", count: 3 }]]);
    const s = ruleSuggest(txn, [], history);
    expect(s?.suggestedAccountName).toBe("Marketing & Advertising");
    expect(s?.rationale).toContain("3 past transactions");
  });

  it("returns null with no rule, thin history, or no vendor", () => {
    expect(ruleSuggest(txn, [], new Map([["google ads", { accountName: "X", count: 1 }]]))).toBeNull();
    expect(ruleSuggest({ ...txn, vendor: null }, [], new Map())).toBeNull();
  });

  it("caps confidence below 1", () => {
    const s = ruleSuggest(txn, [{ vendorPattern: "google", accountName: "Marketing & Advertising", hits: 50 }], new Map());
    expect(s!.confidence).toBeLessThanOrEqual(0.98);
  });
});
