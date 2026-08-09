// The strategy analyzer. For each library strategy it decides relevance from
// the intake + books, estimates the annual dollar impact deterministically,
// and records every step of the math (guardrail: no black-box numbers).
//
// All estimates are ESTIMATES for CPA discussion — never final advice.

import { ASSUMPTIONS, combinedIncomeRate } from "../assumptions";
import type { Intake } from "../intake";
import type { EntityBooks } from "./books";

export type TraceStep = { label: string; value?: number; note?: string };

export type EvalResult = {
  relevant: boolean;
  estimatedSavings: number;
  summary: string;
  trace: TraceStep[];
  cpaChecklist: string[];
};

export type AnalyzerContext = {
  intake: Intake;
  books: EntityBooks[];
};

const r0 = (n: number) => Math.round(n);
const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

function rateStep(intake: Intake): TraceStep[] {
  const fed = intake.owner.fedMarginalRate;
  const ut = ASSUMPTIONS.ut_state_rate.value;
  return [
    { label: "Assumed federal marginal rate (from your intake)", value: fed, note: "VERIFY current-year bracket with CPA" },
    { label: "Utah flat income tax rate", value: ut, note: "VERIFY current-year rate with CPA" },
    { label: "Combined marginal rate used below", value: fed + ut },
  ];
}

function operatingEntities(ctx: AnalyzerContext): EntityBooks[] {
  return ctx.books.filter((b) => {
    const role = ctx.intake.entities[b.slug]?.role ?? "operating";
    return role !== "rental_realestate" && role !== "holding" && role !== "dormant";
  });
}

function realEstateEntities(ctx: AnalyzerContext): EntityBooks[] {
  return ctx.books.filter((b) => {
    const ei = ctx.intake.entities[b.slug];
    return ei?.role === "rental_realestate" || ei?.ownsRealEstate !== "no";
  });
}

// ---------------------------------------------------------------------------
// One evaluator per strategy id.
// ---------------------------------------------------------------------------

type Evaluator = (ctx: AnalyzerContext) => EvalResult;

