import { NextRequest } from "next/server";
import { act, str, money, requireDate, withParams } from "@/lib/http";
import { startRecon, saveRecon, undoRecon, discardRecon, BookError } from "@/lib/bookkeeping";

export async function POST(req: NextRequest) {
  return act(req, "/reconcile", async (form) => {
    const action = str(form, "action");
    if (action === "start") {
      const ending = money(form, "ending");
      if (ending === null) throw new BookError("Enter the statement's ending balance.");
      const r = await startRecon(str(form, "accountId"), requireDate(form, "statementDate", "statement ending date"), ending);
      return `/reconcile/${r.id}`;
    }
    const id = str(form, "reconId");
    if (action === "save" || action === "finish") {
      const keys = form.getAll("cleared").map(String);
      const ending = money(form, "ending");
      const m = await saveRecon(id, keys, action === "finish", ending ?? undefined);
      if (action === "finish") return withParams(`/reconcile/${id}/report`, { msg: "Reconciled. These transactions are now locked to match the statement." });
      return withParams(`/reconcile/${id}`, { msg: `Saved. Difference is $${m.difference.toFixed(2)}.` });
    }
    if (action === "undo") {
      const r = await undoRecon(id);
      return withParams(`/reconcile/${id}`, {
        msg: "Reopened. Make your corrections and finish again." +
          (r.exported ? ` Note: ${r.exported} of these were already sent to QuickBooks; if you change one, change it in QuickBooks too.` : ""),
      });
    }
    if (action === "discard") {
      await discardRecon(id);
      return withParams("/reconcile", { msg: "Discarded that unfinished reconciliation." });
    }
    throw new BookError("Unknown action.");
  });
}
