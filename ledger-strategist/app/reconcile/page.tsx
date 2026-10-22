import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, fmtDate } from "@/lib/format";
import { registers, lastFinishedRecon } from "@/lib/bookkeeping";
import { Flash, ymd } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function ReconcileList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const regs = (await registers()).filter((r) => r.entity.status === "active");
  const rows = await Promise.all(regs.map(async (r) => ({
    r,
    last: await lastFinishedRecon(r.id),
    open: await prisma.reconciliation.findFirst({ where: { registerAccountId: r.id, status: "in_progress" } }),
    history: await prisma.reconciliation.findMany({ where: { registerAccountId: r.id, status: "finished" }, orderBy: { statementDate: "desc" }, take: 6 }),
  })));
  const focus = sp.account;
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);

  return (
    <div>
      <h1>Reconcile</h1>
      <p className="subtitle">
        Once a month per account: enter the statement&apos;s ending date and balance, check off what the statement shows,
        and finish when the difference is $0.00. Reconciled items lock so they can&apos;t drift from the statement.
      </p>
      <Flash params={sp} />
      {rows.length === 0 && <div className="callout warn">No bank or card accounts yet. Set them up on the <Link href="/quickbooks">QuickBooks 2016</Link> page.</div>}
      {rows.map(({ r, last, open, history }) => {
        const nextEnd = last ? new Date(last.statementDate.getFullYear(), last.statementDate.getMonth() + 2, 0) : lastMonthEnd;
        return (
          <div key={r.id} className="card" style={focus === r.id ? { borderColor: "var(--brand)" } : undefined}>
            <div className="toolbar" style={{ margin: 0, justifyContent: "space-between" }}>
              <div>
                <b>{r.entity.name}: {r.name}</b> <span className="badge">{r.type === "bank" ? "bank" : "card"}</span>
                <div className="small mut">
                  {last ? <>Reconciled through <b>{fmtDate(last.statementDate)}</b> (ending {usd(last.endingBalance, { cents: true })})</> : r.startDate ? <>Not reconciled here yet; starts from {usd(r.openingBalance, { cents: true })} on {fmtDate(r.startDate)}</> : <span className="warn">Set a go-live date first</span>}
                </div>
              </div>
              <Link className="small" href={`/register/${r.id}`}>Register</Link>
            </div>
            {open ? (
              <div className="toolbar"><Link className="btn" href={`/reconcile/${open.id}`}>Continue: statement ending {fmtDate(open.statementDate)}</Link></div>
            ) : r.startDate ? (
              <form action="/api/reconcile" method="post" className="toolbar">
                <input type="hidden" name="action" value="start" />
                <input type="hidden" name="accountId" value={r.id} />
                <input type="hidden" name="returnTo" value={`/reconcile?account=${r.id}`} />
                <label className="small">Statement ending date <input type="date" name="statementDate" defaultValue={ymd(nextEnd)} required /></label>
                <label className="small">{r.type === "credit_card" ? "New balance (owed)" : "Ending balance"} <input type="text" name="ending" required placeholder="0.00" style={{ width: 120 }} /></label>
                <button className="btn" type="submit">Start</button>
              </form>
            ) : null}
            {history.length > 0 && (
              <div className="xsmall mut">History: {history.map((h) => <Link key={h.id} href={`/reconcile/${h.id}/report`} style={{ marginRight: 10 }}>{fmtDate(h.statementDate)}</Link>)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
