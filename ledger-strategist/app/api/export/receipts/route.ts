import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Receipt register (with match status) as CSV — part of the CPA package.
export async function GET() {
  const receipts = await prisma.receipt.findMany({
    where: { status: { not: "dismissed" } },
    orderBy: { date: "asc" },
  });
  const txnIds = receipts.map((r) => r.matchedTransactionId).filter((x): x is string => Boolean(x));
  const txns = await prisma.transaction.findMany({
    where: { id: { in: txnIds } },
    include: { entity: { select: { name: true } }, account: { select: { name: true } } },
  });
  const txnById = new Map(txns.map((t) => [t.id, t]));

  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ["Date", "Vendor", "Amount", "Source", "Status", "Matched entity", "Matched category", "Matched txn date", "Photo link"],
    ...receipts.map((r) => {
      const t = r.matchedTransactionId ? txnById.get(r.matchedTransactionId) : null;
      return [
        r.date.toISOString().slice(0, 10),
        r.vendor ?? "",
        r.amount.toFixed(2),
        r.source,
        r.status,
        t?.entity.name ?? "",
        t?.account?.name ?? "",
        t ? t.date.toISOString().slice(0, 10) : "",
        r.imageUrl ?? (r.filePath ? "stored locally in data/receipts" : ""),
      ];
    }),
  ];
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="receipt-register.csv"',
    },
  });
}
