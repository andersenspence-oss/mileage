import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TEMPLATE = [
  "Import every bank and card download through month-end",
  "Enter every ADP payroll for the month",
  "Clear the review queue (categorize everything)",
  "Resolve or dismiss all anomaly flags",
  "Reconcile every bank and card account to its statement",
  "Send the month to QuickBooks 2016 (back up first, then import the IIF file)",
  "Fix in QuickBooks anything marked 'changed after sending'",
  "Review P&L vs. last month for each entity",
  "Record any transfers between entities as owner contributions/draws or loans (ask the CPA which)",
  "Export the CPA package",
  "Download a backup of this app (Entities page) and store it somewhere safe",
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
