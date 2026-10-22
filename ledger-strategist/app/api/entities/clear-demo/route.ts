import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, withParams } from "@/lib/http";

// Removes DEMO data only. Never touches imported bank lines, manual entries,
// payroll, reconciliations, or accounts loaded from QuickBooks 2016.
export async function POST(req: NextRequest) {
  return act(req, "/entities", async (form) => {
    const entitySlug = str(form, "entity");
    const where = entitySlug && entitySlug !== "all" ? { slug: entitySlug } : {};
    const entities = await prisma.entity.findMany({ where });

    let cleared = 0;
    for (const e of entities) {
      const demo = { entityId: e.id, OR: [{ origin: "demo" }, { source: "demo" }] };
      const demoCount = await prisma.transaction.count({ where: demo });
      if (demoCount === 0) continue;
      await prisma.transaction.deleteMany({ where: demo });
      // Demo accounts only make sense with demo transactions. Remove the ones
      // nothing real uses; accounts loaded from QuickBooks are always kept.
      const demoAccounts = await prisma.account.findMany({
        where: { entityId: e.id, fromQb: false, qboId: null },
        include: { _count: { select: { transactions: true, registerTxns: true, transferTxns: true, splits: true } } },
      });
      for (const a of demoAccounts) {
        const used = a._count.transactions + a._count.registerTxns + a._count.transferTxns + a._count.splits;
        if (used === 0) await prisma.account.delete({ where: { id: a.id } });
      }
      cleared += demoCount;
    }
    return withParams("/entities", { msg: cleared ? `Removed ${cleared.toLocaleString()} demo transactions. Real bookkeeping was not touched.` : "There was no demo data left to clear." });
  });
}
