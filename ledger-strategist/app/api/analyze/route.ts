import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadIntake } from "@/lib/intake";
import { buildBooksSummaries } from "@/lib/strategies/books";
import { runAnalyzer } from "@/lib/strategies/analyzer";

// Runs the strategy library against the real books + intake and stores the
// results with a runId so the plan page always shows a consistent snapshot.
export async function POST(req: NextRequest) {
  const [intake, books, strategies] = await Promise.all([
    loadIntake(),
    buildBooksSummaries(),
    prisma.strategy.findMany(),
  ]);

  const results = runAnalyzer({ intake, books }, strategies);
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
