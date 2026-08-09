import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadIntake } from "@/lib/intake";
import { buildBooksSummaries } from "@/lib/strategies/books";
import { runAnalyzer } from "@/lib/strategies/analyzer";
import { summarizeTrips } from "@/lib/mileage";
import { summarizePerDiem } from "@/lib/perdiem";
import { ASSUMPTIONS } from "@/lib/assumptions";
import { STRATEGY_LIBRARY } from "@/lib/strategies/library";

// Runs the strategy library against the real books + intake (+ the synced
// mileage log, when present) and stores the results with a runId so the plan
// page always shows a consistent snapshot.
export async function POST(req: NextRequest) {
  // Library entries added in app updates get inserted on the fly so existing
  // databases pick them up without a reseed.
  for (const s of STRATEGY_LIBRARY) {
    const exists = await prisma.strategy.findUnique({ where: { id: s.id } });
    if (!exists) {
      await prisma.strategy.create({ data: { ...s, paramsJson: "{}", enabled: true, custom: false } });
      await prisma.scenarioToggle.upsert({
        where: { strategyId: s.id },
        update: {},
        create: { strategyId: s.id, included: true },
      });
    }
  }

  const [intake, books, strategies, trips, pdTrips] = await Promise.all([
    loadIntake(),
    buildBooksSummaries(),
    prisma.strategy.findMany(),
    prisma.mileageTrip.findMany(),
    prisma.perDiemTrip.findMany(),
  ]);
  const now = new Date();
  const mileage = trips.length > 0 ? summarizeTrips(trips, now, ASSUMPTIONS.mileage_rate.value) : undefined;
  const perDiem = pdTrips.length > 0
    ? summarizePerDiem(
        pdTrips,
        { standard: ASSUMPTIONS.perdiem_mie_standard.value, highCost: ASSUMPTIONS.perdiem_mie_high.value },
        new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
        now
      )
    : undefined;

  const results = runAnalyzer({ intake, books, mileage, perDiem }, strategies);
  const runId = `run_${Date.now()}`;

  await prisma.strategyResult.deleteMany();
  for (const r of results) {
    await prisma.strategyResult.create({
      data: {
        runId,
        strategyId: r.strategyId,
        relevant: r.relevant,
        estimatedSavings: r.estimatedSavings,
        score: r.score,
        summary: r.summary,
        mathTraceJson: JSON.stringify(r.trace),
        cpaChecklistJson: JSON.stringify(r.cpaChecklist),
      },
    });
  }
  await prisma.setting.upsert({
    where: { key: "lastAnalysisRun" },
    update: { value: JSON.stringify({ runId, at: new Date().toISOString() }) },
    create: { key: "lastAnalysisRun", value: JSON.stringify({ runId, at: new Date().toISOString() }) },
  });

  return NextResponse.redirect(new URL("/plan?analyzed=1", req.url), 303);
}
