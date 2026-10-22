import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, optStr, money, requireDate, withParams } from "@/lib/http";
import { applyCategory, saveSplits, editTxn, deleteTxn, addManual, BookError, type SplitInput } from "@/lib/bookkeeping";

// Everything you can do to a single transaction from a register or detail page.
export async function POST(req: NextRequest) {
  return act(req, "/books", async (form) => {
    const action = str(form, "action");
    const returnTo = str(form, "returnTo") || "/books";

    if (action === "add") {
      const regId = str(form, "registerId");
      const reg = await prisma.account.findUnique({ where: { id: regId } });
      if (!reg) throw new BookError("Pick the bank or card account.");
      const amount = money(form, "amount");
      if (!amount) throw new BookError("Enter the amount.");
      const id = await addManual({
        entityId: reg.entityId, registerAccountId: reg.id, date: requireDate(form, "date", "date"),
        amount: Math.abs(amount), flow: str(form, "flow") === "in" ? "in" : "out",
        payee: optStr(form, "payee"), checkNum: optStr(form, "checkNum"), memo: optStr(form, "memo"),
        categoryAccountId: optStr(form, "accountId"),
      });
      return withParams(returnTo, { msg: "Added. When the bank download arrives it will match this entry instead of adding it twice.", hl: id });
    }

    const id = str(form, "txnId");
    const t = await prisma.transaction.findUnique({ where: { id }, include: { entity: true } });
    if (!t) throw new BookError("That transaction no longer exists.");

    if (action === "category") {
      const accountId = str(form, "accountId");
      if (!accountId) throw new BookError("Pick a category.");
      const r = await applyCategory(id, accountId);
      const payee = optStr(form, "payee");
      if (payee !== null) {
        await prisma.transaction.update({ where: { id }, data: { payee } });
        // remember the QuickBooks name for this vendor (the category rule was learned above)
        await prisma.vendorRule.updateMany({ where: { vendorPattern: t.vendor ?? "", entitySlug: t.entity.slug }, data: { payeeName: payee } });
      }
      return withParams(returnTo, {
        msg: r.merged ? "Recorded as a transfer, and matched with the same payment on the other account so it isn't counted twice." : undefined,
        error: r.warning ?? undefined,
      });
    }

    if (action === "split") {
      const lines: SplitInput[] = [];
      for (let i = 0; i < 12; i++) {
        const acc = str(form, `split_acc_${i}`);
        const amt = money(form, `split_amt_${i}`);
        if (!acc && amt === null) continue;
        if (!acc) throw new BookError(`Split line ${i + 1} has an amount but no category.`);
        if (amt === null) throw new BookError(`Split line ${i + 1} has a category but no amount.`);
        lines.push({ accountId: acc, amount: amt, memo: str(form, `split_memo_${i}`) || undefined });
      }
      await saveSplits(id, lines);
      return withParams(returnTo, { msg: "Split saved." });
    }

    if (action === "edit") {
      const amount = money(form, "amount");
      await editTxn(id, {
        date: requireDate(form, "date", "date"),
        amount: amount === null ? undefined : Math.abs(amount),
        flow: str(form, "flow") === "in" ? "in" : str(form, "flow") === "out" ? "out" : undefined,
        payee: optStr(form, "payee"), checkNum: optStr(form, "checkNum"), memo: optStr(form, "memo"),
      });
      if (optStr(form, "payee")) {
        const rule = await prisma.vendorRule.findFirst({ where: { vendorPattern: t.vendor ?? "", entitySlug: t.entity.slug } });
        if (rule) await prisma.vendorRule.update({ where: { id: rule.id }, data: { payeeName: optStr(form, "payee") } });
      }
      return withParams(returnTo, { msg: "Saved." });
    }

    if (action === "delete") {
      const reg = t.registerAccountId;
      await deleteTxn(id);
      return withParams(reg ? `/register/${reg}` : "/books", { msg: "Deleted." });
    }
    throw new BookError("Unknown action.");
  });
}
