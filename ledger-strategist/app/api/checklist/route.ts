import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TEMPLATE = [
  "Sync / import all entity books",
  "Clear the review queue (categorize everything)",
  "Resolve or dismiss all anomaly flags",
  "Reconcile bank balances against statements",
  "Review P&L vs. last month for each entity",
  "Record any intercompany transfers correctly",
  "Export the CPA package",
];

export async function POST(req: NextRequest) {
  const f = await req.formData();
  const action = String(f.get("action") ?? "");
  const month = String(f.get("month") ?? "");

  if (action === "toggle") {
    const id = String(f.get("id") ?? "");
    const item = await prisma.checklistItem.findUnique({ where: { id } });
    if (item) await prisma.checklistItem.update({ where: { id }, data: { done: !item.done } });
  } else if (action === "add") {
    const label = String(f.get("label") ?? "").trim();
    if (label && month) {
      const max = await prisma.checklistItem.aggregate({ where: { month }, _max: { sort: true } });
      await prisma.checklistItem.create({ data: { month, label, sort: (max._max.sort ?? 0) + 1 } });
    }
  } else if (action === "init" && month) {
    const count = await prisma.checklistItem.count({ where: { month } });
    if (count === 0) {
      await prisma.checklistItem.createMany({ data: TEMPLATE.map((label, i) => ({ month, label, sort: i })) });
    }
  }
  return NextResponse.redirect(new URL(`/close?month=${month}`, req.url), 303);
}
