import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { Flash, KIND_LABELS, ymd } from "@/app/components/ui";

export const dynamic = "force-dynamic";

function KindSelect({ value }: { value?: string }) {
  return (
    <select name="kind" defaultValue={value ?? "operating"}>
      {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  );
}

export default async function EntitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const entities = await prisma.entity.findMany({
    orderBy: [{ status: "asc" }, { sort: "asc" }],
    include: { _count: { select: { transactions: true, accounts: true } } },
  });
  const realCounts = new Map(
    (await prisma.transaction.groupBy({ by: ["entityId"], where: { origin: { not: "demo" } }, _count: true })).map((g) => [g.entityId, g._count])
  );
  const qbCounts = new Map(
    (await prisma.account.groupBy({ by: ["entityId"], where: { fromQb: true }, _count: true })).map((g) => [g.entityId, g._count])
  );
  const active = entities.filter((e) => e.status === "active");
  const sold = entities.filter((e) => e.status !== "active");
  const editing = params.edit ? entities.find((e) => e.id === params.edit) : undefined;

  return (
    <div>
      <h1>Entities</h1>
      <p className="subtitle">
        Every business and LLC you keep books for. Add one when you buy it; mark it sold when you sell it.
        A sold entity keeps its full history for taxes and reports but drops off the daily bookkeeping screens.
      </p>
      <Flash params={params} />

      <table className="data">
        <thead>
          <tr><th>Entity</th><th>Type</th><th>Books</th><th>QuickBooks 2016</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {active.map((e) => {
            const real = realCounts.get(e.id) ?? 0;
            const qb = qbCounts.get(e.id) ?? 0;
            return (
              <tr key={e.id}>
                <td>
                  <b>{e.name}</b>
                  <div className="xsmall mut">{[e.notes, e.acquiredOn ? `owned since ${fmtDate(e.acquiredOn)}` : null].filter(Boolean).join(" · ")}</div>
                </td>
                <td><span className="badge">{KIND_LABELS[e.kind] ?? e.kind}</span></td>
                <td className="small">
                  {real.toLocaleString()} real transactions
                  {e._count.transactions - real > 0 && <div className="xsmall mut">+ {(e._count.transactions - real).toLocaleString()} demo</div>}
                </td>
                <td className="small">
                  {qb > 0 ? <span className="badge green">{qb} accounts linked</span> : <Link href={`/quickbooks?entity=${e.slug}`} className="badge amber">Not set up yet</Link>}
                </td>
                <td style={{ minWidth: 260 }}>
                  <Link className="btn small secondary" href={`/entities?edit=${e.id}#edit`}>Edit</Link>{" "}
                  <Link className="btn small secondary" href={`/quickbooks?entity=${e.slug}`}>QuickBooks setup</Link>
                  <details style={{ marginTop: 6 }}>
                    <summary className="small">Mark as sold…</summary>
                    <form action="/api/entities/manage" method="post" className="toolbar" style={{ margin: "6px 0" }}>
                      <input type="hidden" name="action" value="sell" />
                      <input type="hidden" name="entityId" value={e.id} />
                      <label className="small">Sale date <input type="date" name="soldOn" required /></label>
                      <button className="btn small danger" type="submit">Mark sold</button>
                    </form>
                    <div className="xsmall mut">History is kept. You can still view reports, export leftover transactions, and undo this later.</div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 id="add">Add an entity you bought or started</h2>
      <form className="card" action="/api/entities/manage" method="post">
        <input type="hidden" name="action" value="create" />
        <div className="cardgrid">
          <label className="field"><span className="fieldname">Name (as it should appear on reports)</span><input type="text" name="name" required placeholder="e.g. SandCastle 6 LLC" style={{ width: "100%" }} /></label>
          <label className="field"><span className="fieldname">Type</span><KindSelect /></label>
          <label className="field"><span className="fieldname">Date acquired / started</span><input type="date" name="acquiredOn" /></label>
          <label className="field"><span className="fieldname">Notes (optional)</span><input type="text" name="notes" placeholder="What it is, who manages it" style={{ width: "100%" }} /></label>
        </div>
        <button className="btn" type="submit">Add entity</button>
        <span className="small mut"> Then on QuickBooks Setup: load its chart of accounts and set the bank/card starting balances.</span>
      </form>

      {editing && (
        <>
          <h2 id="edit">Edit {editing.name}</h2>
          <form className="card" action="/api/entities/manage" method="post">
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="entityId" value={editing.id} />
            <div className="cardgrid">
              <label className="field"><span className="fieldname">Name</span><input type="text" name="name" defaultValue={editing.name} required style={{ width: "100%" }} /></label>
              <label className="field"><span className="fieldname">Type</span><KindSelect value={editing.kind} /></label>
              <label className="field"><span className="fieldname">Date acquired / started</span><input type="date" name="acquiredOn" defaultValue={ymd(editing.acquiredOn)} /></label>
              <label className="field"><span className="fieldname">Notes</span><input type="text" name="notes" defaultValue={editing.notes ?? ""} style={{ width: "100%" }} /></label>
            </div>
            <button className="btn" type="submit">Save</button>{" "}
            <Link className="btn secondary" href="/entities">Cancel</Link>
          </form>
        </>
      )}

      {sold.length > 0 && (
        <>
          <h2>Sold or closed</h2>
          <table className="data">
            <thead><tr><th>Entity</th><th>Owned</th><th>Books kept</th><th>Actions</th></tr></thead>
            <tbody>
              {sold.map((e) => {
                const real = realCounts.get(e.id) ?? 0;
                return (
                  <tr key={e.id}>
                    <td><b>{e.name}</b> <span className="badge">sold</span><div className="xsmall mut">{e.notes}</div></td>
                    <td className="small">{e.acquiredOn ? fmtDate(e.acquiredOn) : "?"} to {e.soldOn ? fmtDate(e.soldOn) : "?"}</td>
                    <td className="small">{real.toLocaleString()} transactions <div className="xsmall"><Link href={`/reports?entity=${e.slug}`}>View reports</Link></div></td>
                    <td style={{ minWidth: 260 }}>
                      <form className="inline" action="/api/entities/manage" method="post">
                        <input type="hidden" name="action" value="reactivate" />
                        <input type="hidden" name="entityId" value={e.id} />
                        <button className="btn small secondary" type="submit">Make active again</button>
                      </form>
                      {real === 0 && (
                        <details style={{ marginTop: 6 }}>
                          <summary className="small">Delete permanently…</summary>
                          <form action="/api/entities/manage" method="post" className="toolbar" style={{ margin: "6px 0" }}>
                            <input type="hidden" name="action" value="delete" />
                            <input type="hidden" name="entityId" value={e.id} />
                            <input type="text" name="confirm" placeholder={`Type: ${e.name}`} />
                            <button className="btn small danger" type="submit">Delete</button>
                          </form>
                          <div className="xsmall mut">Only possible because it has no real transactions.</div>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h2>Backup</h2>
      <div className="card small">
        All of the bookkeeping in this app lives in one file on this computer. Download a backup at least once a week
        (and before any big change) and keep it somewhere safe, like a USB drive or cloud folder.{" "}
        <a className="btn small" href="/api/backup">Download backup now</a>
      </div>

      <h2>Demo data</h2>
      <div className="card">
        <p className="small">
          The app ships with practice books so every screen has something to show. Clear them before
          going live so reports only show real numbers. Real imports, QuickBooks lists, payroll, and
          reconciliations are never touched by this button.
        </p>
        <form className="toolbar" action="/api/entities/clear-demo" method="post" style={{ marginBottom: 0 }}>
          <select name="entity" defaultValue="all">
            <option value="all">All entities</option>
            {entities.map((e) => <option key={e.slug} value={e.slug}>{e.name}</option>)}
          </select>
          <button className="btn danger" type="submit">Clear demo data</button>
        </form>
      </div>
    </div>
  );
}
