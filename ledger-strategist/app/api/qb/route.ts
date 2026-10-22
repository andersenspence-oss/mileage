import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, money, date, requireDate, withParams } from "@/lib/http";
import { importQbLists, createExport, undoExport, BookError } from "@/lib/bookkeeping";

// QuickBooks 2016 bridge: load lists, set go-live balances, create / undo export files.
export async function POST(req: NextRequest) {
  return act(req, "/quickbooks", async (form) => {
    const action = str(form, "action");
    const entity = await prisma.entity.findUnique({ where: { id: str(form, "entityId") } });
    if (!entity) throw new BookError("Pick an entity first.");
    const back = `/quickbooks?entity=${entity.slug}`;

    if (action === "lists") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new BookError("Choose the .IIF file QuickBooks exported.");
      if (file.size > 20 * 1024 * 1024) throw new BookError("That file is too large to be a QuickBooks list export.");
      const text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
      const r = await importQbLists(entity.id, text);
      return withParams(back, {
        msg: `Loaded from QuickBooks: ${r.created} new accounts, ${r.linked} matched to existing ones, ${r.names} vendor/customer names.` +
          (r.skipped.length ? ` Skipped ${r.skipped.length} non-posting accounts (estimates, purchase orders), which is normal.` : ""),
      });
    }

    if (action === "golive") {
      const regs = await prisma.account.findMany({ where: { entityId: entity.id, type: { in: ["bank", "credit_card"] } } });
      let n = 0;
      for (const a of regs) {
        const startDate = date(form, `start_${a.id}`);
        const bal = money(form, `bal_${a.id}`);
        const last4 = str(form, `last4_${a.id}`).replace(/\D/g, "").slice(-4) || null;
        const archived = str(form, `archived_${a.id}`) === "on";
        if (startDate && bal === null) throw new BookError(`Enter the statement balance for ${a.name} on its go-live date.`);
        const locked = await prisma.reconciliation.count({ where: { registerAccountId: a.id, status: "finished" } });
        if (locked && (startDate?.getTime() !== a.startDate?.getTime() || (bal ?? 0) !== a.openingBalance)) {
          throw new BookError(`${a.name} already has finished reconciliations, so its starting point can't change. Undo them first if the start was wrong.`);
        }
        await prisma.account.update({ where: { id: a.id }, data: { startDate, openingBalance: bal ?? 0, last4, archived } });
        n++;
      }
      return withParams(back, { msg: `Saved starting points for ${n} bank and card accounts.` });
    }

    if (action === "export") {
      const through = requireDate(form, "through", "'through' date");
      const b = await createExport(entity.id, through);
      return withParams(back, { msg: `Created a QuickBooks file with ${b.txnCount} transactions. Download it below, then import it into QuickBooks.`, batch: b.id });
    }

    if (action === "undo") {
      if (str(form, "confirm") !== "on") throw new BookError("Check the box confirming that file was NOT imported into QuickBooks.");
      await undoExport(str(form, "batchId"));
      return withParams(back, { msg: "Export undone. Those transactions will be included in the next file." });
    }

    if (action === "fixed") {
      await prisma.transaction.updateMany({ where: { entityId: entity.id, changedAfterExport: true, id: str(form, "txnId") || undefined }, data: { changedAfterExport: false } });
      return withParams(back, { msg: "Marked as fixed in QuickBooks." });
    }
    throw new BookError("Unknown action.");
  });
}
