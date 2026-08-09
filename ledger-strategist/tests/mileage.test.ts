import { describe, it, expect } from "vitest";
import { parseCsv, parseMileageCsv, summarizeTrips } from "../lib/mileage";
import { EVALUATORS } from "../lib/strategies/analyzer";
import type { Intake } from "../lib/intake";
import type { EntityBooks } from "../lib/strategies/books";

// A CSV in the exact shape the Mileage Log app exports (headers by name,
// including quoted fields, $ signs, voided rows, and in-progress rows).
const SAMPLE_CSV = [
  `Date,Where,What,Trip miles,Begin Mileage,End Mileage,Notes,Category,Who's Phone / Driver,Rate per Mile,Deduction $,Vehicle,Business Purpose,Fuel Total $,Receipt Photo,Flags,Entry ID`,
  `2026-07-01,St George,Patient visits,24.5,50000,50024.5,,Whiplash Center of Utah,Spence,$0.76,$18.62,Kia Sorento,"Clinic rounds, hospital",,,ok,e1`,
  `2026-07-03,Hurricane,Race setup,60,50100,50160,"Cones, tables",Running Wild Utah,Carey,$0.76,$45.60,Lexus ES350,Event setup,$42.10,https://drive.google.com/x1,ok,e2`,
  `07/10/2026,SLC,Conference,290,,,,PI Warriors,Spence,$0.76,$220.40,Kia Sorento,Podcast conference,$55.00,https://drive.google.com/x2,ok,e3`,
  `2026-07-12,Home,Errand,12,,,,Personal,Carey,,,Lexus ES350,,,,ok,e4`,
  `2026-07-15,St George,Supply run,18,,,,Misc. Business,Spence,$0.76,$13.68,Kia Sorento,Supplies,,,ok,e5`,
  `2026-07-20,Voided trip,Mistake,50,,,,Whiplash Center of Utah,Spence,$0.76,$38.00,Kia Sorento,,,,VOID,e6`,
  `2026-07-22,In progress,,,,,,Whiplash Center of Utah,Spence,,,,,,,ok,e7`,
].join("\n");

describe("parseCsv", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('a,"b, with comma","say ""hi"""\nc,d,e');
    expect(rows).toEqual([["a", "b, with comma", 'say "hi"'], ["c", "d", "e"]]);
  });
});

describe("parseMileageCsv", () => {
  const { trips, skipped } = parseMileageCsv(SAMPLE_CSV);

  it("imports valid trips and skips voided/in-progress rows", () => {
    expect(trips).toHaveLength(5);
    expect(skipped).toBe(2); // VOID row + no-miles row
  });

  it("maps trip categories to entities", () => {
    const byId = new Map(trips.map((t) => [t.entryId, t]));
    expect(byId.get("e1")?.entitySlug).toBe("whiplash");
    expect(byId.get("e2")?.entitySlug).toBe("running-wild");
    expect(byId.get("e3")?.entitySlug).toBe("pi-warriors");
    expect(byId.get("e4")?.entitySlug).toBeNull();
    expect(byId.get("e4")?.business).toBe(false); // Personal
    expect(byId.get("e5")?.entitySlug).toBeNull();
    expect(byId.get("e5")?.business).toBe(true); // Misc. Business
  });

  it("parses dollars, rates, both date formats, and receipt links", () => {
    const e3 = trips.find((t) => t.entryId === "e3")!;
    expect(e3.date.getMonth()).toBe(6); // July, from US-format 07/10/2026
    expect(e3.deduction).toBe(220.4);
    expect(e3.fuelTotal).toBe(55);
    expect(e3.receiptPhoto).toContain("drive.google.com");
  });
});

describe("summarizeTrips", () => {
  const { trips } = parseMileageCsv(SAMPLE_CSV);
  const now = new Date(2026, 7, 9); // Aug 9 2026 — all sample trips in window
  const s = summarizeTrips(trips, now, 0.7);

  it("totals business miles and logged deductions, excluding personal", () => {
    expect(s.businessMiles12).toBe(Math.round(24.5 + 60 + 290 + 18));
    expect(s.loggedDeduction12).toBe(Math.round(18.62 + 45.6 + 220.4 + 13.68));
    expect(s.personalMiles12).toBe(12);
    expect(s.tripCount12).toBe(4);
  });

  it("breaks miles down by entity and vehicle", () => {
    expect(s.byEntity["whiplash"]).toBe(25);
    expect(s.byEntity["running-wild"]).toBe(60);
    expect(s.byEntity["misc"]).toBe(18);
    expect(s.byVehicle["Kia Sorento"]).toBe(Math.round(24.5 + 290 + 18));
  });

  it("excludes trips outside the 12-month window", () => {
    const old = summarizeTrips(trips, new Date(2028, 0, 1), 0.7);
    expect(old.businessMiles12).toBe(0);
  });
});

describe("vehicle_strategy with a synced mileage log", () => {
  const intake: Intake = {
    owner: { state: "UT", filingStatus: "married_joint", fedMarginalRate: 0.32 },
    family: { spouseInvolved: false, childrenEmployable: 0, childrenAges: [] },
    home: { officeUsed: false, officePercent: 0, annualHomeCosts: 0, augustaMeetingsPerYear: 0, localDailyVenueRate: 0 },
    vehicles: { businessMilesPerYear: 8000, heavyVehicle: false }, // stale estimate
    retirement: { solo401kActive: false, currentAnnualContribution: 0 },
    health: { hdhpCoverage: false, hsaContribution: 0, annualOutOfPocketMedical: 0 },
    planning: { plannedEquipmentPurchases: 0, ownerPaidBusinessCosts: 0 },
    entities: {},
    goals: "",
  };
  const books: EntityBooks[] = [{
    slug: "clinic", name: "Clinic", income12: 100000, expense12: 50000, net12: 50000,
    spendByAccount: {}, fixedAssets: [], rentPaid: 0, autoFuelSpend: 2000,
  }];
  const { trips } = parseMileageCsv(SAMPLE_CSV);
  const mileage = summarizeTrips(trips, new Date(2026, 7, 9), 0.7);

  it("uses real logged miles + logged deduction instead of the intake estimate", () => {
    const r = EVALUATORS.vehicle_strategy({ intake, books, mileage });
    expect(r.relevant).toBe(true);
    const combinedRate = 0.32 + 0.0455;
    expect(r.estimatedSavings).toBe(Math.round(mileage.loggedDeduction12 * combinedRate));
    expect(r.trace.some((s) => s.label.includes("from your mileage log"))).toBe(true);
    expect(r.summary).toContain("mileage log");
  });

  it("warns about double-dipping when the books also expense fuel", () => {
    const r = EVALUATORS.vehicle_strategy({ intake, books, mileage });
    expect(r.cpaChecklist.join(" ")).toMatch(/backed out/i);
  });

  it("falls back to the intake estimate when no log is synced", () => {
    const r = EVALUATORS.vehicle_strategy({ intake, books });
    expect(r.trace.some((s) => s.label.includes("intake estimate"))).toBe(true);
    const combinedRate = 0.32 + 0.0455;
    expect(r.estimatedSavings).toBe(Math.round(8000 * 0.7 * combinedRate));
  });
});
