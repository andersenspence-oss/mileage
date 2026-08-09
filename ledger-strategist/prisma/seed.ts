/**
 * Seeds the local database with:
 *  - the 8 real entities
 *  - realistic demo books (Jan 2025 -> today) so every screen works before
 *    QuickBooks is connected
 *  - the strategy library
 *  - a starter intake profile and month-end checklist
 *
 * Deterministic: same data every run (seeded RNG), so report tests can assert
 * against known totals.
 */
import { PrismaClient } from "@prisma/client";
import { STRATEGY_LIBRARY } from "../lib/strategies/library";
import { ASSUMPTIONS } from "../lib/assumptions";

const prisma = new PrismaClient();

// --- deterministic RNG (mulberry32) ---------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(r: Rand, arr: T[]) => arr[Math.floor(r() * arr.length)];
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const round2 = (n: number) => Math.round(n * 100) / 100;

// --- entity + chart-of-accounts definitions --------------------------------

type AccountDef = { name: string; type: string; subtype?: string; openingBalance?: number };
type IncomeStream = { account: string; vendors: string[]; monthly: [number, number]; txns: [number, number] };
type ExpenseStream = { account: string; vendors: string[]; monthly: [number, number]; txns: [number, number] };

type EntityDef = {
  slug: string; name: string; kind: string; color: string; notes: string; sort: number;
  accounts: AccountDef[];
  income: IncomeStream[];
  expenses: ExpenseStream[];
  growth: number; // monthly drift on income
};

const clinicExpenses = (scale: number): ExpenseStream[] => [
  { account: "Payroll & Wages", vendors: ["Gusto Payroll"], monthly: [11000 * scale, 12500 * scale], txns: [2, 2] },
  { account: "Rent", vendors: ["Red Rock Properties"], monthly: [4200 * scale, 4200 * scale], txns: [1, 1] },
  { account: "Medical Supplies", vendors: ["ChiroSupply Co", "MedLine", "ScripHessco"], monthly: [900 * scale, 1900 * scale], txns: [3, 6] },
  { account: "Marketing & Advertising", vendors: ["Google Ads", "Meta Ads", "Valpak St George"], monthly: [1400 * scale, 2600 * scale], txns: [3, 5] },
  { account: "Software & Subscriptions", vendors: ["Jane App", "QuickBooks", "Zoom", "Canva"], monthly: [350 * scale, 550 * scale], txns: [3, 5] },
  { account: "Utilities & Phone", vendors: ["Rocky Mountain Power", "Verizon", "TDS Telecom"], monthly: [450 * scale, 700 * scale], txns: [2, 3] },
  { account: "Insurance", vendors: ["NCMIC Malpractice", "State Farm"], monthly: [600 * scale, 700 * scale], txns: [1, 2] },
  { account: "Meals & Entertainment", vendors: ["Cafe Rio", "Texas Roadhouse", "Swig"], monthly: [150 * scale, 450 * scale], txns: [2, 5] },
  { account: "Auto & Fuel", vendors: ["Chevron", "Maverik", "Jiffy Lube"], monthly: [200 * scale, 450 * scale], txns: [2, 4] },
  { account: "Continuing Education", vendors: ["Parker Seminars", "ChiroCredit"], monthly: [0, 500 * scale], txns: [0, 1] },
];

