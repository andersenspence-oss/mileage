import { describe, it, expect } from "vitest";
import { calcTrip, summarizePerDiem } from "../lib/perdiem";
import { EVALUATORS } from "../lib/strategies/analyzer";
import type { Intake } from "../lib/intake";
import type { EntityBooks } from "../lib/strategies/books";

const RATES = { standard: 68, highCost: 80 };
const d = (s: string) => new Date(s + "T00:00:00");

describe("calcTrip", () => {
  it("computes a 3-night standard trip: 2 full days + 2 travel days at 75%", () => {
    const c = calcTrip(
      { description: "Conf", destination: "Denver", startDate: d("2026-05-04"), endDate: d("2026-05-07"), highCost: false, travelers: 1 },
      RATES
    );
    expect(c.valid).toBe(true);
    expect(c.nights).toBe(3);
    expect(c.fullDays).toBe(2);
    // 2×68 + 2×68×0.75 = 136 + 102 = 238; ×50% meals limit = 119
    expect(c.mie).toBe(238);
    expect(c.deductible).toBe(119);
  });

  it("uses the high-cost rate and multiplies by travelers", () => {
    const c = calcTrip(
      { description: "Vegas", destination: "Las Vegas", startDate: d("2026-06-01"), endDate: d("2026-06-02"), highCost: true, travelers: 2 },
      RATES
    );
    // 1 night: 0 full days + 2 travel days ×0.75 ×80 ×2 travelers = 240
    expect(c.mie).toBe(240);
    expect(c.deductible).toBe(120);
  });

  it("rejects same-day trips — no overnight, no per diem", () => {
    const c = calcTrip(
      { description: "Day trip", destination: "SLC", startDate: d("2026-06-01"), endDate: d("2026-06-01"), highCost: false, travelers: 1 },
      RATES
    );
    expect(c.valid).toBe(false);
    expect(c.deductible).toBe(0);
  });
});

describe("summarizePerDiem", () => {
  it("totals valid trips inside the window and counts invalid ones", () => {
    const trips = [
      { description: "A", destination: "X", startDate: d("2026-05-04"), endDate: d("2026-05-07"), highCost: false, travelers: 1 },
      { description: "B", destination: "Y", startDate: d("2026-06-01"), endDate: d("2026-06-01"), highCost: false, travelers: 1 }, // invalid
      { description: "Old", destination: "Z", startDate: d("2024-01-01"), endDate: d("2024-01-03"), highCost: false, travelers: 1 }, // outside window
    ];
    const s = summarizePerDiem(trips, RATES, d("2025-08-01"), d("2026-08-01"));
    expect(s.tripCount).toBe(1);
    expect(s.invalidCount).toBe(1);
    expect(s.totalMie).toBe(238);
    expect(s.totalDeductible).toBe(119);
  });
});

describe("per_diem_travel evaluator", () => {
  const intake: Intake = {
    owner: { state: "UT", filingStatus: "married_joint", fedMarginalRate: 0.32 },
    family: { spouseInvolved: false, childrenEmployable: 0, childrenAges: [] },
    home: { officeUsed: false, officePercent: 0, annualHomeCosts: 0, augustaMeetingsPerYear: 0, localDailyVenueRate: 0 },
    vehicles: { businessMilesPerYear: 0, heavyVehicle: false },
    retirement: { solo401kActive: false, currentAnnualContribution: 0 },
    health: { hdhpCoverage: false, hsaContribution: 0, annualOutOfPocketMedical: 0 },
    planning: { plannedEquipmentPurchases: 0, ownerPaidBusinessCosts: 0 },
    entities: {},
    goals: "",
  };
  const books: EntityBooks[] = [{
    slug: "media", name: "Media Co", income12: 100000, expense12: 60000, net12: 40000,
    spendByAccount: { "Travel & Conferences": 4000 }, fixedAssets: [], rentPaid: 0, autoFuelSpend: 0,
  }];

  it("uses the logged per-diem summary and applies the marginal rate", () => {
    const perDiem = { tripCount: 2, nights: 5, totalMie: 600, totalDeductible: 300, invalidCount: 0 };
    const r = EVALUATORS.per_diem_travel({ intake, books, perDiem });
    expect(r.relevant).toBe(true);
    expect(r.estimatedSavings).toBe(Math.round(300 * (0.32 + 0.0455)));
    expect(r.trace.some((s) => /50% meals limit/.test(s.label))).toBe(true);
    expect(r.cpaChecklist.join(" ")).toMatch(/Lodging per diem is NOT allowed/);
  });

  it("nudges instead of estimating when travel spend exists but no trips are logged", () => {
    const r = EVALUATORS.per_diem_travel({ intake, books });
    expect(r.relevant).toBe(false);
    expect(r.estimatedSavings).toBe(0);
    expect(r.summary).toContain("no logged overnight trips");
  });
});
