import { prisma } from "./db";

// The situation intake: everything the books can't tell us.
export type EntityIntake = {
  role: string; // clinic | media | operating | rental_realestate | holding | dormant
  ownershipPercent: number;
  taxTreatment: string; // sole_prop | single_member_llc | partnership | s_corp | c_corp | unknown
  confirmed: boolean;
  ownsRealEstate: "yes" | "no" | "unconfirmed";
  rentsToGroup: "yes" | "no" | "unknown";
};

export type Intake = {
  owner: { state: string; filingStatus: string; fedMarginalRate: number };
  family: { spouseInvolved: boolean; childrenEmployable: number; childrenAges: number[] };
  home: {
    officeUsed: boolean;
    officePercent: number; // 0..100
    annualHomeCosts: number;
    augustaMeetingsPerYear: number;
    localDailyVenueRate: number;
  };
  vehicles: { businessMilesPerYear: number; heavyVehicle: boolean };
  retirement: { solo401kActive: boolean; currentAnnualContribution: number };
  health: { hdhpCoverage: boolean; hsaContribution: number; annualOutOfPocketMedical: number };
  planning: { plannedEquipmentPurchases: number; ownerPaidBusinessCosts: number };
  entities: Record<string, EntityIntake>;
  goals: string;
};

export const DEFAULT_INTAKE: Omit<Intake, "entities"> = {
  owner: { state: "UT", filingStatus: "married_joint", fedMarginalRate: 0.32 },
  family: { spouseInvolved: true, childrenEmployable: 2, childrenAges: [] },
  home: { officeUsed: true, officePercent: 12, annualHomeCosts: 42000, augustaMeetingsPerYear: 12, localDailyVenueRate: 650 },
  vehicles: { businessMilesPerYear: 8000, heavyVehicle: false },
  retirement: { solo401kActive: false, currentAnnualContribution: 0 },
  health: { hdhpCoverage: true, hsaContribution: 0, annualOutOfPocketMedical: 6000 },
  planning: { plannedEquipmentPurchases: 25000, ownerPaidBusinessCosts: 4800 },
  entities: undefined as never,
  goals: "",
};

export async function loadIntake(): Promise<Intake> {
  const row = await prisma.intakeProfile.findUnique({ where: { id: "main" } });
  const entities = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  const stored = row ? (JSON.parse(row.dataJson) as Partial<Intake>) : {};
  const merged: Intake = {
    ...DEFAULT_INTAKE,
    ...stored,
    owner: { ...DEFAULT_INTAKE.owner, ...stored.owner },
    family: { ...DEFAULT_INTAKE.family, ...stored.family },
    home: { ...DEFAULT_INTAKE.home, ...stored.home },
    vehicles: { ...DEFAULT_INTAKE.vehicles, ...stored.vehicles },
    retirement: { ...DEFAULT_INTAKE.retirement, ...stored.retirement },
    health: { ...DEFAULT_INTAKE.health, ...stored.health },
    planning: { ...DEFAULT_INTAKE.planning, ...(stored as Intake).planning },
    entities: {},
    goals: stored.goals ?? "",
  };
  for (const e of entities) {
    merged.entities[e.slug] = {
      role: e.kind,
      ownershipPercent: 100,
      taxTreatment: "unknown",
      confirmed: !e.slug.startsWith("sandcastle"),
      ownsRealEstate: e.kind === "rental_realestate" ? "unconfirmed" : "no",
      rentsToGroup: "unknown",
      ...(stored.entities?.[e.slug] ?? {}),
    };
  }
  return merged;
}

export async function saveIntake(intake: Intake): Promise<void> {
  await prisma.intakeProfile.upsert({
    where: { id: "main" },
    update: { dataJson: JSON.stringify(intake) },
    create: { id: "main", dataJson: JSON.stringify(intake) },
  });
}
