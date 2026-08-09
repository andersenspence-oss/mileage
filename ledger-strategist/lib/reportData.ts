// Bridges the database and the pure report engine.
import { prisma } from "./db";
import type { AccountLite, TxnLite } from "./reports";

export type EntityScope = { slug: string; name: string; entityIds: string[] };

export async function resolveScope(entityParam?: string): Promise<EntityScope> {
  if (entityParam && entityParam !== "all") {
    const e = await prisma.entity.findUnique({ where: { slug: entityParam } });
    if (e) return { slug: e.slug, name: e.name, entityIds: [e.id] };
  }
  const all = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  return { slug: "all", name: "Combined — all entities", entityIds: all.map((e) => e.id) };
}

export async function loadBooks(entityIds: string[]): Promise<{ txns: TxnLite[]; accounts: AccountLite[] }> {
  const [txns, accounts] = await Promise.all([
    prisma.transaction.findMany({
      where: { entityId: { in: entityIds } },
      select: { date: true, amount: true, flow: true, accountId: true },
    }),
    prisma.account.findMany({
      where: { entityId: { in: entityIds } },
      select: { id: true, name: true, type: true, openingBalance: true },
    }),
  ]);
  return { txns, accounts };
}

export function parseDateParam(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(v + "T00:00:00");
  return isNaN(d.getTime()) ? fallback : d;
}

export function defaultRange(): { from: Date; to: Date } {
  const now = new Date();
  return { from: new Date(now.getFullYear(), 0, 1), to: now };
}
