import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate, usd } from "@/lib/format";
import { reconItems } from "@/lib/bookkeeping";
import { Flash } from "@/app/components/ui";
import ReconcileForm from "../ReconcileForm";

export const dynamic = "force-dynamic";

export default async function ReconcileWork({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const exists = await prisma.reconciliation.findUnique({ where: { id } });
  if (!exists) return <div><h1>Reconcile</h1><p>That reconciliation was discarded. <Link href="/reconcile">Back</Link></p></div>;
  const { recon, account, items } = await reconItems(id);
  if (recon.status === "finished") {
    return (
      <div>
        <h1>Reconciled</h1>
        <p>{account.name} is reconciled through {fmtDate(recon.statementDate)} at {usd(recon.endingBalance, { cents: true })}. <Link href={`/reconcile/${id}/report`}>View the report</Link>.</p>
      </div>
    );
  }
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: account.entityId } });
  return (
    <div>
      <p className="small"><Link href="/reconcile">Reconcile</Link> / {entity.name}</p>
      <h1>{account.name}: statement ending {fmtDate(recon.statementDate)}</h1>
      <p className="subtitle">
        Check every item that appears on the statement. Items dated after {fmtDate(recon.statementDate)} aren&apos;t listed.
        Items you leave unchecked carry over to next month.
      </p>
      <Flash params={sp} />
      <ReconcileForm
        reconId={id}
        isCard={account.type === "credit_card"}
        beginning={recon.beginningBalance}
        ending={recon.endingBalance}
        items={items.map((i) => ({ ...i, date: fmtDate(i.date) }))}
      />
    </div>
  );
}
