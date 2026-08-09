import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// What-if mode: include/exclude a strategy from the combined estimate.
export async function POST(req: NextRequest) {
  const f = await req.formData();
  const strategyId = String(f.get("strategyId") ?? "");
  const included = f.get("included") === "1";
  if (strategyId) {
    await prisma.scenarioToggle.upsert({
      where: { strategyId },
      update: { included },
      create: { strategyId, included },
    });
  }
  return NextResponse.redirect(new URL("/plan", req.url), 303);
}
