import Link from "next/link";
import { usd, fmtDate } from "@/lib/format";
import { activeEntities, entityStatus } from "@/lib/bookkeeping";
import { Flash } from "@/app/components/ui";

export const dynamic = "force-dynamic";

const daysAgo = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86400000);

export default async function BooksHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const entities = await activeEntities();
  const statuses = await Promise.all(entities.map(async (e) => ({ e, s: await entityStatus(e.id) })));
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);

  const totals = statuses.reduce((t, { s }) => ({
    cat: t.cat + s.toCategorize,
    exp: t.exp + s.readyToExport,
    rec: t.rec + s.regs.filter((r) => r.account.startDate && (!r.lastRecon || r.lastRecon.statementDate < lastMonthEnd)).length,
    imp: t.imp + s.regs.filter((r) => r.account.startDate && (!r.lastImport || daysAgo(r.lastImport.createdAt) > 8)).length,
  }), { cat: 0, exp: 0, rec: 0, imp: 0 });

  return (
    <div>
      <h1>Bookkeeping</h1>
      <p className="subtitle">Everything that needs doing, across every active entity. Work top to bottom.</p>
      <Flash params={sp} />

      <div className="statgrid">
        <Link href="/import" className="stat"><div className="label">Accounts to download (8+ days)</div><div className={`value ${totals.imp ? "warn" : "pos"}`}>{totals.imp}</div></Link>
        <Link href="/review" className="stat"><div className="label">Need a category</div><div className={`value ${totals.cat ? "warn" : "pos"}`}>{totals.cat}</div></Link>
        <Link href="/reconcile" className="stat"><div className="label">Accounts to reconcile</div><div className={`value ${totals.rec ? "warn" : "pos"}`}>{totals.rec}</div></Link>
        <Link href="/quickbooks" className="stat"><div className="label">Ready to send to QuickBooks</div><div className="value">{totals.exp}</div></Link>
      </div>

      <div className="cardgrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card small">
          <b>Weekly (about 15 minutes)</b>
          <ol>
            <li><Link href="/import">Import</Link> each bank and card download.</li>
            <li>In the <Link href="/review">Review Queue</Link>, click &quot;Approve all 90%+ sure&quot;, then decide the rest.</li>
            <li>Enter any <Link href="/payroll">ADP payroll</Link> that ran (before or after the download; it matches either way).</li>
            <li>Upload new <Link href="/receipts">receipts</Link>.</li>
          </ol>
        </div>
        <div className="card small">
          <b>Monthly, when statements arrive</b>
          <ol>
            <li><Link href="/reconcile">Reconcile</Link> each bank and card account to its statement.</li>
            <li><Link href="/quickbooks">Send to QuickBooks</Link>: create the file, back up QuickBooks, import it.</li>
            <li>Run the <Link href="/close">Month-End &amp; CPA Package</Link>.</li>
            <li><a href="/api/backup">Download a backup</a> of this app&apos;s books and keep it somewhere safe.</li>
          </ol>
        </div>
      </div>

      {statuses.map(({ e, s }) => (
        <div key={e.id} className="card">
          <div className="toolbar" style={{ margin: 0, justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{e.name}</h2>
            <div className="small">
              {s.qbAccounts === 0
                ? <Link className="badge amber" href={`/quickbooks?entity=${e.slug}`}>Set up QuickBooks link</Link>
                : <span className="badge green">QuickBooks linked</span>}{" "}
              {s.toCategorize > 0 && <Link className="badge amber" href={`/review?entity=${e.slug}`}>{s.toCategorize} to categorize</Link>}{" "}
              {s.readyToExport > 0 && <Link className="badge blue" href={`/quickbooks?entity=${e.slug}`}>{s.readyToExport} ready for QuickBooks</Link>}{" "}
              {s.changedAfterExport > 0 && <Link className="badge red" href={`/quickbooks?entity=${e.slug}`}>{s.changedAfterExport} changed after sending</Link>}
            </div>
          </div>
          {s.regs.length === 0 ? (
            <p className="small mut">No bank or card accounts yet. <Link href={`/quickbooks?entity=${e.slug}`}>Load the QuickBooks lists</Link> to bring them in.</p>
          ) : (
            <table className="data" style={{ marginTop: 10 }}>
              <thead><tr><th>Account</th><th>Last download</th><th>Reconciled through</th><th></th></tr></thead>
              <tbody>
                {s.regs.map(({ account: a, lastImport, lastRecon, openRecon }) => {
                  const stale = !lastImport || daysAgo(lastImport.createdAt) > 8;
                  const behind = !lastRecon || lastRecon.statementDate < lastMonthEnd;
                  return (
                    <tr key={a.id}>
                      <td><Link href={`/register/${a.id}`}><b>{a.name}</b></Link>{a.last4 && <span className="mut"> …{a.last4}</span>}
                        {!a.startDate && <div className="xsmall warn">needs a go-live date</div>}</td>
                      <td className={`small ${stale ? "warn" : ""}`}>{lastImport ? `${fmtDate(lastImport.createdAt)} (${daysAgo(lastImport.createdAt)}d ago)` : "never"}</td>
                      <td className={`small ${behind && a.startDate ? "warn" : ""}`}>
                        {lastRecon ? `${fmtDate(lastRecon.statementDate)} · ${usd(lastRecon.endingBalance, { cents: true })}` : "not yet"}
                        {openRecon && <div className="xsmall"><Link href={`/reconcile/${openRecon.id}`}>in progress</Link></div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link className="btn small secondary" href={`/import?account=${a.id}`}>Import</Link>{" "}
                        <Link className="btn small secondary" href={`/reconcile?account=${a.id}`}>Reconcile</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="xsmall mut" style={{ marginTop: 6 }}>
            {s.lastExport ? <>Last sent to QuickBooks {fmtDate(s.lastExport.createdAt)} ({s.lastExport.txnCount} transactions through {fmtDate(s.lastExport.throughDate)}).</> : "Nothing sent to QuickBooks yet."}
          </div>
        </div>
      ))}
      {entities.length === 0 && <div className="card">No active entities. <Link href="/entities">Add one</Link>.</div>}
    </div>
  );
}