const ENTITIES: EntityDef[] = [
  {
    slug: "whiplash", name: "Whiplash Center of Utah", kind: "clinic", color: "#14532d", sort: 1,
    notes: "Chiropractic / personal-injury clinic, St. George UT",
    accounts: [
      { name: "Checking", type: "bank", openingBalance: 84000 },
      { name: "Business Credit Card", type: "credit_card", openingBalance: 0 },
      { name: "Clinic Equipment", type: "fixed_asset", openingBalance: 145000 },
      { name: "Owner's Equity", type: "equity", openingBalance: 229000 },
    ],
    income: [
      { account: "PI Settlement Income", vendors: ["Siegfried & Jensen", "Craig Swapp", "Good Guys Law", "Flickinger Boulton"], monthly: [42000, 66000], txns: [4, 7] },
      { account: "Patient Payments", vendors: ["Patient Payment", "Cash Payment"], monthly: [9000, 15000], txns: [14, 22] },
    ],
    expenses: clinicExpenses(2.2),
    growth: 0.008,
  },
  {
    slug: "family-health", name: "Family Health and Rehab", kind: "clinic", color: "#1d4ed8", sort: 2,
    notes: "General chiropractic & rehab clinic",
    accounts: [
      { name: "Checking", type: "bank", openingBalance: 41000 },
      { name: "Clinic Equipment", type: "fixed_asset", openingBalance: 68000 },
      { name: "Owner's Equity", type: "equity", openingBalance: 109000 },
    ],
    income: [
      { account: "Insurance Reimbursements", vendors: ["Select Health", "Regence BCBS", "United Healthcare", "Medicare"], monthly: [24000, 34000], txns: [8, 13] },
      { account: "Patient Payments", vendors: ["Patient Payment", "Cash Payment"], monthly: [6000, 10000], txns: [10, 16] },
    ],
    expenses: clinicExpenses(1.3),
    growth: 0.004,
  },
  {
    slug: "running-wild", name: "Running Wild Utah", kind: "operating", color: "#b45309", sort: 3,
    notes: "Events / retail brand (confirm exact role in intake)",
    accounts: [
      { name: "Checking", type: "bank", openingBalance: 12500 },
      { name: "Owner's Equity", type: "equity", openingBalance: 12500 },
    ],
    income: [
      { account: "Event & Registration Income", vendors: ["RunSignup", "Eventbrite", "Stripe Payouts"], monthly: [6000, 16000], txns: [4, 8] },
      { account: "Merchandise Sales", vendors: ["Shopify Payouts", "Square"], monthly: [1500, 4200], txns: [3, 6] },
    ],
    expenses: [
      { account: "Event Costs", vendors: ["Washington County Parks", "St George City Permits", "Porta-Pro Rentals"], monthly: [2200, 6500], txns: [2, 5] },
      { account: "Merchandise & Supplies", vendors: ["Custom Ink", "4imprint", "BSN Sports"], monthly: [900, 2800], txns: [2, 4] },
      { account: "Marketing & Advertising", vendors: ["Meta Ads", "Instagram Ads"], monthly: [400, 1100], txns: [2, 3] },
      { account: "Software & Subscriptions", vendors: ["RunSignup", "Mailchimp", "Canva"], monthly: [150, 260], txns: [2, 3] },
      { account: "Insurance", vendors: ["Event Insurance Co"], monthly: [180, 220], txns: [1, 1] },
    ],
    growth: 0.012,
  },
  {
    slug: "pi-warriors", name: "PI Warriors", kind: "media", color: "#7c3aed", sort: 4,
    notes: "Media / education brand: courses, podcast, content for PI professionals",
    accounts: [
      { name: "Checking", type: "bank", openingBalance: 18000 },
      { name: "Production Equipment", type: "fixed_asset", openingBalance: 22000 },
      { name: "Owner's Equity", type: "equity", openingBalance: 40000 },
    ],
    income: [
      { account: "Course & Program Sales", vendors: ["Stripe Payouts", "Kajabi Payouts"], monthly: [7000, 14000], txns: [5, 9] },
      { account: "Sponsorship & Ad Income", vendors: ["Podcast Sponsor", "YouTube AdSense"], monthly: [1200, 3800], txns: [1, 3] },
    ],
    expenses: [
      { account: "Contractors & Editing", vendors: ["Upwork Contractor", "Video Editor LLC", "Podcast Producer"], monthly: [2400, 4800], txns: [2, 4] },
      { account: "Software & Subscriptions", vendors: ["Kajabi", "Adobe Creative Cloud", "Riverside.fm", "Buzzsprout"], monthly: [500, 750], txns: [4, 6] },
      { account: "Marketing & Advertising", vendors: ["Meta Ads", "YouTube Ads"], monthly: [1000, 2600], txns: [2, 4] },
      { account: "Travel & Conferences", vendors: ["Delta Air Lines", "Marriott", "Uber"], monthly: [0, 2200], txns: [0, 4] },
      { account: "Meals & Entertainment", vendors: ["Ruth's Chris", "Local Bistro"], monthly: [100, 400], txns: [1, 3] },
    ],
    growth: 0.015,
  },
  ...[1, 2, 4, 5].map((n, i): EntityDef => ({
    slug: `sandcastle-${n}`, name: `SandCastle ${n} LLC`, kind: "rental_realestate", color: "#0e7490", sort: 5 + i,
    notes: "Likely holding / real-estate entity — confirm in intake",
    accounts: [
      { name: "Checking", type: "bank", openingBalance: 9000 + n * 1500 },
      { name: "Rental Property", type: "fixed_asset", subtype: "building", openingBalance: 380000 + n * 45000 },
      { name: "Mortgage Payable", type: "liability", openingBalance: 262000 + n * 30000 },
      { name: "Owner's Equity", type: "equity", openingBalance: 9000 + n * 1500 + 380000 + n * 45000 - (262000 + n * 30000) },
    ],
    income: [
      { account: "Rental Income", vendors: [`Tenant Payment SC${n}`], monthly: [3600 + n * 350, 3600 + n * 350], txns: [1, 1] },
    ],
    expenses: [
      { account: "Mortgage Interest", vendors: ["Zions Bank Mortgage"], monthly: [1150 + n * 120, 1150 + n * 120], txns: [1, 1] },
      { account: "Property Tax & HOA", vendors: ["Washington County Treasurer", "Desert Springs HOA"], monthly: [320 + n * 25, 360 + n * 25], txns: [1, 2] },
      { account: "Repairs & Maintenance", vendors: ["Ace Handyman", "Desert Plumbing", "Cool Breeze HVAC"], monthly: [0, 900], txns: [0, 2] },
      { account: "Property Insurance", vendors: ["Farmers Insurance"], monthly: [95 + n * 10, 95 + n * 10], txns: [1, 1] },
    ],
    growth: 0.001,
  })),
];

