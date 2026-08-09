import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ruleSuggest, claudeSuggest, type Suggestion, type VendorHistory } from "@/lib/categorize";
import { claudeAvailable } from "@/lib/claude";

// Generate suggestions for every uncategorized transaction (rules first, then
// Claude for the remainder). Suggestions go to the review queue — nothing is
// applied automatically.
export async function POST(req: NextRequest) {
  const uncategorized = await prisma.transaction.findMany({
    where: { categoryStatus: "uncategorized" },
    include: { entity: true },
    orderBy: { date: "desc" },
    take: 120,
  });
  if (uncategorized.length === 0) {
    return NextResponse.redirect(new URL("/review?generated=0", req.url), 303);
  }

  const rules = await prisma.vendorRule.findMany();
  // vendor history: most common account per vendor across categorized books
  const categorized = await prisma.transaction.findMany({
    where: { categoryStatus: { in: ["categorized", "approved"] }, vendor: { not: null }, accountId: { not: null } },
    select: { vendor: true, account: { select: { name: true } } },
  });
  const counts = new Map<string, Map<string, number>>();
  for (const t of categorized) {
    const v = t.vendor!.toLowerCase().trim();
    const m = counts.get(v) ?? counts.set(v, new Map()).get(v)!;
    m.set(t.account!.name, (m.get(t.account!.name) ?? 0) + 1);
  }
  const history: VendorHistory = new Map();
  for (const [v, m] of counts) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    history.set(v, { accountName: best[0], count: best[1] });
  }

  const forClaude: typeof uncategorized = [];
  const suggestions: Suggestion[] = [];
  for (const t of uncategorized) {
    const s = ruleSuggest(
      { id: t.id, vendor: t.vendor, description: t.description, amount: t.amount, date: t.date, entityName: t.entity.name, entityKind: t.entity.kind },
      rules, history
    );
    if (s) suggestions.push(s);
    else forClaude.push(t);
  }

  let claudeUsed = false;
  if (forClaude.length > 0 && claudeAvailable()) {
    const accountNames = (
      await prisma.account.findMany({ where: { type: { in: ["expense", "cogs", "income"] } }, select: { name: true }, distinct: ["name"] })
    ).map((a) => a.name);
    const batch = forClaude.slice(0, 50).map((t) => ({
      id: t.id, vendor: t.vendor, description: t.description, amount: t.amount, date: t.date,
      entityName: t.entity.name, entityKind: t.entity.kind,
    }));
    try {
      suggestions.push(...(await claudeSuggest(batch, accountNames)));
      claudeUsed = true;
    } catch {
      // fall through — rules-only is still useful
    }
  }

  for (const s of suggestions) {
    await prisma.categorySuggestion.deleteMany({ where: { transactionId: s.transactionId, status: "pending" } });
    await prisma.categorySuggestion.create({
      data: {
        transactionId: s.transactionId,
        suggestedAccountName: s.suggestedAccountName,
        confidence: s.confidence,
        rationale: s.rationale,
        source: s.source,
      },
    });
    await prisma.transaction.update({ where: { id: s.transactionId }, data: { categoryStatus: "suggested" } });
  }

  const url = new URL(`/review?generated=${suggestions.length}&ai=${claudeUsed ? 1 : 0}`, req.url);
  return NextResponse.redirect(url, 303);
}