export const EVALUATORS: Record<string, Evaluator> = {
  s_corp_election(ctx) {
    const rate = ASSUMPTIONS.se_tax_rate.value;
    const wageBase = ASSUMPTIONS.ss_wage_base.value;
    const candidates = operatingEntities(ctx).filter((b) => {
      const t = ctx.intake.entities[b.slug]?.taxTreatment;
      return (t === "sole_prop" || t === "single_member_llc" || t === "partnership" || t === "unknown") && b.net12 >= 50000;
    });
    if (candidates.length === 0) {
      return {
        relevant: false, estimatedSavings: 0,
        summary: "No entity currently taxed as a sole proprietorship/default LLC shows $50k+ of profit — or they're already S-corps. Confirm each entity's tax treatment in the intake.",
        trace: [], cpaChecklist: [],
      };
    }
    const trace: TraceStep[] = [];
    const checklist = [
      "Confirm each entity's CURRENT tax classification (several are marked 'unknown' in the intake).",
      "Set a defensible reasonable salary for each electing entity (industry comps).",
      "Model QBI (§199A) interaction — clinics are SSTBs and may phase out.",
      "Check S-election deadlines (generally 2 months 15 days into the tax year, or late-election relief).",
    ];
    let total = 0;
    for (const b of candidates) {
      const salary = Math.min(Math.max(b.net12 * 0.4, 50000), 150000);
      const seNow = rate * Math.min(b.net12 * 0.9235, wageBase);
      const seAfter = rate * Math.min(salary, wageBase);
      const payrollCost = 2500;
      const savings = Math.max(0, seNow - seAfter - payrollCost);
      total += savings;
      trace.push(
        { label: `${b.name}: trailing 12-month net profit`, value: b.net12 },
        { label: `${b.name}: SE tax if untreated (15.3% × min(92.35% of net, wage base))`, value: r0(seNow), note: "VERIFY wage base for current year" },
        { label: `${b.name}: assumed reasonable salary (40% of net, floor $50k, cap $150k)`, value: r0(salary), note: "CPA must set the real number" },
        { label: `${b.name}: payroll tax on salary only`, value: r0(seAfter) },
        { label: `${b.name}: annual payroll/admin cost of S-corp`, value: payrollCost },
        { label: `${b.name}: estimated annual savings`, value: r0(savings) }
      );
    }
    return {
      relevant: true, estimatedSavings: r0(total),
      summary: `${candidates.length} entit${candidates.length === 1 ? "y" : "ies"} may be paying self-employment tax on profits that an S-corp structure could partially shelter. Estimated ${usd0(total)}/yr.`,
      trace, cpaChecklist: checklist,
    };
  },

  management_company(ctx) {
    const ops = operatingEntities(ctx);
    const overheadCategories = ["Software & Subscriptions", "Marketing & Advertising", "Insurance"];
    const trace: TraceStep[] = [];
    let duplicated = 0;
    for (const cat of overheadCategories) {
      const spends = ops.map((b) => b.spendByAccount[cat] ?? 0).filter((v) => v > 0);
      if (spends.length >= 2) {
        const catTotal = spends.reduce((s, v) => s + v, 0);
        duplicated += catTotal;
        trace.push({ label: `${cat}: paid separately by ${spends.length} entities (12-mo total)`, value: r0(catTotal) });
      }
    }
    if (duplicated === 0 || ops.length < 3) {
      return { relevant: false, estimatedSavings: 0, summary: "Not enough duplicated overhead across entities to justify a management company yet.", trace: [], cpaChecklist: [] };
    }
    const consolidationRate = 0.1;
    const savings = duplicated * consolidationRate;
    trace.push(
      { label: "Assumed hard savings from consolidating duplicated vendors/licenses (10%)", value: r0(savings), note: "Conservative consolidation estimate — the structural tax benefits come on top and need CPA modeling" }
    );
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `${ops.length} operating entities each pay their own software, marketing, and insurance. A management company centralizes that (est. ${usd0(savings)}/yr hard savings) and creates the chassis for group-level tax planning.`,
      trace,
      cpaChecklist: [
        "Draft arm's-length management service agreements between the management entity and each operating entity.",
        "Set fee levels a third party would defensibly charge (document the method).",
        "Confirm payroll/SE tax treatment of the management entity's income.",
        "Review Utah nexus and licensing effects.",
      ],
    };
  },

  income_shifting(ctx) {
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const treatments = Object.values(ctx.intake.entities).map((e) => e.taxTreatment);
    const allPassThroughSameOwner =
      Object.values(ctx.intake.entities).every((e) => e.ownershipPercent === 100) &&
      !treatments.includes("c_corp");
    const winners = ctx.books.filter((b) => b.net12 > 0);
    const losers = ctx.books.filter((b) => b.net12 < 0);
    const shiftable = Math.min(
      winners.reduce((s, b) => s + b.net12, 0),
      Math.abs(losers.reduce((s, b) => s + b.net12, 0))
    );
    if (losers.length === 0) {
      return { relevant: false, estimatedSavings: 0, summary: "All entities are profitable — no stranded losses to absorb via income shifting right now. Revisit if any entity dips into a loss.", trace: [], cpaChecklist: [] };
    }
    if (allPassThroughSameOwner) {
      return {
        relevant: false, estimatedSavings: 0,
        summary: `You show ${usd0(Math.abs(losers.reduce((s, b) => s + b.net12, 0)))} of losses, but if every entity passes through 100% to your personal return, those losses likely already offset the profits there. Income shifting adds value mainly when treatments or ownership differ — confirm treatments in the intake.`,
        trace: [], cpaChecklist: ["Confirm every entity's tax classification — this conclusion changes if any entity is a C-corp or has other owners."],
      };
    }
    const savings = shiftable * rate * 0.5;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `Profits and losses sit in entities with different tax treatments. Re-pointing real services/costs could put up to ${usd0(shiftable)} of income against unused losses.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Total profits in profitable entities (12 mo)", value: r0(winners.reduce((s, b) => s + b.net12, 0)) },
        { label: "Total losses in loss entities (12 mo)", value: r0(losers.reduce((s, b) => s + b.net12, 0)) },
        { label: "Shiftable amount (smaller of the two)", value: r0(shiftable) },
        { label: "Estimated benefit (× combined rate × 50% feasibility haircut)", value: r0(savings), note: "Every shifted dollar needs a real service behind it" },
      ],
      cpaChecklist: [
        "Model the group's before/after taxable income by entity.",
        "Paper every intercompany charge with agreements and invoices at arm's-length rates.",
      ],
    };
  },

  self_rental(ctx) {
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const re = realEstateEntities(ctx);
    const clinics = operatingEntities(ctx);
    const rentPaid = clinics.reduce((s, b) => s + b.rentPaid, 0);
    if (re.length === 0) {
      return { relevant: false, estimatedSavings: 0, summary: "No entity holds real estate per the intake.", trace: [], cpaChecklist: [] };
    }
    const unconfirmed = re.filter((b) => ctx.intake.entities[b.slug]?.ownsRealEstate === "unconfirmed");
    const shelteredShare = 0.7;
    const savings = rentPaid * shelteredShare * rate * 0.3;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `The clinics paid ${usd0(rentPaid)} rent in 12 months while the group holds ${re.length} real-estate entit${re.length === 1 ? "y" : "ies"}${unconfirmed.length ? ` (${unconfirmed.length} still unconfirmed in the intake)` : ""}. If group property can house the clinics — or already does informally — a papered self-rental arrangement shifts ordinary income into depreciation-sheltered rental income.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Rent clinics paid over 12 months", value: r0(rentPaid) },
        { label: "Portion typically shelterable by depreciation/interest at the rental entity (assumed 70%)", value: r0(rentPaid * shelteredShare), note: "Assumption — actual depends on each property's basis and debt" },
        { label: "Net benefit estimate (× rate × 30% realization factor)", value: r0(savings), note: "Conservative: assumes only part of clinic rent can move to group-owned space" },
      ],
      cpaChecklist: [
        "FIRST: confirm what each SandCastle LLC actually owns (marked unconfirmed in intake).",
        "Set fair-market rent with comps; sign real leases.",
        "Evaluate a §469 grouping election so self-rental income/losses net properly.",
      ],
    };
  },

  hire_family(ctx) {
    const kids = ctx.intake.family.childrenEmployable;
    if (kids <= 0) {
      return { relevant: false, estimatedSavings: 0, summary: "No employable children listed in the intake. Update it if that changes.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const perChild = ASSUMPTIONS.standard_deduction_single.value;
    const wage = Math.min(perChild, 15000);
    const savings = kids * wage * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `Paying ${kids} child${kids === 1 ? "" : "ren"} a fair wage for real work (content, filing, ads modeling) deducts up to ${usd0(wage)} each at your marginal rate — potentially income-tax-free to them.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Employable children (intake)", value: kids },
        { label: "Wage per child capped at the standard deduction", value: wage, note: "VERIFY current-year standard deduction" },
        { label: "Deduction shifted out of your bracket", value: r0(kids * wage) },
        { label: "Estimated annual savings", value: r0(savings), note: "FICA exemption depends on which entity pays — see checklist" },
      ],
      cpaChecklist: [
        "Choose the paying entity: the under-18 FICA exemption applies to a parent's sole proprietorship or a partnership of the parents — NOT an S-corp or C-corp.",
        "Document real, age-appropriate work with timesheets and reasonable hourly rates.",
        "Run real payroll and file W-2s.",
      ],
    };
  },

  augusta_rule(ctx) {
    const { augustaMeetingsPerYear: meetings, localDailyVenueRate: dayRate } = ctx.intake.home;
    const limit = ASSUMPTIONS.augusta_day_limit.value;
    if (meetings <= 0 || dayRate <= 0) {
      return { relevant: false, estimatedSavings: 0, summary: "Intake shows no business meetings held at your home. If you do hold planning days or team meetings, add them to the intake.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const days = Math.min(meetings, limit);
    const rent = days * dayRate;
    const savings = rent * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `${days} documented home meetings × ${usd0(dayRate)}/day market rate = ${usd0(rent)} of deductible rent to the business, received tax-free by you.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Meetings per year (intake)", value: meetings },
        { label: `Capped at the §280A(g) limit (${limit} days)`, value: days, note: "VERIFY limit still applies" },
        { label: "Fair local daily venue rate (intake)", value: dayRate, note: "Needs comps — hotel meeting-room quotes" },
        { label: "Tax-free rent", value: r0(rent) },
        { label: "Estimated annual savings", value: r0(savings) },
      ],
      cpaChecklist: [
        "Collect written comps for the daily rate.",
        "Keep agendas, minutes, and attendee lists for every meeting.",
        "Invoice the business and actually pay the rent; stay under 15 days.",
      ],
    };
  },

  home_office(ctx) {
    const { officeUsed, officePercent, annualHomeCosts } = ctx.intake.home;
    if (!officeUsed || officePercent <= 0 || annualHomeCosts <= 0) {
      return { relevant: false, estimatedSavings: 0, summary: "Intake says no regular-and-exclusive home office. Update it if you administer the group from home.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const reimb = annualHomeCosts * (officePercent / 100);
    const savings = reimb * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `Reimbursing ${officePercent}% of ${usd0(annualHomeCosts)} home costs under an accountable plan ≈ ${usd0(reimb)}/yr deductible to the business, tax-free to you.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Annual home costs (intake)", value: annualHomeCosts },
        { label: "Business-use percent (intake)", value: officePercent / 100 },
        { label: "Annual reimbursement", value: r0(reimb) },
        { label: "Estimated annual savings", value: r0(savings) },
      ],
      cpaChecklist: [
        "Confirm the space passes the regular-and-exclusive-use test.",
        "Adopt a written accountable plan; reimburse with documentation monthly or quarterly.",
      ],
    };
  },

  vehicle_strategy(ctx) {
    const miles = ctx.intake.vehicles.businessMilesPerYear;
    const autoSpend = ctx.books.reduce((s, b) => s + b.autoFuelSpend, 0);
    if (miles <= 0 && autoSpend < 500) {
      return { relevant: false, estimatedSavings: 0, summary: "No business mileage in the intake and minimal auto spend in the books.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const mileageRate = ASSUMPTIONS.mileage_rate.value;
    const deduction = miles * mileageRate;
    const savings = deduction * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `${miles.toLocaleString()} business miles × ${mileageRate.toFixed(2)}/mile ≈ ${usd0(deduction)} deduction${autoSpend > 0 ? ` (the books already show ${usd0(autoSpend)} of auto/fuel spend — pick ONE method per vehicle)` : ""}.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Business miles per year (intake)", value: miles },
        { label: "IRS standard mileage rate", value: mileageRate, note: "VERIFY current-year rate" },
        { label: "Mileage deduction", value: r0(deduction) },
        { label: "Auto/fuel already expensed in books (12 mo)", value: r0(autoSpend), note: "Can't double-dip: mileage method replaces actual fuel costs" },
        { label: "Estimated annual savings (mileage method)", value: r0(savings) },
      ],
      cpaChecklist: [
        "Keep a contemporaneous mileage log (app-based is fine).",
        "CPA picks mileage vs. actual-expense method per vehicle.",
        ctx.intake.vehicles.heavyVehicle
          ? "Heavy vehicle flagged: evaluate §179/bonus if business use >50% — big first-year deduction possible."
          : "If you buy a >6,000 lb GVWR vehicle for the business, revisit — large first-year write-offs may apply.",
      ],
    };
  },

  solo_401k(ctx) {
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const groupNet = ctx.books.reduce((s, b) => s + Math.max(0, b.net12), 0);
    if (groupNet < 30000) {
      return { relevant: false, estimatedSavings: 0, summary: "Group profits are currently too small to fund meaningful retirement contributions.", trace: [], cpaChecklist: [] };
    }
    const empLimit = ASSUMPTIONS.solo_401k_employee_limit.value;
    const totalLimit = ASSUMPTIONS.retirement_total_limit.value;
    const current = ctx.intake.retirement.currentAnnualContribution;
    const employerEst = Math.min(groupNet * 0.25, totalLimit - empLimit);
    const room = Math.max(0, Math.min(empLimit + employerEst, totalLimit) - current);
    const savings = room * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `Roughly ${usd0(room)} of unused retirement contribution room (employee deferral + employer profit share). Doubling up with a spouse on payroll can add more.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Group net profit (12 mo, profitable entities)", value: r0(groupNet) },
        { label: "Employee deferral limit", value: empLimit, note: "VERIFY current-year limit" },
        { label: "Employer share estimate (25% of comp, capped)", value: r0(employerEst), note: "Depends on chosen salary/comp structure" },
        { label: "Current contributions (intake)", value: current },
        { label: "Unused room", value: r0(room), note: `Total cap ${usd0(totalLimit)} — VERIFY` },
        { label: "Estimated tax deferred this year", value: r0(savings), note: "Deferral, not permanent — taxed on withdrawal" },
      ],
      cpaChecklist: [
        "CRITICAL: controlled-group analysis across all 8 entities — clinic employees can force plan coverage testing group-wide. Do not adopt a solo plan without this.",
        "Decide Solo 401(k) vs SEP vs full 401(k) with a TPA.",
        "Coordinate contribution timing with payroll before year-end.",
      ],
    };
  },

  defined_benefit(ctx) {
    const groupNet = ctx.books.reduce((s, b) => s + Math.max(0, b.net12), 0);
    if (groupNet < 400000) {
      return { relevant: false, estimatedSavings: 0, summary: `Defined benefit plans start making sense around $400k+ of stable group profit (currently ~${usd0(groupNet)}). Revisit as profits grow.`, trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const contribution = Math.min(150000, groupNet * 0.25);
    const savings = contribution * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `Group profits (~${usd0(groupNet)}) could support an actuarially designed plan contributing ~${usd0(contribution)}/yr pre-tax on top of a 401(k).`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Group net profit (12 mo)", value: r0(groupNet) },
        { label: "Placeholder contribution (25% of profit, cap $150k)", value: r0(contribution), note: "REAL number requires an actuary — depends on age and comp history" },
        { label: "Estimated tax deferred", value: r0(savings), note: "Deferral, not permanent savings" },
      ],
      cpaChecklist: [
        "ADVANCED: engage an actuary/TPA for a feasibility study.",
        "Controlled-group and employee-coverage analysis across the clinics is mandatory.",
        "Commit only if profits are stable — funding obligations recur annually.",
      ],
    };
  },

  hsa(ctx) {
    if (!ctx.intake.health.hdhpCoverage) {
      return { relevant: false, estimatedSavings: 0, summary: "Intake says no HSA-qualified high-deductible health plan. If you switch plans, revisit — the HSA is the only triple-tax-advantaged account.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const limit = ASSUMPTIONS.hsa_family_limit.value;
    const room = Math.max(0, limit - ctx.intake.health.hsaContribution);
    const savings = room * rate;
    return {
      relevant: room > 0, estimatedSavings: r0(savings),
      summary: room > 0 ? `${usd0(room)} of unused HSA room — deductible in, tax-free growth, tax-free out for medical.` : "HSA already maxed. Nice.",
      trace: [
        ...rateStep(ctx.intake),
        { label: "Family HSA limit", value: limit, note: "VERIFY current-year limit" },
        { label: "Current contributions (intake)", value: ctx.intake.health.hsaContribution },
        { label: "Unused room", value: r0(room) },
        { label: "Estimated annual savings", value: r0(savings) },
      ],
      cpaChecklist: ["Confirm the health plan is HSA-qualified.", "Coordinate with any medical reimbursement plan to avoid disqualification."],
    };
  },

  medical_reimbursement(ctx) {
    const oop = ctx.intake.health.annualOutOfPocketMedical;
    if (oop < 2000) {
      return { relevant: false, estimatedSavings: 0, summary: "Out-of-pocket medical costs in the intake are modest; a reimbursement plan's admin likely isn't worth it yet.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const savings = oop * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `~${usd0(oop)}/yr of family medical costs could become business deductions under a properly designed §105/HRA arrangement${ctx.intake.family.spouseInvolved ? " (spouse involvement helps a 105-HRA design)" : ""}.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Annual out-of-pocket medical (intake)", value: oop },
        { label: "Estimated annual savings if fully reimbursable", value: r0(savings), note: "Upper bound — plan design and nondiscrimination rules decide what's actually reimbursable" },
      ],
      cpaChecklist: [
        "Nondiscrimination testing with clinic employees is the trap — design with a benefits professional.",
        "Pick the structure: 105-HRA (spouse employee), QSEHRA, or ICHRA.",
        "Coordinate carefully with HSA eligibility.",
      ],
    };
  },

  accountable_plan(ctx) {
    const est = ctx.intake.planning.ownerPaidBusinessCosts;
    if (est <= 0) {
      return { relevant: false, estimatedSavings: 0, summary: "Intake shows no owner-paid business costs. Most owners have some (phone, internet, travel) — update the intake if so.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const savings = est * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `~${usd0(est)}/yr of business costs you pay personally (phone, internet, travel, supplies) become deductible via an accountable plan — tax-free reimbursement to you.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Estimated owner-paid business costs (intake)", value: est },
        { label: "Estimated annual savings", value: r0(savings) },
      ],
      cpaChecklist: ["Adopt a written accountable plan per entity (or via the management company).", "Substantiate within 60 days; reimburse through payroll or AP."],
    };
  },

  cost_segregation(ctx) {
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const buildings = ctx.books.flatMap((b) =>
      b.fixedAssets.filter((a) => a.subtype === "building" || /property|building/i.test(a.name)).map((a) => ({ entity: b.name, ...a }))
    );
    const basis = buildings.reduce((s, a) => s + a.balance, 0);
    if (basis < 200000) {
      return { relevant: false, estimatedSavings: 0, summary: "No owned buildings with enough basis on the balance sheets (threshold ~$200k).", trace: [], cpaChecklist: [] };
    }
    const reclassPct = 0.25, bonusPct = 1.0;
    const accelerated = basis * reclassPct * bonusPct;
    const savings = accelerated * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `${buildings.length} group properties with ~${usd0(basis)} combined basis. A cost segregation study could front-load ~${usd0(accelerated)} of depreciation (timing benefit ~${usd0(savings)}).`,
      trace: [
        ...rateStep(ctx.intake),
        ...buildings.map((b) => ({ label: `${b.entity}: ${b.name} (basis, excl. land — verify)`, value: r0(b.balance) })),
        { label: "Typical reclassifiable share (25%)", value: r0(basis * reclassPct), note: "Engineering study determines the real number" },
        { label: "Bonus depreciation percentage assumed", value: bonusPct, note: "VERIFY current-year bonus % — this has changed repeatedly" },
        { label: "First-year timing benefit", value: r0(savings), note: "TIMING benefit: accelerates deductions you'd otherwise take over 27.5/39 yrs" },
      ],
      cpaChecklist: [
        "Confirm building vs land basis split for each property.",
        "Passive-loss limits may defer the benefit — model REP status or the self-rental grouping election first.",
        "Get study quotes ($3–10k each) and compare to the modeled benefit.",
      ],
    };
  },

  sec179_equipment(ctx) {
    const planned = ctx.intake.planning.plannedEquipmentPurchases;
    if (planned <= 0) {
      return { relevant: false, estimatedSavings: 0, summary: "No planned equipment purchases in the intake. Update it when you plan to buy tables, imaging, cameras, or computers.", trace: [], cpaChecklist: [] };
    }
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const savings = planned * rate;
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `${usd0(planned)} of planned equipment purchases can likely be expensed in year one under §179/bonus instead of depreciating over 5–7 years.`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Planned equipment purchases (intake)", value: planned },
        { label: `§179 limit`, value: ASSUMPTIONS.sec179_limit.value, note: "VERIFY current-year limit — you're far under it" },
        { label: "First-year timing benefit", value: r0(savings), note: "TIMING benefit vs multi-year depreciation" },
      ],
      cpaChecklist: ["Time purchases to land in the higher-income year.", "Elect §179 on the return; check Utah conformity.", "Keep invoices and in-service dates."],
    };
  },

  insurance_cashflow(ctx) {
    const groupNet = ctx.books.reduce((s, b) => s + Math.max(0, b.net12), 0);
    const relevant = groupNet > 250000;
    return {
      relevant, estimatedSavings: 0,
      summary: relevant
        ? "Group cash flow could support insurance-based reserve strategies — but this app deliberately estimates $0 current-year tax savings (premiums generally aren't deductible). Value is deferral, protection, and buy-sell funding. Advanced: pursue only after the deductions above."
        : "Not yet — build profits and max the direct deductions first.",
      trace: [{ label: "Group net profit (12 mo)", value: r0(groupNet), note: "No deduction modeled by design" }],
      cpaChecklist: relevant
        ? ["Involve your CPA and a fee-transparent advisor before any illustration.", "Avoid MEC status; scrutinize commissions and surrender schedules.", "Tie any policy to a real need: key-person, buy-sell, estate."]
        : [],
    };
  },

  income_timing(ctx) {
    const rate = combinedIncomeRate(ctx.intake.owner.fedMarginalRate);
    const ops = operatingEntities(ctx);
    const prepayable = ops.reduce((s, b) => {
      const monthly = (Object.entries(b.spendByAccount)
        .filter(([n]) => /rent|insurance|software/i.test(n))
        .reduce((x, [, v]) => x + v, 0)) / 12;
      return s + monthly;
    }, 0);
    const shiftable = prepayable * 2; // ~2 months of prepayable costs + deferred billing
    const deferredTax = shiftable * rate;
    const savings = deferredTax * 0.05;
    if (shiftable < 5000) {
      return { relevant: false, estimatedSavings: 0, summary: "Prepayable costs are too small for year-end timing to matter much.", trace: [], cpaChecklist: [] };
    }
    return {
      relevant: true, estimatedSavings: r0(savings),
      summary: `~${usd0(shiftable)} of income/expenses could shift across year-end, deferring ~${usd0(deferredTax)} of tax by a year (worth ~${usd0(savings)} at 5% — more if next year's bracket is lower).`,
      trace: [
        ...rateStep(ctx.intake),
        { label: "Monthly prepayable costs across operating entities (rent, insurance, software)", value: r0(prepayable) },
        { label: "Shiftable across year-end (~2 months + deferred December billing)", value: r0(shiftable) },
        { label: "Tax deferred one year", value: r0(deferredTax), note: "Deferral, not permanent savings" },
        { label: "Value of the deferral at 5% opportunity cost", value: r0(savings) },
      ],
      cpaChecklist: ["Confirm cash-method status for each entity.", "Apply the 12-month prepaid rule correctly.", "Re-check December estimated-tax payments after shifting."],
    };
  },
};

// ---------------------------------------------------------------------------

export type StrategyEvaluation = EvalResult & { strategyId: string; score: number };

export function runAnalyzer(
  ctx: AnalyzerContext,
  strategies: { id: string; effort: number; enabled: boolean }[]
): StrategyEvaluation[] {
  const results: StrategyEvaluation[] = [];
  for (const s of strategies) {
    if (!s.enabled) continue;
    const evaluator = EVALUATORS[s.id];
    if (!evaluator) continue;
    const res = evaluator(ctx);
    results.push({
      ...res,
      strategyId: s.id,
      score: res.relevant ? Math.round(res.estimatedSavings / Math.max(1, s.effort)) : 0,
    });
  }
  return results.sort((a, b) => {
    if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
    return b.estimatedSavings - a.estimatedSavings;
  });
}
