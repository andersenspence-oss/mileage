import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate, usd } from "@/lib/format";
import { lastFinishedRecon } from "@/lib/bookkeeping";
import { Flash } from "@/app/components/ui";
import PrintButton from "@/app/components/PrintButton";

export const dynamic = "force-dynamic";

// Printable reconciliation report: what cleared, what's still outstanding.
export default async function ReconReport({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const recon = await prisma.reconciliation.findUnique({ where: { id } });
  if (!recon) return <div><p>Not found. <Link href="/reconcile">Back</Link></p></div>;
  const account = await prisma.account.findUniqueOrThrow({ where: { id: recon.registerAccountId }, include: { entity: true } });
  const clears = await prisma.txnClear.findMany({
    where: { reconciliationId: id, accountId: account.id },
    include: { transaction: true },
  });
  const isCard = account.type === "credit_card";
  // effect on the statement balance (+ = balance up: deposit, or charge on a card)
  const effect = (t: { flow: string; amount: number; registerAccountId: string | null }) => {
    const intoAccount = t.registerAccountId === account.id ? t.flow === "in" : t.flow === "out";
    const dp = intoAccount ? t.amount : -t.amount; // debit-positive
    return isCard ? -dp : dp;
  };
  const rows = clears.map((c) => ({ t: c.transaction, amt: effect(c.transaction) })).sort((a, b) => a.t.date.getTime() - b.t.date.getTime());
  const ups = rows.filter((r) => r.amt > 0);
  const downs = rows.filter((r) => r.amt < 0);
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.amt, 0);
  const last = await lastFinishedRecon(account.id);

  const Section = ({ title, xs }: { title: string; xs: typeof rows }) => (
    <>
      <h3>{title}: {usd(Math.abs(sum(xs)), { cents: true })} ({xs.length})</h3>
      <table className="data">
        <tbody>
          {xs.map(({ t, amt }) => (
            <tr key={t.id}><td className="small">{fmtDate(t.date)}</td><td className="small">{t.checkNum ? `#${t.checkNum} ` : ""}{t.payee || t.vendor || t.description}</td><td className="num">{usd(Math.abs(amt), { cents: true })}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );

  return (
    <div>
      <p className="small noprint"><Link href="/reconcile">Reconcile</Link> · <PrintButton /></p>
      <Flash params={sp} />
      <h1>Reconciliation report</h1>
      <p className="subtitle">{account.entity.name}: {account.name} · statement ending {fmtDate(recon.statementDate)} · {recon.status === "finished" ? `finished ${recon.finishedAt ? fmtDate(recon.finishedAt) : ""}` : "not finished"}</p>
      <table className="data" style={{ maxWidth: 520 }}>
        <tbody>
          <tr><td>Beginning balance</td><td className="num">{usd(recon.beginningBalance, { cents: true })}</td></tr>
          <tr><td>{isCard ? "Charges" : "Deposits and credits"} cleared</td><td className="num">{usd(sum(ups), { cents: true })}</td></tr>
          <tr><td>{isCard ? "Payments and refunds" : "Checks and payments"} cleared</td><td className="num">−{usd(Math.abs(sum(downs)), { cents: true })}</td></tr>
          <tr className="total"><td>Statement ending balance</td><td className="num">{usd(recon.endingBalance, { cents: true })}</td></tr>
        </tbody>
      </table>
      <Section title={isCard ? "Charges" : "Deposits and credits"} xs={ups} />
      <Section title={isCard ? "Payments and refunds" : "Checks and payments"} xs={downs} />
      {recon.status === "finished" && last?.id === recon.id && (
        <form action="/api/reconcile" method="post" className="toolbar noprint" style={{ marginTop: 20 }}>
          <input type="hidden" name="action" value="undo" />
          <input type="hidden" name="reconId" value={recon.id} />
          <input type="hidden" name="returnTo" value={`/reconcile/${recon.id}/report`} />
          <button className="btn small danger" type="submit">Undo this reconciliation</button>
          <span className="xsmall mut">Reopens it so a mistake can be fixed. Only the most recent one can be undone.</span>
        </form>
      )}
    </div>
  );
}
