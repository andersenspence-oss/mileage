import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, withParams } from "@/lib/http";
import { approveSuggestion, approveConfident, applyCategory, BookError } from "@/lib/bookkeeping";

// The human-in-the-loop gate: only these actions ever set a category, and
// every approval or correction teaches the rule learner for that entity.
export async function POST(req: NextRequest) {
  return act(req, "/review", async (form) => {
    const action = str(form, "action");
    const back = str(form, "returnTo") || "/review";
    if (action === "approve_confident") {
      const slug = str(form, "entity");
      const e = slug ? await prisma.entity.findUnique({ where: { slug } }) : null;
      const n = await approveConfident(0.9, e ? [e.id] : undefined);
      return withParams(back, { msg: `Approved ${n} suggestions that were 90% sure or better.` });
    }
    const txnId = str(form, "txnId");
    if (action === "approve") {
      const r = await approveSuggestion(txnId);
      return withParams(back, { msg: r.merged ? "Approved, and matched with the other side of the transfer." : undefined, error: r.warning ?? undefined });
    }
    if (action === "edit") {
      const accountId = str(form, "accountId");
      if (!accountId) throw new BookError("Pick a category first.");
      const r = await applyCategory(txnId, accountId, { suggestion: "edited" });
      return withParams(back, { msg: r.merged ? "Saved as a transfer and matched with the other side." : undefined, error: r.warning ?? undefined });
    }
    if (action === "reject") {
      await prisma.categorySuggestion.updateMany({ where: { transactionId: txnId, status: "pending" }, data: { status: "rejected" } });
      await prisma.transaction.update({ where: { id: txnId }, data: { categoryStatus: "uncategorized" } });
      return back;
    }
    throw new BookError("Unknown action.");
  });
}
