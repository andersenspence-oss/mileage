import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadIntake, saveIntake, type Intake } from "@/lib/intake";

export async function POST(req: NextRequest) {
  const f = await req.formData();
  const num = (k: string, fallback = 0) => {
    const v = parseFloat(String(f.get(k) ?? ""));
    return isNaN(v) ? fallback : v;
  };
  const bool = (k: string) => f.get(k) === "on" || f.get(k) === "true";
  const str = (k: string, fallback = "") => String(f.get(k) ?? fallback);

  const base = await loadIntake();
  const entities = await prisma.entity.findMany({ orderBy: { sort: "asc" } });

  const intake: Intake = {
    owner: {
      state: "UT",
      filingStatus: str("filingStatus", base.owner.filingStatus),
      fedMarginalRate: num("fedMarginalRate", base.owner.fedMarginalRate),
    },
    family: {
      spouseInvolved: bool("spouseInvolved"),
      childrenEmployable: num("childrenEmployable"),
      childrenAges: [],
    },
    home: {
      officeUsed: bool("officeUsed"),
      officePercent: num("officePercent"),
      annualHomeCosts: num("annualHomeCosts"),
      augustaMeetingsPerYear: num("augustaMeetingsPerYear"),
      localDailyVenueRate: num("localDailyVenueRate"),
    },
    vehicles: { businessMilesPerYear: num("businessMilesPerYear"), heavyVehicle: bool("heavyVehicle") },
    retirement: { solo401kActive: bool("solo401kActive"), currentAnnualContribution: num("currentAnnualContribution") },
    health: {
      hdhpCoverage: bool("hdhpCoverage"),
      hsaContribution: num("hsaContribution"),
      annualOutOfPocketMedical: num("annualOutOfPocketMedical"),
    },
    planning: {
      plannedEquipmentPurchases: num("plannedEquipmentPurchases"),
      ownerPaidBusinessCosts: num("ownerPaidBusinessCosts"),
    },
    entities: Object.fromEntries(
      entities.map((e) => [
        e.slug,
        {
          role: str(`ent_${e.slug}_role`, base.entities[e.slug]?.role ?? "operating"),
          ownershipPercent: num(`ent_${e.slug}_ownership`, 100),
          taxTreatment: str(`ent_${e.slug}_tax`, "unknown"),
          confirmed: bool(`ent_${e.slug}_confirmed`),
          ownsRealEstate: str(`ent_${e.slug}_realestate`, "no") as "yes" | "no" | "unconfirmed",
          rentsToGroup: str(`ent_${e.slug}_rents`, "unknown") as "yes" | "no" | "unknown",
        },
      ])
    ),
    goals: str("goals"),
  };

  await saveIntake(intake);
  return NextResponse.redirect(new URL("/intake?saved=1", req.url), 303);
}
