import { describe, it, expect } from "vitest";
import { EVALUATORS, runAnalyzer, type AnalyzerContext } from "../lib/strategies/analyzer";
import { ASSUMPTIONS } from "../lib/assumptions";
import type { Intake } from "../lib/intake";
import type { EntityBooks } from "../lib/strategies/books";

// Fixture: a simplified version of the real group.
function makeIntake(overrides: Partial<Intake> = {}): Intake {
  const base: Intake = {
    owner: { state: "UT", filingStatus: "married_joint", fedMarginalRate: 0.32 },
    family: { spouseInvolved: true, childrenEmployable: 2, childrenAges: [] },
    home: { officeUsed: true, officePercent: 10, annualHomeCosts: 40000, augustaMeetingsPerYear: 20, localDailyVenueRate: 500 },
    vehicles: { businessMilesPerYear: 10000, heavyVehicle: false },
    retirement: { solo401kActive: false, currentAnnualContribution: 0 },
    health: { hdhpCoverage: true, hsaContribution: 2000, annualOutOfPocketMedical: 5000 },
    planning: { plannedEquipmentPurchases: 20000, ownerPaidBusinessCosts: 3000 },
    entities: {
      clinic: { role: "clinic", ownershipPercent: 100, taxTreatment: "single_member_llc", confirmed: true, ownsRealEstate: "no", rentsToGroup: "no" },
      rental: { role: "rental_realestate", ownershipPercent: 100, taxTreatment: "single_member_llc", confirmed: true, ownsRealEstate: "yes", rentsToGroup: "unknown" },
    },
    goals: "",
  };
  return { ...base, ...overrides };
}

const clinicBooks: EntityBooks = {
  slug: "clinic", name: "Clinic", income12: 500000, expense12: 380000, net12: 120000,
  spendByAccount: { Rent: 48000, "Software & Subscriptions": 6000, "Marketing & Advertising": 24000, Insurance: 8000 },
  fixedAssets: [{ name: "Clinic Equipment", balance: 100000, subtype: null }],
  rentPaid: 48000, autoFuelSpend: 3000,
};

const rentalBooks: EntityBooks = {
  slug: "rental", name: "Rental LLC", income12: 48000, expense12: 30000, net12: 18000,
  spendByAccount: { "Mortgage Interest": 15000 },
  fixedAssets: [{ name: "Rental Property", balance: 400000, subtype: "building" }],
  rentPaid: 0, autoFuelSpend: 0,
};

const ctx = (intake = makeIntake()): AnalyzerContext => ({ intake, books: [clinicBooks, rentalBooks] });

const combinedRate = 0.32 + ASSUMPTIONS.ut_state_rate.value;

describe("s_corp_election", () => {
  it("estimates SE-tax savings for a profitable default LLC and shows its math", () => {
    const r = EVALUATORS.s_corp_election(ctx());
    expect(r.relevant).toBe(true);
    // net 120000 -> salary 50k floor? 40% of 120k = 48k -> floored at 50k
    const seNow = 0.153 * Math.min(120000 * 0.9235, ASSUMPTIONS.ss_wage_base.value);
    const seAfter = 0.153 * 50000;
    const expected = Math.round(seNow - seAfter - 2500);
    expect(r.estimatedSavings).toBe(expected);
    expect(r.trace.length).toBeGreaterThan(3);
    expect(r.cpaChecklist.join(" ")).toMatch(/reasonable salary/i);
  });

  it("is not relevant when the entity is already an S-corp", () => {
    const intake = makeIntake();
    intake.entities.clinic.taxTreatment = "s_corp";
    const r = EVALUATORS.s_corp_election(ctx(intake));
    expect(r.relevant).toBe(false);
    expect(r.estimatedSavings).toBe(0);
  });
});

