import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Add a custom strategy, or enable/disable an existing one.
export async function POST(req: NextRequest) {
  const f = await req.formData();
  const action = String(f.get("action") ?? "");

  if (action === "toggle") {
    const id = String(f.get("id") ?? "");
    const s = await prisma.strategy.findUnique({ where: { id } });
    if (s) await prisma.strategy.update({ where: { id }, data: { enabled: !s.enabled } });
  } else if (action === "add") {
    const name = String(f.get("name") ?? "").trim();
    if (name) {
      const id = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}_${Date.now() % 10000}`;
      await prisma.strategy.create({
        data: {
          id,
          name,
          description: String(f.get("description") ?? ""),
          provision: String(f.get("provision") ?? ""),
          eligibility: String(f.get("eligibility") ?? ""),
          signals: "",
          impactFormula: "Custom strategy — estimate manually with your CPA.",
          effort: Math.min(5, Math.max(1, parseInt(String(f.get("effort") ?? "3")) || 3)),
          complexity: "medium",
          verifyNotes: String(f.get("verifyNotes") ?? "Review with CPA."),
          custom: true,
        },
      });
      await prisma.scenarioToggle.create({ data: { strategyId: id, included: false } });
    }
  }
  return NextResponse.redirect(new URL("/strategies", req.url), 303);
}
