import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, fmtDate } from "@/lib/format";
import { registerView, pickerAccounts, lastFinishedRecon } from "@/lib/bookkeeping";
import { Flash, AccountSelect, ymd } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const acc = await prisma.account.findUnique({ where: { id } });
  if (!acc) return <div><h1>Register</h1><p>That account doesn&apos;t exist. <Link href="/books">Back</Link></p></div>;

  const [view, picker, last, names] = await Promise.all([
    registerView(id),
    pickerAccounts(acc.entityId),
    lastFinishedRecon(id),
    prisma.qbName.findMany({ where: { entityId: acc.entityId }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const isCard = acc.type === "credit_card";
  const show = sp.show ?? "90";
  const cutoff = show === "all" ? null : new Date(Date.now() - Number(show) * 86400000);
  const rows = view.rows.filter((r) => !cutoff || r.date >= cutoff).reverse();
  const needCat = view.rows.filter((r) => ["uncategorized", "suggested"].includes(r.txn.categoryStatus) && r.txn.registerAccountId === id).length;
  const groups = picker.groups.map((g) => ({ label: g.label, accounts: g.accounts.filter((a) => a.id !== id) })).filter((g) => g.accounts.length);
  const here = `/register/${id}${show !== "90" ? `?show=${show}` : ""}`;

  const categoryLabel = (t: (typeof rows)[number]["txn"]) => {
    if (t.kind === "transfer") {
      const other = t.registerAccountId === id ? t.transferAccount : t.registerAccount;
      return <span>Transfer {t.registerAccountId === id ? (t.flow === "out" ? "to" : "from") : (t.flow === "out" ? "from" : "to")} {other?.name ?? "?"}</span>;
    }
    if (t.splits.length) return <span>Split: {t.splits.map((s) => s.account.name).join(", ")}</span>;
    return <span>{t.account?.name}</span>;
  };

  return (
    <div>
      <p className="small"><Link href="/books">Bookkeeping</Link> / {view.account.entity.name}</p>
      <h1>{acc.name}{acc.last4 ? <span className="mut"> …{acc.last4}</span> : null}</h1>
      <p className="subtitle">
        {isCard ? "Credit card" : "Bank account"} register.{" "}
        {acc.startDate
          ? <>Starts {fmtDate(acc.startDate)} at {usd(acc.openingBalance, { cents: true })}{isCard ? " owed" : ""} (earlier activity is already in QuickBooks).</>
          : <span className="warn">No go-live date set yet: <Link href={`/quickbooks?entity=${view.account.entity.slug}`}>set it on the QuickBooks 2016 page</Link>.</span>}
      </p>
      <Flash params={sp} />

      <div className="statgrid">
        <div className="stat"><div className="label">{isCard ? "Owed now (per books)" : "Balance now (per books)"}</div><div className="value">{usd(view.balance, { cents: true })}</div></div>
        <div className="stat"><div className="label">Reconciled through</div><div className="value small">{last ? fmtDate(last.statementDate) : "not yet"}</div></div>
        <div className="stat"><div className="label">Need a category</div><div className={`value ${needCat ? "warn" : ""}`}>{needCat}</div></div>
      </div>
      <div className="toolbar">
        <Link className="btn" href={`/import?account=${id}`}>Import download</Link>
        <Link className="btn secondary" href={`/reconcile?account=${id}`}>Reconcile</Link>
        <span className="small mut">Show:</span>
        {["30", "90", "365", "all"].map((s) => (
          <Link key={s} className={`btn small ${show === s ? "" : "secondary"}`} href={`/register/${id}?show=${s}`}>{s === "all" ? "All" : `${s} days`}</Link>
        ))}
      </div>

      <details className="card" open={sp.add === "1"}>
        <summary><b>Add a {isCard ? "charge or payment" : "check, payment, or deposit"} by hand</b> <span className="small mut">(e.g. a check you just wrote; the bank download will match it later)</span></summary>
        <form action="/api/txn" method="post" style={{ marginTop: 10 }}>
          <input type="hidden" name="action" value="add" />
          <input type="hidden" name="registerId" value={id} />
          <input type="hidden" name="returnTo" value={here} />
          <div className="cardgrid">
            <label className="field"><span className="fieldname">Date</span><input type="date" name="date" defaultValue={ymd(new Date())} required /></label>
            <label className="field"><span className="fieldname">Type</span>
              <select name="flow" defaultValue="out">
                {isCard
                  ? <><option value="out">Charge</option><option value="in">Payment / refund</option></>
                  : <><option value="out">Check / payment (money out)</option><option value="in">Deposit (money in)</option></>}
              </select></label>
            <label className="field"><span className="fieldname">Amount</span><input type="text" name="amount" required placeholder="0.00" /></label>
            {!isCard && <label className="field"><span className="fieldname">Check # (optional)</span><input type="text" name="checkNum" /></label>}
            <label className="field"><span className="fieldname">Payee</span><input type="text" name="payee" list="qbnames" /></label>
            <label className="field"><span className="fieldname">Category</span><AccountSelect name="accountId" groups={groups} /></label>
            <label className="field"><span className="fieldname">Memo</span><input type="text" name="memo" /></label>
          </div>
          <button className="btn" type="submit">Add</button>
        </form>
      </details>

      <datalist id="qbnames">{names.map((n) => <option key={n.name} value={n.name} />)}</datalist>

      {rows.length === 0 ? (
        <div className="card">No transactions in this range yet. <Link href={`/import?account=${id}`}>Import a download</Link> to get started.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Payee / description</th><th>Category</th>
              <th className="num">{isCard ? "Charge" : "Payment"}</th><th className="num">{isCard ? "Payment" : "Deposit"}</th>
              <th className="num">{isCard ? "Owed" : "Balance"}</th><th title="C = cleared, R = reconciled, QB = in QuickBooks">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = r.txn;
              const up = r.amount > 0; // balance goes up: deposit (bank) / charge (card)
              const pending = ["uncategorized", "suggested"].includes(t.categoryStatus) && t.registerAccountId === id;
              return (
                <tr key={t.id + r.date.getTime()} style={sp.hl === t.id ? { background: "#fffbe6" } : undefined}>
                  <td className="small">{fmtDate(r.date)}{t.checkNum && <div className="xsmall mut">#{t.checkNum}</div>}</td>
                  <td>
                    <Link href={`/txn/${t.id}`}><b>{t.payee || t.vendor || "(no payee)"}</b></Link>
                    <div className="xsmall mut">{t.description}{t.memo && t.memo !== t.description ? ` · ${t.memo}` : ""}</div>
                  </td>
                  <td className="small" style={{ minWidth: 230 }}>
                    {pending ? (
                      <form action="/api/txn" method="post" className="inline">
                        <input type="hidden" name="action" value="category" />
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="returnTo" value={here} />
                        <AccountSelect name="accountId" groups={groups} style={{ maxWidth: 170 }} />{" "}
                        <button className="btn small" type="submit">Save</button>
                      </form>
                    ) : categoryLabel(t)}
                  </td>
                  <td className="num">{(isCard ? up : !up) ? usd(Math.abs(r.amount), { cents: true }) : ""}</td>
                  <td className="num pos">{(isCard ? !up : up) ? usd(Math.abs(r.amount), { cents: true }) : ""}</td>
                  <td className="num">{usd(r.balance, { cents: true })}</td>
                  <td className="xsmall">
                    {r.reconciled ? <span className="badge green" title="Reconciled">R</span> : r.cleared ? <span className="badge blue" title="Cleared">C</span> : null}{" "}
                    {r.fromBank && <span className="badge" title="Came from (or matched) a bank download">bank</span>}{" "}
                    {t.qbStatus === "exported" && <span className="badge green" title="Sent to QuickBooks">QB</span>}
                    {t.qbStatus === "in_qb" && <span className="badge" title="Before go-live: already in QuickBooks">QB</span>}
                    {t.changedAfterExport && <span className="badge amber" title="Changed after it was sent to QuickBooks">changed</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {view.preGoLiveCount > 0 && (
        <p className="small mut">{view.preGoLiveCount} older transactions dated on or before the go-live date are kept for reports and tax analysis but not shown in this register.</p>
      )}
    </div>
  );
}
