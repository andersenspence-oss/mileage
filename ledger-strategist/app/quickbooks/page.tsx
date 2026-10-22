import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, fmtDate } from "@/lib/format";
import { exportPreview } from "@/lib/bookkeeping";
import { Flash, EntityTabs, ymd } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function QuickBooksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const entities = await prisma.entity.findMany({ orderBy: [{ status: "asc" }, { sort: "asc" }] });
  const entity = entities.find((e) => e.slug === params.entity) ?? entities.find((e) => e.status === "active");
  if (!entity) return <div><h1>QuickBooks 2016</h1><p>Add an entity first on the <Link href="/entities">Entities</Link> page.</p></div>;

  const through = params.through ? new Date(params.through + "T00:00:00") : new Date();
  const [accounts, names, regs, batches, changed, preview] = await Promise.all([
    prisma.account.groupBy({ by: ["type", "fromQb"], where: { entityId: entity.id, archived: false }, _count: true }),
    prisma.qbName.count({ where: { entityId: entity.id } }),
    prisma.account.findMany({ where: { entityId: entity.id, type: { in: ["bank", "credit_card"] } }, orderBy: [{ archived: "asc" }, { type: "asc" }, { name: "asc" }] }),
    prisma.exportBatch.findMany({ where: { entityId: entity.id }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.transaction.findMany({ where: { entityId: entity.id, changedAfterExport: true }, include: { account: true }, orderBy: { date: "asc" } }),
    exportPreview(entity.id, through),
  ]);
  const qbLinked = accounts.filter((a) => a.fromQb).reduce((s, a) => s + a._count, 0);
  const notLinked = await prisma.account.findMany({
    where: {
      entityId: entity.id, fromQb: false,
      OR: [{ registerTxns: { some: { origin: { not: "demo" } } } }, { transactions: { some: { origin: { not: "demo" } } } }, { splits: { some: {} } }],
    },
  });
  const justMade = params.batch ? batches.find((b) => b.id === params.batch) : undefined;

  return (
    <div>
      <h1>QuickBooks 2016</h1>
      <p className="subtitle">
        QuickBooks stays the official books. This app does the daily work and hands QuickBooks a
        finished file, so nothing gets typed in twice. Each entity has its own QuickBooks company file.
      </p>
      <EntityTabs entities={entities.filter((e) => e.status === "active")} current={entity.slug} base="/quickbooks" />
      <Flash params={params} />

      <h2>1. Load the QuickBooks lists <span className="mut small">(once, and again whenever you add accounts in QuickBooks)</span></h2>
      <div className="card">
        <ol className="small">
          <li>Open <b>{entity.name}</b>&apos;s company file in QuickBooks 2016.</li>
          <li><b>File &gt; Utilities &gt; Export &gt; Lists to IIF Files</b>.</li>
          <li>Check <b>Chart of Accounts</b>, <b>Customer List</b>, <b>Vendor List</b>, <b>Employee List</b>, and <b>Other Names List</b>. Click OK and save the file.</li>
          <li>Upload that file here.</li>
        </ol>
        <form action="/api/qb" method="post" encType="multipart/form-data" className="toolbar">
          <input type="hidden" name="action" value="lists" />
          <input type="hidden" name="entityId" value={entity.id} />
          <input type="file" name="file" accept=".iif,.IIF,.txt" required />
          <button className="btn" type="submit">Load lists</button>
        </form>
        <p className="small">
          {qbLinked > 0
            ? <><span className="badge green">{qbLinked} accounts</span> <span className="badge green">{names} names</span> loaded from QuickBooks.</>
            : <span className="badge amber">Not loaded yet</span>}
        </p>
        {notLinked.length > 0 && (
          <div className="callout warn small">
            These accounts are used in this app but don&apos;t exist in QuickBooks, so transactions using them can&apos;t be sent yet:{" "}
            <b>{notLinked.map((a) => a.name).join(", ")}</b>. Either add them in QuickBooks (then reload the lists) or recategorize those transactions.
          </div>
        )}
      </div>

      <h2>2. Bank and card starting points</h2>
      <div className="card">
        <p className="small">
          Pick a <b>go-live date</b> for each account: usually the last day of the most recent statement you already
          reconciled in QuickBooks. Enter that statement&apos;s ending balance (for a credit card, the amount owed).
          Anything dated on or before the go-live date is treated as already in QuickBooks: it still shows in reports
          and tax analysis, but it&apos;s never sent to QuickBooks again.
        </p>
        {regs.length === 0 ? (
          <p className="small mut">No bank or credit card accounts yet. Load the QuickBooks lists first.</p>
        ) : (
          <form action="/api/qb" method="post">
            <input type="hidden" name="action" value="golive" />
            <input type="hidden" name="entityId" value={entity.id} />
            <table className="data">
              <thead><tr><th>Account</th><th>Go-live date</th><th className="num">Statement balance that day</th><th>Last 4 digits</th><th>Hide</th></tr></thead>
              <tbody>
                {regs.map((a) => (
                  <tr key={a.id}>
                    <td><b>{a.name}</b><div className="xsmall mut">{a.type === "bank" ? "Bank" : "Credit card"}{a.fromQb ? "" : " (not in QuickBooks)"}</div></td>
                    <td><input type="date" name={`start_${a.id}`} defaultValue={ymd(a.startDate)} /></td>
                    <td className="num"><input type="text" name={`bal_${a.id}`} defaultValue={a.startDate ? a.openingBalance.toFixed(2) : ""} placeholder="0.00" style={{ width: 120, textAlign: "right" }} /></td>
                    <td><input type="text" name={`last4_${a.id}`} defaultValue={a.last4 ?? ""} style={{ width: 70 }} /></td>
                    <td><input type="checkbox" name={`archived_${a.id}`} defaultChecked={a.archived} title="Closed or unused account" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar"><button className="btn" type="submit">Save starting points</button></div>
          </form>
        )}
      </div>

      <h2>3. Send to QuickBooks</h2>
      <div className="card">
        <form className="toolbar" method="get" action="/quickbooks">
          <input type="hidden" name="entity" value={entity.slug} />
          <label className="small">Include transactions through <input type="date" name="through" defaultValue={ymd(through)} /></label>
          <button className="btn small secondary" type="submit">Refresh</button>
        </form>
        <div className="statgrid">
          <div className="stat"><div className="label">Ready to send</div><div className="value">{preview.ready.length}</div></div>
          <div className="stat"><div className="label">Still need a category</div><div className="value">{preview.waiting}</div>{preview.waiting > 0 && <div className="delta"><Link href={`/review?entity=${entity.slug}`}>Review queue</Link></div>}</div>
          <div className="stat"><div className="label">Blocked</div><div className={`value ${preview.problems.length ? "neg" : ""}`}>{preview.problems.length}</div></div>
        </div>
        {preview.problems.length > 0 && (
          <>
            <p className="small">These can&apos;t be sent until fixed. The others can go now and these will follow next time:</p>
            <table className="data">
              <thead><tr><th>Date</th><th>Transaction</th><th className="num">Amount</th><th>Problem</th></tr></thead>
              <tbody>
                {preview.problems.slice(0, 30).map((p) => (
                  <tr key={p.txnId}><td className="small">{fmtDate(p.date)}</td><td><Link href={`/txn/${p.txnId}`}>{p.label}</Link></td><td className="num">{usd(p.amount, { cents: true })}</td><td className="small neg">{p.problem}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <form action="/api/qb" method="post" className="toolbar">
          <input type="hidden" name="action" value="export" />
          <input type="hidden" name="entityId" value={entity.id} />
          <input type="hidden" name="through" value={ymd(through)} />
          <button className="btn" type="submit" disabled={preview.ready.length === 0}>Create QuickBooks file ({preview.ready.length})</button>
        </form>
        {justMade && (
          <div className="callout">
            <b>File ready:</b> <a className="btn small" href={`/api/qb/download?batch=${justMade.id}`}>Download {justMade.txnCount} transactions (.IIF)</a>
          </div>
        )}
        <details>
          <summary className="small"><b>How to bring the file into QuickBooks 2016</b></summary>
          <ol className="small">
            <li><b>Back up first:</b> File &gt; Back Up Company &gt; Create Local Backup. (An IIF import can&apos;t be undone inside QuickBooks.)</li>
            <li>Make sure you&apos;re in <b>{entity.name}</b>&apos;s company file.</li>
            <li><b>File &gt; Utilities &gt; Import &gt; IIF Files</b>, pick the downloaded file. (If QuickBooks offers &quot;Import for review&quot;, choose it to see a preview first.)</li>
            <li>QuickBooks says the import worked. Spot check one bank register, then you&apos;re done.</li>
            <li>Reconciled items arrive already marked cleared, so QuickBooks&apos; own reconcile screen will match with a click.</li>
          </ol>
        </details>
      </div>

      {changed.length > 0 && (
        <>
          <h2>Changed after sending to QuickBooks</h2>
          <div className="card">
            <p className="small">These were edited here after they went to QuickBooks. QuickBooks still has the old version: make the same change there, then mark it fixed.</p>
            <table className="data">
              <thead><tr><th>Date</th><th>Transaction</th><th className="num">Amount</th><th>Now</th><th></th></tr></thead>
              <tbody>
                {changed.map((t) => (
                  <tr key={t.id}>
                    <td className="small">{fmtDate(t.date)}</td>
                    <td><Link href={`/txn/${t.id}`}>{t.payee || t.vendor || t.description}</Link></td>
                    <td className="num">{usd(t.amount, { cents: true })}</td>
                    <td className="small">{t.account?.qbName ?? t.account?.name ?? (t.kind === "transfer" ? "Transfer" : "Split")}</td>
                    <td>
                      <form action="/api/qb" method="post" className="inline">
                        <input type="hidden" name="action" value="fixed" />
                        <input type="hidden" name="entityId" value={entity.id} />
                        <input type="hidden" name="txnId" value={t.id} />
                        <button className="btn small secondary" type="submit">Fixed in QuickBooks</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {batches.length > 0 && (
        <>
          <h2>Files sent</h2>
          <table className="data">
            <thead><tr><th>Made</th><th>Through</th><th className="num">Transactions</th><th className="num">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="small">{fmtDate(b.createdAt)}</td>
                  <td className="small">{fmtDate(b.throughDate)}</td>
                  <td className="num">{b.txnCount}</td>
                  <td className="num">{usd(b.total, { cents: true })}</td>
                  <td>{b.status === "exported" ? <span className="badge green">sent</span> : <span className="badge">undone</span>}</td>
                  <td style={{ minWidth: 280 }}>
                    <a className="btn small secondary" href={`/api/qb/download?batch=${b.id}`}>Download again</a>
                    {b.status === "exported" && (
                      <details style={{ marginTop: 4 }}>
                        <summary className="xsmall">Undo this file…</summary>
                        <form action="/api/qb" method="post" style={{ marginTop: 4 }}>
                          <input type="hidden" name="action" value="undo" />
                          <input type="hidden" name="entityId" value={entity.id} />
                          <input type="hidden" name="batchId" value={b.id} />
                          <label className="xsmall"><input type="checkbox" name="confirm" /> I did <b>not</b> import this file into QuickBooks</label>{" "}
                          <button className="btn small danger" type="submit">Undo</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
