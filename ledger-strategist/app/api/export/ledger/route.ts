import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveScope, parseDateParam, defaultRange } from "@/lib/reportData";

// Full categorized transaction ledger as CSV — part of the CPA package.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const range = defaultRange();
  const from = parseDateParam(p.get("from") ?? undefined, range.from);
  const to = parseDateParam(p.get("to") ?? undefined, range.to);
  const scope = await resolveScope(p.get("entity") ?? undefined);

  const txns = await prisma.transaction.findMany({
    where: { entityId: { in: scope.entityIds }, date: { gte: from, lte: to } },
    include: { entity: { select: { name: true } }, account: { select: { name: true } } },
    orderBy: [{ date: "asc" }],
  });

  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ["Date", "Entity", "Vendor", "Description", "Category", "Direction", "Amount", "Status", "Source"],
    ...txns.map((t) => [
      t.date.toISOString().slice(0, 10),
      t.entity.name,
      t.vendor ?? "",
      t.description ?? "",
      t.account?.name ?? "UNCATEGORIZED",
      t.flow === "in" ? "money in" : "money out",
      t.amount.toFixed(2),
      t.categoryStatus,
      t.source,
    ]),
  ];
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-${scope.slug}.csv"`,
    },
  });
}
