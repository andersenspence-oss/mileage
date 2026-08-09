import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Removes DEMO data only (source: "demo") — never touches anything synced
// from QuickBooks or entered by you. Used when going live so demo books stop
// polluting combined reports and strategy estimates.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const entitySlug = String(form.get("entity") ?? "");

  const where = entitySlug && entitySlug !== "all" ? { slug: entitySlug } : {};
  const entities = await prisma.entity.findMany({ where });

  let cleared = 0;
  for (const e of entities) {
    const demoCount = await prisma.transaction.count({ where: { entityId: e.id, source: "demo" } });
    if (demoCount === 0) continue;
    await prisma.transaction.deleteMany({ where: { entityId: e.id, source: "demo" } });
    // demo accounts (no QuickBooks id) only make sense with demo transactions;
    // remove empty ones so reports don't carry phantom opening balances
    const demoAccounts = await prisma.account.findMany({
      where: { entityId: e.id, qboId: null },
      include: { _count: { select: { transactions: true } } },
    });
    for (const a of demoAccounts) {
      if (a._count.transactions === 0) await prisma.account.delete({ where: { id: a.id } });
    }
    cleared += demoCount;
  }

  return NextResponse.redirect(
    new URL(`/entities?demoCleared=${cleared}&scope=${entitySlug || "all"}`, req.url), 303
  );
}
