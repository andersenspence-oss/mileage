import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, fmtDate, pct } from "@/lib/format";
import { pickerAccounts, isLocked } from "@/lib/bookkeeping";
import { Flash, AccountSelect, ymd } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function TxnPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await prisma.transaction.findUnique({
    where: { id },
    include: {
      entity: true, account: true, registerAccount: true, transferAccount: true,
      splits: { include: { account: true }, orderBy: { sort: "asc" } },
      clears: { include: { reconciliation: true } },
      suggestions: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!t) return <div><h1>Transaction</h1><p>It no longer exists (it may have been merged with the other side of a transfer). <Link href="/books">Back</Link></p></div>;

  const [picker, names, receipts, batch] = await Promise.all([
    pickerAccounts(t.entityId),
    prisma.qbName.findMany({ where: { entityId: t.entityId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.receipt.findMany({ where: { matchedTransactionId: t.id } }),
    t.exportBatchId ? prisma.exportBatch.findUnique({ where: { id: t.exportBatchId } }) : null,
  ]);
  const locked = isLocked(t);
  const isCard = t.registerAccount?.type === "credit_card";
  const here = `/txn/${t.id}`;
  const groups = picker.groups.map((g) => ({ label: g.label, accounts: g.accounts.filter((a) => a.id !== t.registerAccountId) })).filter((g) => g.accounts.length);
  const splitGroups = groups.filter((g) => !g.label.startsWith("Transfer"));
  const splitRows = Math.max(4, t.splits.length + 2);
  const s = t.suggestions[0];
  const current = t.kind === "transfer" ? t.transferAccountId : t.splits.length ? null : t.accountId;
  const qbKnown = t.payee && names.some((n) => n.name.toLowerCase() === t.payee!.toLowerCase());

  return (
    <div>
      <p className="small">
        <Link href="/books">Bookkeeping</Link> / {t.entity.name}
        {t.registerAccount && <> / <Link href={`/register/${t.registerAccount.id}`}>{t.registerAccount.name}</Link></>}
      </p>
      <h1>{t.payee || t.vendor || "(no payee)"} <span className={t.flow === "in" ? "pos" : ""}>{t.flow === "in" ? "+" : "−"}{usd(t.amount, { cents: true })}</span></h1>
      <p className="subtitle">
        {fmtDate(t.date)} · {t.registerAccount?.name ?? "no account"} ·{" "}
        {isCard ? (t.flow === "out" ? "charge" : "payment / refund") : (t.flow === "out" ? "money out" : "money in")}
        {t.checkNum ? ` · check #${t.checkNum}` : ""}
      </p>
      <Flash params={sp} />

      <div className="toolbar">
        {locked && <span className="badge green">Reconciled: date and amount are locked</span>}
        {t.qbStatus === "exported" && <span className="badge green">Sent to QuickBooks {batch ? `on ${fmtDate(batch.createdAt)}` : ""}</span>}
        {t.qbStatus === "in_qb" && <span className="badge">Before go-live: already in QuickBooks</span>}
        {t.qbStatus === "pending" && <span className="badge amber">Not in QuickBooks yet</span>}
        {t.changedAfterExport && <span className="badge red">Changed after sending: update QuickBooks too</span>}
        {t.origin === "payroll" && <span className="badge blue">From a payroll entry</span>}
      </div>

      {t.qbStatus === "exported" && (
        <div className="callout warn small">This is already in QuickBooks. Changes here won&apos;t reach QuickBooks automatically; you&apos;ll be reminded on the QuickBooks page to make the same change there.</div>
      )}

      <h2>Category</h2>
      <div className="card">
        {s && ["uncategorized", "suggested"].includes(t.categoryStatus) && (
          <p className="small">Suggested: <b>{s.suggestedAccountName}</b> <span className="badge">{pct(s.confidence)} sure</span> <span className="mut">{s.rationale}</span></p>
        )}
        <form action="/api/txn" method="post" className="toolbar">
          <input type="hidden" name="action" value="category" />
          <input type="hidden" name="txnId" value={t.id} />
          <input type="hidden" name="returnTo" value={here} />
          <AccountSelect name="accountId" groups={groups} value={current} />
          <button className="btn" type="submit">Save category</button>
        </form>
        <p className="xsmall mut">Picking a bank or card account records a transfer (like paying the credit card from checking). If the other account&apos;s download already has the same payment, the two are combined automatically.</p>
      </div>

      <h2>Split across categories</h2>
      <form className="card" action="/api/txn" method="post">
        <input type="hidden" name="action" value="split" />
        <input type="hidden" name="txnId" value={t.id} />
        <input type="hidden" name="returnTo" value={here} />
        <p className="small">For one payment that covers several things (supplies plus a personal item, a loan payment of principal plus interest). Lines must add up to {usd(t.amount, { cents: true })}. A negative line is allowed.</p>
        <table className="data">
          <thead><tr><th>Category</th><th className="num">Amount</th><th>Memo</th></tr></thead>
          <tbody>
            {Array.from({ length: splitRows }).map((_, i) => {
              const line = t.splits[i];
              return (
                <tr key={i}>
                  <td><AccountSelect name={`split_acc_${i}`} groups={splitGroups} value={line?.accountId} placeholder="—" /></td>
                  <td className="num"><input type="text" name={`split_amt_${i}`} defaultValue={line ? line.amount.toFixed(2) : ""} style={{ width: 110, textAlign: "right" }} /></td>
                  <td><input type="text" name={`split_memo_${i}`} defaultValue={line?.memo ?? ""} style={{ width: "100%" }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="toolbar"><button className="btn secondary" type="submit">Save split</button></div>
      </form>

      <h2>Details</h2>
      <form className="card" action="/api/txn" method="post">
        <input type="hidden" name="action" value="edit" />
        <input type="hidden" name="txnId" value={t.id} />
        <input type="hidden" name="returnTo" value={here} />
        <div className="cardgrid">
          <label className="field"><span className="fieldname">Date</span><input type="date" name="date" defaultValue={ymd(t.date)} disabled={locked} required /></label>
          <label className="field"><span className="fieldname">Amount</span><input type="text" name="amount" defaultValue={t.amount.toFixed(2)} disabled={locked} /></label>
          <label className="field"><span className="fieldname">Direction</span>
            <select name="flow" defaultValue={t.flow} disabled={locked}>
              {isCard ? <><option value="out">Charge</option><option value="in">Payment / refund</option></> : <><option value="out">Money out</option><option value="in">Money in</option></>}
            </select></label>
          <label className="field"><span className="fieldname">Payee (QuickBooks name)</span><input type="text" name="payee" list="qbnames" defaultValue={t.payee ?? ""} />
            {t.payee && !qbKnown && <span className="xsmall warn">Not in this company&apos;s QuickBooks name list; it will go in the memo instead.</span>}</label>
          <label className="field"><span className="fieldname">Check #</span><input type="text" name="checkNum" defaultValue={t.checkNum ?? ""} /></label>
          <label className="field"><span className="fieldname">Memo</span><input type="text" name="memo" defaultValue={t.memo ?? ""} /></label>
        </div>
        {locked && <>
          <input type="hidden" name="date" value={ymd(t.date)} />
          <input type="hidden" name="amount" value={t.amount.toFixed(2)} />
          <input type="hidden" name="flow" value={t.flow} />
        </>}
        <button className="btn secondary" type="submit">Save details</button>
      </form>
      <datalist id="qbnames">{names.map((n) => <option key={n.name} value={n.name} />)}</datalist>

      <h2>Where it came from</h2>
      <div className="card small">
        <p>Origin: <b>{t.origin === "import" ? "bank / card download" : t.origin === "manual" ? "entered by hand" : t.origin}</b>. Bank text: <span className="mut">{t.description ?? "(none)"}</span></p>
        {t.clears.filter((c) => c.bankDescription).map((c) => (
          <p key={c.id}>Matched bank line: <span className="mut">{c.bankDescription}</span></p>
        ))}
        {receipts.length > 0 && <p>Receipts: {receipts.map((r) => <span key={r.id} className="badge green">{r.vendor ?? "receipt"} {usd(r.amount, { cents: true })}</span>)}</p>}
      </div>

      {!locked && t.qbStatus !== "exported" && (
        <form action="/api/txn" method="post" className="toolbar">
          <input type="hidden" name="action" value="delete" />
          <input type="hidden" name="txnId" value={t.id} />
          <input type="hidden" name="returnTo" value={here} />
          <button className="btn danger" type="submit">Delete this transaction</button>
          <span className="xsmall mut">For true mistakes only (e.g. a duplicate you typed). A line from the bank will come back if you download those dates again.</span>
        </form>
      )}
    </div>
  );
}
