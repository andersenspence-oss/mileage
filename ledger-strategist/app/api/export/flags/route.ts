import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Open flagged items as CSV — part of the CPA package.
export async function GET() {
  const flags = await prisma.anomalyFlag.findMany({
    where: { status: "open" },
    include: { transaction: { include: { entity: true, account: true } } },
    orderBy: { createdAt: "desc" },
  });
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ["Kind", "Entity", "Date", "Vendor", "Category", "Amount", "Detail"],
    ...flags.map((f) => [
      f.kind,
      f.transaction.entity.name,
      f.transaction.date.toISOString().slice(0, 10),
      f.transaction.vendor ?? "",
      f.transaction.account?.name ?? "UNCATEGORIZED",
      f.transaction.amount.toFixed(2),
      f.detail,
    ]),
  ];
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="flagged-items.csv"',
    },
  });
}
