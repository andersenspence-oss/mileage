import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, optStr, date, requireDate, withParams } from "@/lib/http";
import { createEntity, sellEntity, reactivateEntity, deleteEntity, BookError } from "@/lib/bookkeeping";

// Add a purchased entity, edit one, mark one sold, bring one back, or delete an empty one.
export async function POST(req: NextRequest) {
  return act(req, "/entities", async (form) => {
    const action = str(form, "action");
    const id = str(form, "entityId");
    if (action === "create") {
      const e = await createEntity({ name: str(form, "name"), kind: str(form, "kind"), acquiredOn: date(form, "acquiredOn"), notes: optStr(form, "notes") });
      return withParams("/entities", { msg: `Added ${e.name}. Next: load its QuickBooks 2016 lists on the QuickBooks Setup page.` });
    }
    const e = await prisma.entity.findUnique({ where: { id } });
    if (!e) throw new BookError("That entity no longer exists.");
    if (action === "update") {
      const name = str(form, "name");
      if (!name) throw new BookError("The name can't be blank.");
      await prisma.entity.update({ where: { id }, data: { name, kind: str(form, "kind") || e.kind, notes: optStr(form, "notes"), acquiredOn: date(form, "acquiredOn") } });
      return withParams("/entities", { msg: `Saved ${name}.` });
    }
    if (action === "sell") {
      const soldOn = requireDate(form, "soldOn", "sale date");
      const r = await sellEntity(id, soldOn);
      return withParams("/entities", {
        msg: `${e.name} is marked sold as of ${soldOn.toLocaleDateString()}. Its history stays in reports and tax years it was owned.` +
          (r.pendingExport ? ` Heads up: ${r.pendingExport} categorized transactions were never sent to QuickBooks; you can still export them.` : ""),
      });
    }
    if (action === "reactivate") {
      await reactivateEntity(id);
      return withParams("/entities", { msg: `${e.name} is active again.` });
    }
    if (action === "delete") {
      if (str(form, "confirm") !== e.name) throw new BookError(`To permanently delete, type the exact name "${e.name}" in the box.`);
      await deleteEntity(id);
      return withParams("/entities", { msg: `${e.name} was deleted.` });
    }
    throw new BookError("Unknown action.");
  });
}
