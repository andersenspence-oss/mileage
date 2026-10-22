import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, fmtDate } from "@/lib/format";
import { pickerAccounts, type PayrollInput } from "@/lib/bookkeeping";
import { Flash, EntityTabs, AccountSelect, ymd } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const entities = await prisma.entity.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });
  const entity = entities.find((e) => e.slug === sp.entity) ?? entities[0];
  if (!entity) return <div><h1>Payroll</h1><p>Add an entity first.</p></div>;

  const [picker, defaultsRow, runs, adp] = await Promise.all([
    pickerAccounts(entity.id),
    prisma.setting.findUnique({ where: { key: `payroll_defaults_${entity.id}` } }),
    prisma.payrollRun.findMany({ where: { entityId: entity.id }, orderBy: { payDate: "desc" }, take: 24 }),
    prisma.qbName.findFirst({ where: { entityId: entity.id, name: { contains: "ADP" } } }),
  ]);
  const def = (defaultsRow ? JSON.parse(defaultsRow.value) : {}) as Partial<PayrollInput>;
  const byType = (types: string[]) => [{ label: "Accounts", accounts: picker.all.filter((a) => types.includes(a.type)) }];
  const banks = picker.all.filter((a) => a.type === "bank");
  const guess = (types: string[], re: RegExp) => picker.all.find((a) => types.includes(a.type) && re.test(a.name))?.id;
  const wageDefault = def.wageLines?.length ? def.wageLines : [{ accountId: guess(["expense"], /wage|salar|payroll/i) ?? "", amount: 0 }];

  return (
    <div>
      <h1>Payroll (ADP)</h1>
      <p className="subtitle">
        Enter each payroll from ADP&apos;s <b>Payroll Summary</b> (or Statistical Summary) report. The app records it the way
        an accountant would: gross wages and employer taxes as expenses, withholdings held in Payroll Liabilities until
        ADP pays them, and one bank entry for each debit ADP makes, so the bank download matches automatically.
      </p>
      <EntityTabs entities={entities} current={entity.slug} base="/payroll" />
      <Flash params={sp} />

      <form className="card" action="/api/payroll" method="post">
        <input type="hidden" name="action" value="create" />
        <input type="hidden" name="entityId" value={entity.id} />
        <input type="hidden" name="returnTo" value={`/payroll?entity=${entity.slug}`} />
        <div className="cardgrid">
          <label className="field"><span className="fieldname">Pay date (check date)</span><input type="date" name="payDate" required defaultValue={ymd(new Date())} /></label>
          <label className="field"><span className="fieldname">Bank account ADP debits</span>
            <select name="bankAccountId" required defaultValue={def.bankAccountId ?? banks[0]?.id ?? ""}>
              <option value="">Choose…</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <label className="field"><span className="fieldname">Payee name in QuickBooks</span><input type="text" name="payeeName" defaultValue={def.payeeName ?? adp?.name ?? ""} placeholder="ADP" /></label>
        </div>

        <h3>1. Gross wages</h3>
        <p className="xsmall mut">Total gross pay before anything is withheld. Use more than one line if wages go to different accounts (e.g. officer pay vs. staff).</p>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="toolbar" style={{ margin: "4px 0", display: i < Math.max(2, wageDefault.length + 1) ? "flex" : "none" }}>
            <AccountSelect name={`wage_acc_${i}`} groups={byType(["expense", "cogs"])} value={wageDefault[i]?.accountId} placeholder="Wage account…" />
            <input type="text" name={`wage_amt_${i}`} placeholder="Gross amount" style={{ width: 130 }} />
            <input type="text" name={`wage_memo_${i}`} placeholder="Memo (optional)" defaultValue={wageDefault[i]?.memo ?? ""} />
          </div>
        ))}

        <h3>2. Withheld from employees</h3>
        <div className="cardgrid">
          <label className="field"><span className="fieldname">Employee taxes withheld (federal &amp; state income tax, employee Social Security &amp; Medicare)</span><input type="text" name="employeeTaxes" placeholder="0.00" /></label>
          <label className="field"><span className="fieldname">Other deductions withheld (401k, HSA, garnishments; paid separately)</span><input type="text" name="otherDeductions" placeholder="0.00" /></label>
        </div>

        <h3>3. Employer taxes and net pay</h3>
        <div className="cardgrid">
          <label className="field"><span className="fieldname">Employer taxes (employer Social Security &amp; Medicare, FUTA, Utah SUI)</span><input type="text" name="employerTaxes" placeholder="0.00" /></label>
          <label className="field"><span className="fieldname">Net pay (total direct deposits and checks)</span><input type="text" name="netPay" placeholder="0.00" required /></label>
          <label className="field"><span className="fieldname">ADP service fee (if billed this payroll)</span><input type="text" name="fee" placeholder="0.00" /></label>
        </div>

        <h3>Accounts</h3>
        <div className="cardgrid">
          <label className="field"><span className="fieldname">Payroll liabilities</span><AccountSelect name="liabilityAccountId" groups={byType(["liability"])} value={def.liabilityAccountId ?? guess(["liability"], /payroll/i)} required /></label>
          <label className="field"><span className="fieldname">Employer payroll tax expense</span><AccountSelect name="employerTaxAccountId" groups={byType(["expense"])} value={def.employerTaxAccountId ?? guess(["expense"], /payroll.*tax|tax.*payroll/i)} required /></label>
          <label className="field"><span className="fieldname">ADP fee expense</span><AccountSelect name="feeAccountId" groups={byType(["expense"])} value={def.feeAccountId ?? guess(["expense"], /payroll.*(fee|service)|service.*fee/i)} /></label>
        </div>
        <p className="xsmall mut">
          Check: gross wages − employee taxes − other deductions must equal net pay to the penny, or the app will say what&apos;s off.
          The tax deposit ADP takes = employee taxes + employer taxes.
        </p>
        <button className="btn" type="submit">Record payroll</button>
      </form>

      {runs.length > 0 && (
        <>
          <h2>Payrolls entered</h2>
          <table className="data">
            <thead><tr><th>Pay date</th><th className="num">Gross</th><th className="num">Net pay</th><th className="num">Tax deposit</th><th className="num">Employer taxes</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const p = JSON.parse(r.dataJson) as PayrollInput;
                const gross = p.wageLines.reduce((s, l) => s + l.amount, 0);
                return (
                  <tr key={r.id}>
                    <td className="small">{fmtDate(r.payDate)}</td>
                    <td className="num">{usd(gross, { cents: true })}</td>
                    <td className="num">{usd(p.netPay, { cents: true })}</td>
                    <td className="num">{usd(p.employeeTaxes + p.employerTaxes, { cents: true })}</td>
                    <td className="num">{usd(p.employerTaxes, { cents: true })}</td>
                    <td>
                      <Link className="btn small secondary" href={`/register/${r.bankAccountId}`}>Register</Link>{" "}
                      <form className="inline" action="/api/payroll" method="post">
                        <input type="hidden" name="action" value="delete" />
                        <input type="hidden" name="entityId" value={entity.id} />
                        <input type="hidden" name="runId" value={r.id} />
                        <button className="btn small danger" type="submit">Delete</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
