import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Handles approve / edit / reject from the review queue. This is the human-in-
// the-loop gate: only these actions ever set a category, and approvals teach
// the vendor-rule learner.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const txnId = String(form.get("txnId") ?? "");

  const txn = await prisma.transaction.findUnique({
    where: { id: txnId },
    include: { suggestions: { where: { status: "pending" }, orderBy: { createdAt: "desc" } }, entity: true },
  });
  if (!txn) return NextResponse.redirect(new URL("/review", req.url), 303);
  const suggestion = txn.suggestions[0];

  async function accountIdFor(name: string): Promise<string> {
    const existing = await prisma.account.findFirst({ where: { entityId: txn!.entityId, name } });
    if (existing) return existing.id;
    const created = await prisma.account.create({
      data: { entityId: txn!.entityId, name, type: txn!.flow === "in" ? "income" : "expense" },
    });
    return created.id;
  }

  async function learn(accountName: string) {
    const vendor = (txn!.vendor ?? "").trim();
    if (!vendor) return;
    const existing = await prisma.vendorRule.findFirst({ where: { vendorPattern: vendor, entitySlug: null } });
    if (existing) {
      await prisma.vendorRule.update({
        where: { id: existing.id },
        data: { accountName, hits: existing.accountName === accountName ? existing.hits + 1 : 1 },
      });
    } else {
      await prisma.vendorRule.create({ data: { vendorPattern: vendor, accountName, entitySlug: null } });
    }
  }

  if (action === "approve" && suggestion) {
    const accountId = await accountIdFor(suggestion.suggestedAccountName);
    await prisma.transaction.update({ where: { id: txn.id }, data: { accountId, categoryStatus: "approved" } });
    await prisma.categorySuggestion.update({ where: { id: suggestion.id }, data: { status: "approved" } });
    await learn(suggestion.suggestedAccountName);
  } else if (action === "edit") {
    const accountName = String(form.get("accountName") ?? "").trim();
    if (accountName) {
      const accountId = await accountIdFor(accountName);
      await prisma.transaction.update({ where: { id: txn.id }, data: { accountId, categoryStatus: "approved" } });
      if (suggestion) await prisma.categorySuggestion.update({ where: { id: suggestion.id }, data: { status: "edited" } });
      await learn(accountName);
    }
  } else if (action === "reject") {
    if (suggestion) await prisma.categorySuggestion.update({ where: { id: suggestion.id }, data: { status: "rejected" } });
    await prisma.transaction.update({ where: { id: txn.id }, data: { categoryStatus: "uncategorized" } });
  }

  return NextResponse.redirect(new URL("/review", req.url), 303);
}
