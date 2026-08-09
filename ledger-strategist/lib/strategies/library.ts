// The seeded strategy library. These are records, not advice: each names the
// provision it rests on, what triggers it, what the books can signal, and what
// a CPA must verify. The dollar math lives in analyzer.ts, keyed by id.

export type StrategySeed = {
  id: string;
  name: string;
  description: string;
  provision: string;
  eligibility: string;
  signals: string;
  impactFormula: string;
  effort: number; // 1 easy .. 5 heavy
  complexity: "low" | "medium" | "high" | "advanced";
  verifyNotes: string;
};

export const STRATEGY_LIBRARY: StrategySeed[] = [
  {
    id: "s_corp_election",
    name: "S-corp election with reasonable salary",
    description:
      "If a profitable entity is taxed as a sole proprietorship or default LLC, electing S-corp status lets you split earnings into a reasonable salary (payroll-taxed) and distributions (not payroll-taxed), cutting self-employment tax.",
    provision: "IRC subchapter S election (Form 2553); reasonable-compensation doctrine",
    eligibility:
      "Operating entity with sustained net profit (rule of thumb: $50k+/yr), US owners, single class of ownership. Not useful for passive rental entities.",
    signals: "Entity net income well above a market salary for the work performed.",
    impactFormula:
      "SE tax rate × (net profit − reasonable salary), less payroll costs of running an S-corp (~$2–3k/yr).",
    effort: 3,
    complexity: "medium",
    verifyNotes:
      "CPA must: confirm election timing/deadlines, set a defensible reasonable salary, weigh QBI deduction interaction, and confirm state treatment.",
  },
  {
    id: "management_company",
    name: "Management-company structure across the group",
    description:
      "A central management entity charges the operating entities documented fees for admin, marketing, billing, and management services. This centralizes overhead, can shift income to the entity with the best tax posture, and is the chassis for group-level benefits (accountable plan, retirement, family payroll).",
    provision: "Ordinary and necessary business expenses (IRC §162); intercompany services with transfer-pricing discipline",
    eligibility:
      "Multiple commonly-owned operating entities. Fees must reflect real services at arm's-length rates, under written agreements, with actual invoices paid.",
    signals: "Duplicated admin/software/marketing spend across several entities.",
    impactFormula:
      "Rate differential between entities × management fee shifted, plus hard savings from de-duplicated overhead. Estimated here as consolidation savings on duplicated overhead categories.",
    effort: 4,
    complexity: "high",
    verifyNotes:
      "CPA/attorney must: paper the service agreements, set defensible fee levels, confirm no unintended SE/payroll tax, and check Utah nexus effects.",
  },
  {
    id: "income_shifting",
    name: "Intercompany income and expense placement",
    description:
      "Review which entity books shared revenue and shared costs so the group's total tax is minimized — e.g. charging clinics for media services from PI Warriors, or placing shared equipment in the entity that can use the deduction best.",
    provision: "IRC §162 (real services/costs); §482 arm's-length principles",
    eligibility: "Commonly-owned group with entities in different effective tax postures.",
    signals: "One entity with large profits while related entities run losses that can't be used.",
    impactFormula:
      "Marginal rate × income moved from profitable entities to entities with unused losses (bounded by the smaller of the two).",
    effort: 3,
    complexity: "high",
    verifyNotes:
      "Every shifted dollar needs a real service or cost behind it, documented and consistently applied. CPA must model the group before/after.",
  },
  {
    id: "self_rental",
    name: "Real-estate holding companies renting to the group",
    description:
      "If the SandCastle LLCs (or any entity) own property the clinics use, have the holding LLC charge the operating clinic fair-market rent. Rent is deductible to the clinic at ordinary rates; the LLC offsets it with depreciation, interest, and property costs.",
    provision: "Self-rental rules (Reg. §1.469-2(f)(6)); grouping election (Reg. §1.469-4)",
    eligibility:
      "Group-owned real estate used by an operating business. Confirm which SandCastle LLCs actually hold real estate (intake).",
    signals: "Rent paid to third parties by clinics; property assets inside group LLCs.",
    impactFormula:
      "Ordinary-rate deduction on rent paid by clinic minus rental-entity taxable income after depreciation/interest — net benefit ≈ rate × sheltered portion.",
    effort: 3,
    complexity: "high",
    verifyNotes:
      "CPA must: set fair-market rent, consider a grouping election so self-rental income isn't trapped as non-passive while losses are passive, and paper a lease.",
  },
  {
    id: "hire_family",
    name: "Hiring family members / employing your children",
    description:
      "Pay family members (including children age 7+ doing real, age-appropriate work — filing, social media, modeling for ads) a fair wage. Wages are deductible to the business; a child's wages up to the standard deduction are federal-income-tax-free to them, and exempt from FICA if paid by a parent's sole proprietorship or partnership of parents.",
    provision: "IRC §162 (wages); §3121(b)(3)(A) FICA exemption for children under 18 employed by parents",
    eligibility: "Family members who can perform documented, genuine work at a reasonable wage.",
    signals: "Owner-operated businesses with marketing/admin tasks family could do.",
    impactFormula:
      "Marginal rate × wages paid (up to standard deduction per child), minus any payroll tax that applies given the paying entity's structure.",
    effort: 2,
    complexity: "medium",
    verifyNotes:
      "CPA must confirm: which entity should pay (FICA exemption depends on entity type), wage reasonableness, timesheets/documentation, and W-2 filing.",
  },
  {
    id: "augusta_rule",
    name: "Augusta rule — rent your home to your business",
    description:
      "Rent your personal residence to your business for legitimate meetings/events (board meetings, staff planning days) up to 14 days per year. The business deducts market-rate rent; you receive it tax-free.",
    provision: "IRC §280A(g)",
    eligibility:
      "Business with genuine reasons to meet at the home; documented agendas, minutes, and comparable local venue rates.",
    signals: "Recurring team meetings or trainings currently held at paid venues (or informally at home, unpaid).",
    impactFormula: "Days used (≤14) × fair local daily venue rate × marginal rate.",
    effort: 1,
    complexity: "low",
    verifyNotes:
      "CPA must bless the daily rate comps and documentation. Rent must be market-rate; corporate minutes should record each meeting.",
  },
  {
    id: "home_office",
    name: "Home office via accountable-plan reimbursement",
    description:
      "If you regularly and exclusively use part of your home for administering the businesses, the company reimburses you for the business share of home costs under an accountable plan — deductible to the company, tax-free to you.",
    provision: "IRC §280A(c); accountable plan rules (Reg. §1.62-2)",
    eligibility: "Regular and exclusive business use; for admin use, no other fixed location where you do that work.",
    signals: "Owner-administered group with no separate admin office expense.",
    impactFormula: "Business-use % × annual home costs × marginal rate.",
    effort: 1,
    complexity: "low",
    verifyNotes: "CPA must confirm exclusive-use test, the percentage, and that the accountable plan is written and followed.",
  },
  {
    id: "vehicle_strategy",
    name: "Vehicle and mileage strategy",
    description:
      "Deduct business use of vehicles the smarter of two ways: the standard mileage rate, or actual expenses plus depreciation (heavy vehicles >6,000 lbs GVWR can qualify for large first-year write-offs when business use exceeds 50%).",
    provision: "IRC §162; §280F limits; §179/bonus for qualifying heavy vehicles; standard mileage rate (annual IRS notice)",
    eligibility: "Documented business miles (contemporaneous log) or business-owned vehicles.",
    signals: "Fuel/auto spend in the books without a formal mileage or actual-expense method.",
    impactFormula: "Estimated business miles × IRS rate × marginal rate (baseline method).",
    effort: 2,
    complexity: "medium",
    verifyNotes: "CPA must pick mileage vs. actual per vehicle, confirm >50% business use for any §179 vehicle, and require a mileage log.",
  },
  {
    id: "solo_401k",
    name: "Owner retirement plan (Solo 401(k) / SEP-IRA)",
    description:
      "Shelter income by contributing as both employee and employer through the group's payroll. A Solo 401(k) usually beats a SEP at the same income because of the employee deferral; add a spouse on payroll to double it.",
    provision: "IRC §401(k), §402(g), §415(c); SEP under §408(k)",
    eligibility: "Self-employment or S-corp W-2 income; Solo 401(k) requires no non-spouse full-time employees in the adopting entity (clinics with staff need a full plan — CPA/TPA design question).",
    signals: "Owner compensation with little or no retirement deferral in the books.",
    impactFormula: "min(available limit, deferrable income) × marginal rate.",
    effort: 2,
    complexity: "medium",
    verifyNotes: "CPA/TPA must check controlled-group rules across all 8 entities — employees in the clinics can force coverage testing group-wide. This is a critical trap; do not adopt a plan without this analysis.",
  },
  {
    id: "defined_benefit",
    name: "Defined benefit / cash balance plan",
    description:
      "For owners with high, stable income who want to shelter far more than 401(k) limits allow (often $100k–$300k+/yr depending on age), a defined benefit or cash balance plan layered on a 401(k) can create very large deductions.",
    provision: "IRC §412, §415(b)",
    eligibility: "High sustained profits, willingness to fund annually for several years, actuarial administration.",
    signals: "Group net income comfortably above ~$400k with existing retirement limits maxed.",
    impactFormula: "Actuarially determined contribution × marginal rate (rough placeholder: capped % of profits).",
    effort: 5,
    complexity: "advanced",
    verifyNotes: "Requires an actuary and TPA; controlled-group and employee-coverage analysis across the clinics is mandatory. Flagged advanced: heavy CPA verification.",
  },
  {
    id: "hsa",
    name: "Health Savings Account (HSA)",
    description:
      "With a qualifying high-deductible health plan, HSA contributions are deductible going in, grow tax-free, and come out tax-free for medical costs — the only triple-tax-advantaged account.",
    provision: "IRC §223",
    eligibility: "HDHP coverage, no disqualifying other coverage, not on Medicare.",
    signals: "Health insurance spend in the books without HSA contributions.",
    impactFormula: "Family limit × (marginal income rate + payroll tax where pre-tax via payroll).",
    effort: 1,
    complexity: "low",
    verifyNotes: "CPA/insurance: confirm the plan is HSA-qualified and coordinate with any medical reimbursement plan.",
  },
  {
    id: "medical_reimbursement",
    name: "Medical reimbursement plan (Section 105 / QSEHRA / ICHRA)",
    description:
      "A properly structured health reimbursement arrangement lets the business deduct medical costs it reimburses — powerful when a spouse is a bona fide employee (105-HRA) or across small-group employees (QSEHRA/ICHRA).",
    provision: "IRC §105, §106; QSEHRA §9831(d); ICHRA regs",
    eligibility: "Depends on structure and employee census; nondiscrimination rules apply in clinics with staff.",
    signals: "Meaningful out-of-pocket medical spend by owners; spouse involved in the business.",
    impactFormula: "Reimbursable medical spend × (marginal rate + SE/payroll tax where applicable).",
    effort: 3,
    complexity: "high",
    verifyNotes: "Nondiscrimination testing with clinic employees is the trap — CPA/benefits pro must design this. ACA compliance required.",
  },
  {
    id: "accountable_plan",
    name: "Accountable plan for owner-paid expenses",
    description:
      "A written plan under which the business reimburses owners/employees for business costs paid personally (phone, internet, travel, supplies, home office). Reimbursements are deductible to the business and tax-free to you — without one, those costs are usually lost.",
    provision: "Reg. §1.62-2 accountable plan rules",
    eligibility: "Any entity with owners paying business costs personally. Essentially universal.",
    signals: "Round-number owner draws; business-looking spend missing from the books (phone, internet, travel).",
    impactFormula: "Estimated owner-paid business costs × marginal rate.",
    effort: 1,
    complexity: "low",
    verifyNotes: "CPA: adopt a written plan, substantiation within 60 days, no reimbursement of personal costs.",
  },
  {
    id: "cost_segregation",
    name: "Cost segregation + accelerated depreciation on real estate",
    description:
      "An engineering study reclassifies parts of a building (fixtures, site work, specialty systems) from 27.5/39-year property into 5/7/15-year property, front-loading large depreciation deductions — often 20–30% of the building's basis.",
    provision: "MACRS class lives; bonus depreciation §168(k) (percentage varies by year)",
    eligibility: "Owned buildings with meaningful basis (rule of thumb $200k+, excluding land). Applies to the SandCastle properties and any owned clinic building.",
    signals: "Fixed-asset property on the balance sheet still on straight-line schedules.",
    impactFormula: "Building basis × reclassifiable % (est. 25%) × bonus % × marginal rate (timing benefit).",
    effort: 3,
    complexity: "high",
    verifyNotes: "Passive-loss limits can defer the benefit unless real-estate-professional status or self-rental grouping applies — CPA must model this. Study cost $3–10k.",
  },
  {
    id: "sec179_equipment",
    name: "Section 179 / bonus depreciation on equipment",
    description:
      "Expense qualifying equipment (chiro tables, X-ray, computers, cameras) in the year placed in service instead of depreciating over years.",
    provision: "IRC §179; §168(k) bonus depreciation",
    eligibility: "Equipment purchases with taxable income to absorb them (§179 limited to business income; bonus is not).",
    signals: "Equipment/asset purchases in the books being capitalized or misposted to expense without a fixed-asset schedule.",
    impactFormula: "Qualifying purchases × marginal rate (timing benefit in year one).",
    effort: 1,
    complexity: "low",
    verifyNotes: "CPA: confirm eligibility, elect on the return, coordinate with state conformity (Utah) and QBI.",
  },
  {
    id: "per_diem_travel",
    name: "Per diem for overnight business travel",
    description:
      "For overnight business trips, deduct meals & incidentals at the IRS per-diem rate instead of tracking every meal receipt. Simpler documentation, and often more than actual meal spend. Logged trips on the Travel & Per Diem page feed this automatically.",
    provision: "IRC §274(d); Rev. Proc. high-low substantiation method (annual IRS notice); 50% meals limit §274(n)",
    eligibility:
      "Overnight travel away from your tax home with a business purpose. Self-employed owners: M&IE only (lodging needs actual receipts).",
    signals: "Travel/conference spend in the books; logged overnight trips.",
    impactFormula: "Trip days at the dated M&IE rate (75% on first/last day) × 50% meals limit × marginal rate.",
    effort: 1,
    complexity: "low",
    verifyNotes:
      "CPA must confirm current-year M&IE rates and the high-cost locality list, and that each trip's business purpose is documented. Owners of C-corps/S-corps have different options (employer-paid per diem rules).",
  },
  {
    id: "insurance_cashflow",
    name: "Insurance-based cash-flow strategies (advanced)",
    description:
      "Permanent life insurance structured for high cash value can serve as a tax-advantaged reserve: growth is tax-deferred, policy loans are tax-free while the policy stays in force, and it can coordinate with buy-sell agreements across the group. This is a cash-flow and protection strategy more than a deduction — premiums are generally NOT deductible.",
    provision: "IRC §7702 (life insurance definition); §72 (loans/distributions); §101 (death benefit)",
    eligibility: "Strong, stable free cash flow after retirement plans are maxed; long time horizon; a real protection or buy-sell need across the entities.",
    signals: "Consistent surplus cash building in operating accounts beyond working-capital needs.",
    impactFormula: "No current-year tax savings estimated by this app — modeled as $0 deduction. Value is deferral, protection, and estate planning.",
    effort: 4,
    complexity: "advanced",
    verifyNotes: "ADVANCED — heavy verification. Involve your CPA and a fee-aware advisor; poorly designed policies (MEC status, high commissions) destroy the benefit. Do this only after cheaper deductions are exhausted.",
  },
  {
    id: "income_timing",
    name: "Timing income and expenses across year-end",
    description:
      "Cash-basis businesses can accelerate deductible spending into December (stock supplies, prepay up to 12 months of rent/insurance/software) and defer December invoicing into January — or the reverse in a low-income year.",
    provision: "Cash-method accounting; 12-month rule for prepaids (Reg. §1.263(a)-4(f))",
    eligibility: "Cash-basis entities with flexibility on billing and spending timing.",
    signals: "Strong Q4 profitability trend vs. prior year.",
    impactFormula: "Shiftable amount × (this year's marginal rate − next year's expected rate); pure deferral value if rates equal.",
    effort: 1,
    complexity: "low",
    verifyNotes: "CPA: confirm cash method, apply the 12-month prepaid rule correctly, and check estimated-tax effects.",
  },
];
