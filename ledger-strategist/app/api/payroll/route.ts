import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, optStr, money, moneyOr0, requireDate, withParams } from "@/lib/http";
import { createPayroll, deletePayroll, BookError } from "@/lib/bookkeeping";

export async function POST(req: NextRequest) {
  return act(req, "/payroll", async (form) => {
    const action = str(form, "action");
    const entity = await prisma.entity.findUnique({ where: { id: str(form, "entityId") } });
    if (!entity) throw new BookError("Pick the entity.");
    const back = `/payroll?entity=${entity.slug}`;

    if (action === "create") {
      const wageLines: { accountId: string; amount: number; memo?: string }[] = [];
      for (let i = 0; i < 4; i++) {
        const acc = str(form, `wage_acc_${i}`);
        const amt = money(form, `wage_amt_${i}`);
        if (!acc && amt === null) continue;
        if (!acc || amt === null) throw new BookError(`Wage line ${i + 1} needs both an account and an amount.`);
        wageLines.push({ accountId: acc, amount: amt, memo: optStr(form, `wage_memo_${i}`) ?? undefined });
      }
      const need = (k: string, label: string) => { const v = str(form, k); if (!v) throw new BookError(`Pick the ${label}.`); return v; };
      const input = {
        entityId: entity.id,
        bankAccountId: need("bankAccountId", "bank account ADP takes the money from"),
        payDate: requireDate(form, "payDate", "pay date"),
        wageLines,
        employeeTaxes: moneyOr0(form, "employeeTaxes"),
        otherDeductions: moneyOr0(form, "otherDeductions"),
        employerTaxes: moneyOr0(form, "employerTaxes"),
        netPay: moneyOr0(form, "netPay"),
        liabilityAccountId: need("liabilityAccountId", "payroll liabilities account"),
        employerTaxAccountId: need("employerTaxAccountId", "employer payroll tax expense account"),
        fee: moneyOr0(form, "fee"),
        feeAccountId: optStr(form, "feeAccountId"),
        payeeName: optStr(form, "payeeName"),
      };
      if (input.fee > 0 && !input.feeAccountId) throw new BookError("Pick the account for the ADP fee.");
      const r = await createPayroll(input);
      // remember account choices for next time
      await prisma.setting.upsert({
        where: { key: `payroll_defaults_${entity.id}` },
        update: { value: JSON.stringify({ ...input, payDate: undefined }) },
        create: { key: `payroll_defaults_${entity.id}`, value: JSON.stringify({ ...input, payDate: undefined }) },
      });
      return withParams(back, {
        msg: `Payroll recorded as ${r.txnIds.length} bank entries (net pay, tax deposit $${r.taxDebit.toFixed(2)}${input.fee ? ", fee" : ""}). When the bank download arrives, ADP's debits will match these automatically.`,
      });
    }
    if (action === "delete") {
      await deletePayroll(str(form, "runId"));
      return withParams(back, { msg: "Payroll entry deleted." });
    }
    throw new BookError("Unknown action.");
  });
}