describe("augusta_rule", () => {
  it("caps rentable days at the statutory limit", () => {
    const r = EVALUATORS.augusta_rule(ctx()); // intake says 20 meetings
    expect(r.relevant).toBe(true);
    const expected = Math.round(14 * 500 * combinedRate); // capped at 14
    expect(r.estimatedSavings).toBe(expected);
    expect(r.trace.some((s) => s.label.includes("Capped"))).toBe(true);
  });

  it("is not relevant with no home meetings", () => {
    const intake = makeIntake();
    intake.home.augustaMeetingsPerYear = 0;
    expect(EVALUATORS.augusta_rule(ctx(intake)).relevant).toBe(false);
  });
});

describe("hire_family", () => {
  it("multiplies children by the standard-deduction wage cap", () => {
    const r = EVALUATORS.hire_family(ctx());
    const expected = Math.round(2 * ASSUMPTIONS.standard_deduction_single.value * combinedRate);
    expect(r.estimatedSavings).toBe(expected);
    expect(r.cpaChecklist.join(" ")).toMatch(/FICA/);
  });
});

describe("hsa", () => {
  it("only counts unused room", () => {
    const r = EVALUATORS.hsa(ctx()); // limit 8550, contributed 2000
    const expected = Math.round((ASSUMPTIONS.hsa_family_limit.value - 2000) * combinedRate);
    expect(r.estimatedSavings).toBe(expected);
  });

  it("is not relevant without HDHP coverage", () => {
    const intake = makeIntake();
    intake.health.hdhpCoverage = false;
    expect(EVALUATORS.hsa(ctx(intake)).relevant).toBe(false);
  });
});

describe("income_shifting honesty", () => {
  it("declines to claim savings when everything passes through to the same owner", () => {
    // both entities profitable in the fixture -> also not relevant; force a loss
    const books = [clinicBooks, { ...rentalBooks, net12: -20000 }];
    const r = EVALUATORS.income_shifting({ intake: makeIntake(), books });
    expect(r.relevant).toBe(false);
    expect(r.summary).toMatch(/already offset/i);
  });
});

describe("cost_segregation", () => {
  it("uses building basis and flags the bonus percentage for verification", () => {
    const r = EVALUATORS.cost_segregation(ctx());
    expect(r.relevant).toBe(true);
    const expected = Math.round(400000 * 0.25 * 1.0 * combinedRate);
    expect(r.estimatedSavings).toBe(expected);
    expect(r.trace.some((s) => /VERIFY/.test(s.note ?? ""))).toBe(true);
  });

  it("is not relevant below the basis threshold", () => {
    const books = [clinicBooks, { ...rentalBooks, fixedAssets: [{ name: "Rental Property", balance: 100000, subtype: "building" }] }];
    expect(EVALUATORS.cost_segregation({ intake: makeIntake(), books }).relevant).toBe(false);
  });
});

describe("insurance_cashflow guardrail", () => {
  it("never claims current-year savings", () => {
    const r = EVALUATORS.insurance_cashflow(ctx());
    expect(r.estimatedSavings).toBe(0);
  });
});

describe("runAnalyzer", () => {
  it("ranks relevant strategies by savings and skips disabled ones", () => {
    const strategies = [
      { id: "s_corp_election", effort: 3, enabled: true },
      { id: "augusta_rule", effort: 1, enabled: true },
      { id: "hsa", effort: 1, enabled: false },
    ];
    const results = runAnalyzer(ctx(), strategies);
    expect(results.map((r) => r.strategyId)).not.toContain("hsa");
    const relevant = results.filter((r) => r.relevant);
    for (let i = 1; i < relevant.length; i++) {
      expect(relevant[i - 1].estimatedSavings).toBeGreaterThanOrEqual(relevant[i].estimatedSavings);
    }
  });

  it("every relevant result with savings has a math trace and CPA checklist", () => {
    const strategies = Object.keys(EVALUATORS).map((id) => ({ id, effort: 2, enabled: true }));
    const results = runAnalyzer(ctx(), strategies);
    for (const r of results.filter((x) => x.relevant && x.estimatedSavings > 0)) {
      expect(r.trace.length, `${r.strategyId} must show its math`).toBeGreaterThan(0);
      expect(r.cpaChecklist.length, `${r.strategyId} must tell the CPA what to verify`).toBeGreaterThan(0);
    }
  });
});