// Vendors that look personal — sprinkled in to exercise the anomaly detector
const PERSONAL_VENDORS = ["Costco", "Sky Mountain Golf", "Amazon Marketplace", "Smith's Grocery", "Sephora"];

async function main() {
  console.log("Seeding database...");
  // wipe (idempotent reseed)
  await prisma.anomalyFlag.deleteMany();
  await prisma.categorySuggestion.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.qboConnection.deleteMany();
  await prisma.entity.deleteMany();
  await prisma.strategy.deleteMany();
  await prisma.strategyResult.deleteMany();
  await prisma.scenarioToggle.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.vendorRule.deleteMany();

  const start = new Date(2025, 0, 1);
  const today = new Date();
  const months: Date[] = [];
  for (let d = new Date(start); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push(new Date(d));
  }

  for (const def of ENTITIES) {
    const entity = await prisma.entity.create({
      data: { slug: def.slug, name: def.name, kind: def.kind, color: def.color, notes: def.notes, sort: def.sort },
    });

    const accountByName = new Map<string, string>();
    for (const a of def.accounts) {
      const acc = await prisma.account.create({
        data: { entityId: entity.id, name: a.name, type: a.type, subtype: a.subtype, openingBalance: a.openingBalance ?? 0 },
      });
      accountByName.set(a.name, acc.id);
    }
    for (const s of [...def.income, ...def.expenses]) {
      if (!accountByName.has(s.account)) {
        const acc = await prisma.account.create({
          data: {
            entityId: entity.id, name: s.account,
            type: def.income.includes(s as IncomeStream) ? "income" : "expense",
          },
        });
        accountByName.set(s.account, acc.id);
      }
    }

    const r = rng(def.slug.split("").reduce((a, c) => a + c.charCodeAt(0), 7));
    const rows: {
      entityId: string; accountId: string | null; date: Date; amount: number; flow: string;
      vendor: string; description: string; categoryStatus: string; source: string;
    }[] = [];

    months.forEach((monthStart, mi) => {
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      const cap = monthStart.getMonth() === today.getMonth() && monthStart.getFullYear() === today.getFullYear()
        ? today.getDate() : daysInMonth;
      const growth = 1 + def.growth * mi;

      const emit = (stream: IncomeStream | ExpenseStream, flow: "in" | "out") => {
        const nTx = Math.round(between(r, stream.txns[0], stream.txns[1]));
        if (nTx === 0) return;
        const monthTotal = between(r, stream.monthly[0], stream.monthly[1]) * (flow === "in" ? growth : 1) * (cap / daysInMonth);
        for (let i = 0; i < nTx; i++) {
          const day = 1 + Math.floor(r() * cap);
          rows.push({
            entityId: entity.id,
            accountId: accountByName.get(stream.account)!,
            date: new Date(monthStart.getFullYear(), monthStart.getMonth(), day),
            amount: round2((monthTotal / nTx) * between(r, 0.7, 1.3)),
            flow,
            vendor: pick(r, stream.vendors),
            description: stream.account,
            categoryStatus: "categorized",
            source: "demo",
          });
        }
      };
      def.income.forEach((s) => emit(s, "in"));
      def.expenses.forEach((s) => emit(s, "out"));

      // a few uncategorized transactions each month (the review queue's fuel)
      if (r() < 0.85 && def.kind !== "rental_realestate") {
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) {
          const allVendors = def.expenses.flatMap((e) => e.vendors);
          rows.push({
            entityId: entity.id, accountId: null,
            date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + Math.floor(r() * cap)),
            amount: round2(between(r, 40, 900)), flow: "out",
            vendor: r() < 0.3 ? pick(r, PERSONAL_VENDORS) : pick(r, allVendors),
            description: "Card purchase", categoryStatus: "uncategorized", source: "demo",
          });
        }
      }
      // occasional personal-looking categorized expense (anomaly fuel)
      if (r() < 0.3 && def.kind !== "rental_realestate") {
        rows.push({
          entityId: entity.id,
          accountId: accountByName.get(def.expenses[Math.floor(r() * def.expenses.length)].account)!,
          date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + Math.floor(r() * cap)),
          amount: round2(between(r, 80, 600)), flow: "out",
          vendor: pick(r, PERSONAL_VENDORS),
          description: "Card purchase", categoryStatus: "categorized", source: "demo",
        });
      }
    });

    // plant a few exact duplicates (same vendor/amount, a day apart)
    const dupCandidates = rows.filter((t) => t.flow === "out" && t.amount > 100);
    for (let i = 0; i < Math.min(3, dupCandidates.length); i++) {
      const orig = dupCandidates[Math.floor(r() * dupCandidates.length)];
      rows.push({ ...orig, date: new Date(orig.date.getTime() + 86400000), description: orig.description + "" });
    }
    // plant one unusually large charge
    if (def.kind !== "rental_realestate") {
      const exp = def.expenses[0];
      rows.push({
        entityId: entity.id, accountId: accountByName.get(exp.account)!,
        date: new Date(2026, 5, 17), amount: round2(exp.monthly[1] * 2.4), flow: "out",
        vendor: exp.vendors[0], description: exp.account, categoryStatus: "categorized", source: "demo",
      });
    }

    await prisma.transaction.createMany({ data: rows });
    console.log(`  ${def.name}: ${rows.length} transactions`);
  }

  // strategy library
  for (const s of STRATEGY_LIBRARY) {
    await prisma.strategy.create({
      data: { ...s, paramsJson: "{}", enabled: true, custom: false },
    });
    await prisma.scenarioToggle.create({ data: { strategyId: s.id, included: true } });
  }
  console.log(`  ${STRATEGY_LIBRARY.length} strategies seeded`);

  // starter intake profile — SandCastle roles deliberately marked unconfirmed
  await prisma.intakeProfile.create({
    data: {
      id: "main",
      dataJson: JSON.stringify({
        owner: { state: "UT", filingStatus: "married_joint", fedMarginalRate: 0.32 },
        family: { spouseInvolved: false, childrenEmployable: 0, childrenAges: [] },
        home: { officeUsed: false, officePercent: 0, annualHomeCosts: 0, augustaMeetingsPerYear: 0, localDailyVenueRate: 0 },
        vehicles: { businessMilesPerYear: 0, heavyVehicle: false },
        retirement: { solo401kActive: false, currentAnnualContribution: 0 },
        health: { hdhpCoverage: false, hsaContribution: 0, annualOutOfPocketMedical: 0 },
        entities: Object.fromEntries(
          ENTITIES.map((e) => [e.slug, {
            role: e.kind, ownershipPercent: 100, taxTreatment: "unknown",
            confirmed: !e.slug.startsWith("sandcastle"),
            ownsRealEstate: e.kind === "rental_realestate" ? "unconfirmed" : "no",
            rentsToGroup: "unknown",
          }])
        ),
        goals: "",
      }),
    },
  });

  // month-end checklist template for the current month
  const mk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const items = [
    "Sync / import all entity books",
    "Clear the review queue (categorize everything)",
    "Resolve or dismiss all anomaly flags",
    "Reconcile bank balances against statements",
    "Review P&L vs. last month for each entity",
    "Record any intercompany transfers correctly",
    "Export the CPA package",
  ];
  await prisma.checklistItem.createMany({ data: items.map((label, i) => ({ month: mk, label, sort: i })) });

  // store assumption defaults in settings for visibility
  await prisma.setting.create({ data: { key: "assumptions", value: JSON.stringify(ASSUMPTIONS) } });

  const txCount = await prisma.transaction.count();
  console.log(`Done. ${txCount} total transactions across ${ENTITIES.length} entities.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
