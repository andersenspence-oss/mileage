// Central tax assumptions used by the strategy analyzer.
// EVERY number here is year-sensitive and must be re-verified for the current
// tax year with a CPA. needsVerification: true is deliberate on all of them —
// the UI surfaces that flag next to any figure derived from these.

export type Assumption = {
  key: string;
  label: string;
  value: number;
  unit: "rate" | "usd" | "miles_rate" | "count";
  basis: string; // where the number comes from
  needsVerification: true;
};

export const ASSUMPTIONS: Record<string, Assumption> = {
  fed_marginal_rate: {
    key: "fed_marginal_rate",
    label: "Assumed federal marginal income tax rate",
    value: 0.32,
    unit: "rate",
    basis: "Owner estimate from intake (default 32% bracket). Actual bracket depends on total taxable income.",
    needsVerification: true,
  },
  ut_state_rate: {
    key: "ut_state_rate",
    label: "Utah flat individual income tax rate",
    value: 0.0455,
    unit: "rate",
    basis: "Utah flat tax, approx. 4.55% (recent years). Utah has adjusted this rate several times.",
    needsVerification: true,
  },
  se_tax_rate: {
    key: "se_tax_rate",
    label: "Self-employment tax rate (SS + Medicare, combined)",
    value: 0.153,
    unit: "rate",
    basis: "15.3% up to the Social Security wage base; 2.9-3.8% Medicare above it.",
    needsVerification: true,
  },
  ss_wage_base: {
    key: "ss_wage_base",
    label: "Social Security wage base",
    value: 176100,
    unit: "usd",
    basis: "2025 figure ($176,100). Changes every year.",
    needsVerification: true,
  },
  augusta_day_limit: {
    key: "augusta_day_limit",
    label: "Augusta rule maximum rental days",
    value: 14,
    unit: "count",
    basis: "IRC §280A(g): dwelling rented fewer than 15 days/year.",
    needsVerification: true,
  },
  mileage_rate: {
    key: "mileage_rate",
    label: "IRS standard mileage rate",
    value: 0.7,
    unit: "miles_rate",
    basis: "$0.70/mile (2025). The IRS updates this annually.",
    needsVerification: true,
  },
  solo_401k_employee_limit: {
    key: "solo_401k_employee_limit",
    label: "401(k) employee deferral limit",
    value: 23500,
    unit: "usd",
    basis: "2025 figure ($23,500), plus catch-up if 50+. Changes annually.",
    needsVerification: true,
  },
  retirement_total_limit: {
    key: "retirement_total_limit",
    label: "Total defined-contribution limit (employee + employer)",
    value: 70000,
    unit: "usd",
    basis: "2025 §415(c) limit ($70,000). Changes annually.",
    needsVerification: true,
  },
  hsa_family_limit: {
    key: "hsa_family_limit",
    label: "HSA family contribution limit",
    value: 8550,
    unit: "usd",
    basis: "2025 family limit ($8,550). Changes annually; requires HDHP coverage.",
    needsVerification: true,
  },
  sec179_limit: {
    key: "sec179_limit",
    label: "Section 179 expensing limit",
    value: 1250000,
    unit: "usd",
    basis: "2025 limit (~$1.25M) with phase-out. Bonus depreciation percentage also varies by year.",
    needsVerification: true,
  },
  standard_deduction_single: {
    key: "standard_deduction_single",
    label: "Standard deduction (single filer, e.g. a child employee)",
    value: 15000,
    unit: "usd",
    basis: "2025 figure ($15,000). A child employee can earn up to this federal-income-tax-free.",
    needsVerification: true,
  },
  perdiem_mie_standard: {
    key: "perdiem_mie_standard",
    label: "M&IE per diem — standard rate (high-low method)",
    value: 68,
    unit: "usd",
    basis: "IRS high-low method M&IE rate, ~$68/day (2025 notice). Updated every October.",
    needsVerification: true,
  },
  perdiem_mie_high: {
    key: "perdiem_mie_high",
    label: "M&IE per diem — high-cost locality rate",
    value: 80,
    unit: "usd",
    basis: "IRS high-low method high-cost M&IE rate, ~$80/day. Locality list changes annually.",
    needsVerification: true,
  },
  qbi_deduction_rate: {
    key: "qbi_deduction_rate",
    label: "Qualified Business Income deduction rate",
    value: 0.2,
    unit: "rate",
    basis: "IRC §199A 20% deduction; phase-outs apply for SSTBs (health services) above income thresholds.",
    needsVerification: true,
  },
};

export function combinedIncomeRate(fedRate?: number): number {
  const fed = fedRate ?? ASSUMPTIONS.fed_marginal_rate.value;
  return fed + ASSUMPTIONS.ut_state_rate.value;
}
