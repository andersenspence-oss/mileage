// Bridges the database and the pure report engine.
import { prisma } from "./db";
import type { AccountLite, TxnLite } from "./reports";

export type EntityScope = { slug: string; name: string; entityIds: string[] };

/** Everything the ledger math needs from a transaction row. */
export const LEDGER_TXN_SELECT = {
  id: true,
  entityId: true,
  date: true,
  amount: true,
  flow: true,
  accountId: true,
  registerAccountId: true,
  kind: true,
  transferAccountId: true,
  splits: { select: { accountId: true, amount: true, memo: true } },
} as const;

export const LEDGER_ACCOUNT_SELECT = {
  id: true,
  entityId: true,
  name: true,
  type: true,
  openingBalance: true,
  startDate: true,
} as const;

type TxnRow = {
  id: string; date: Date; amount: number; flow: string; accountId: string | null;
  registerAccountId: string | null; kind: string; transferAccountId: string | null;
  splits: { accountId: string; amount: number; memo: string | null }[];
};

export function toTxnLite(t: TxnRow): TxnLite {
  return {
    id: t.id, date: t.date, amount: t.amount, flow: t.flow, accountId: t.accountId,
    registerAccountId: t.registerAccountId, kind: t.kind, transferAccountId: t.transferAccountId,
    splits: t.splits.length ? t.splits : undefined,
  };
}

/**
 * "all" = every entity, including sold ones, so that combined reports for a
 * past period still include a business for the months you owned it.
 */
export async function resolveScope(entityParam?: string): Promise<EntityScope> {
  if (entityParam && entityParam !== "all") {
    const e = await prisma.entity.findUnique({ where: { slug: entityParam } });
    if (e) return { slug: e.slug, name: e.name + (e.status !== "active" ? " (sold)" : ""), entityIds: [e.id] };
  }
  const all = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  return { slug: "all", name: "Combined: all entities", entityIds: all.map((e) => e.id) };
}

export async function loadBooks(entityIds: string[]): Promise<{ txns: TxnLite[]; accounts: AccountLite[] }> {
  const [txns, accounts] = await Promise.all([
    prisma.transaction.findMany({ where: { entityId: { in: entityIds } }, select: LEDGER_TXN_SELECT }),
    prisma.account.findMany({ where: { entityId: { in: entityIds } }, select: LEDGER_ACCOUNT_SELECT }),
  ]);
  return { txns: txns.map(toTxnLite), accounts };
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
