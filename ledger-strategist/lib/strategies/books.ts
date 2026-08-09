// Builds the per-entity 12-month books summary the analyzer consumes.
import { prisma } from "../db";

export type EntityBooks = {
  slug: string;
  name: string;
  income12: number;
  expense12: number; // includes cogs
  net12: number;
  spendByAccount: Record<string, number>; // 12-month outflow per account name
  fixedAssets: { name: string; balance: number; subtype: string | null }[];
  rentPaid: number;
  autoFuelSpend: number;
};

export async function buildBooksSummaries(): Promise<EntityBooks[]> {
  const entities = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  const to = new Date();
  const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());

  const out: EntityBooks[] = [];
  for (const e of entities) {
    const [txns, accounts] = await Promise.all([
      prisma.transaction.findMany({
        where: { entityId: e.id, date: { gte: from, lte: to } },
        select: { amount: true, flow: true, account: { select: { name: true, type: true } } },
      }),
      prisma.account.findMany({ where: { entityId: e.id } }),
    ]);

    let income12 = 0, expense12 = 0;
    const spendByAccount: Record<string, number> = {};
    for (const t of txns) {
      if (t.flow === "in") income12 += t.amount;
      else {
        expense12 += t.amount;
        const name = t.account?.name ?? "Uncategorized";
        spendByAccount[name] = (spendByAccount[name] ?? 0) + t.amount;
      }
    }
    const rentPaid = Object.entries(spendByAccount)
      .filter(([n]) => /rent/i.test(n) && !/equipment/i.test(n))
      .reduce((s, [, v]) => s + v, 0);
    const autoFuelSpend = Object.entries(spendByAccount)
      .filter(([n]) => /auto|fuel|vehicle|mileage/i.test(n))
      .reduce((s, [, v]) => s + v, 0);

    out.push({
      slug: e.slug,
      name: e.name,
      income12: Math.round(income12),
      expense12: Math.round(expense12),
      net12: Math.round(income12 - expense12),
      spendByAccount: Object.fromEntries(Object.entries(spendByAccount).map(([k, v]) => [k, Math.round(v)])),
      fixedAssets: accounts
        .filter((a) => a.type === "fixed_asset")
        .map((a) => ({ name: a.name, balance: a.openingBalance, subtype: a.subtype })),
      rentPaid: Math.round(rentPaid),
      autoFuelSpend: Math.round(autoFuelSpend),
    });
  }
  return out;
}
