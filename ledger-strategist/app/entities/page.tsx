import { prisma } from "@/lib/db";
import { qboConfigured } from "@/lib/qbo";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const entities = await prisma.entity.findMany({
    orderBy: { sort: "asc" },
    include: { connection: true, _count: { select: { transactions: true, accounts: true } } },
  });
  const configured = qboConfigured();
  const sandbox = (process.env.QBO_ENVIRONMENT ?? "sandbox") !== "production";

  return (
    <div>
      <h1>Entities &amp; QuickBooks</h1>
      <p className="subtitle">
        Your eight entities. Each can be connected to its own QuickBooks Online company file.
      </p>

      {params.error === "not_configured" && (
        <div className="callout warn">
          QuickBooks keys aren&apos;t set up yet. Open your <code>.env</code> file and fill in{" "}
          <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code> (see the README for the
          step-by-step), then restart the app.
        </div>
      )}
      {params.error && params.error !== "not_configured" && (
        <div className="callout bad">Something went wrong: {params.error}</div>
      )}
      {params.connected && (
        <div className="callout">
          Connected <b>{params.connected}</b> to QuickBooks. Click <b>Sync now</b> to pull its books.
        </div>
      )}
      {params.synced && (
        <div className="callout">
          Synced <b>{params.synced}</b>: {params.accounts} accounts, {params.txns} transactions pulled.
        </div>
      )}
      {params.demoCleared && (
        <div className="callout">
          Removed {params.demoCleared} demo transactions ({params.scope === "all" ? "all entities" : params.scope}).
          Real synced data was not touched.
        </div>
      )}

      <div className="callout">
        {configured ? (
          <>QuickBooks keys are configured. Mode: <b>{sandbox ? "Sandbox (safe test data)" : "Production (real books)"}</b>.</>
        ) : (
          <>Currently running on <b>demo books</b> — realistic sample data so every screen works.
          Connect QuickBooks whenever you&apos;re ready (instructions in the README).</>
        )}
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Type</th>
            <th>Books</th>
            <th>QuickBooks</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.id}>
              <td>
                <b>{e.name}</b>
                <div className="xsmall mut">{e.notes}</div>
              </td>
              <td><span className="badge">{e.kind.replace("_", " ")}</span></td>
              <td className="small">
                {e._count.transactions.toLocaleString()} transactions
                <div className="xsmall mut">{e._count.accounts} accounts</div>
              </td>
              <td>
                {e.connection ? (
                  <>
                    <span className="badge green">Connected</span>
                    <div className="xsmall mut">
                      {e.connection.sandbox ? "sandbox" : "production"} ·{" "}
                      {e.connection.lastSyncedAt
                        ? `last sync ${fmtDate(e.connection.lastSyncedAt)}`
                        : "never synced"}
                    </div>
                  </>
                ) : (
                  <span className="badge">Demo data</span>
                )}
              </td>
              <td>
                {e.connection ? (
                  <form className="inline" action={`/api/qbo/sync?entity=${e.slug}`} method="post">
                    <button className="btn small" type="submit">Sync now</button>
                  </form>
                ) : (
                  <a className="btn small secondary" href={`/api/qbo/connect?entity=${e.slug}`}>
                    Connect QuickBooks
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Going live</h2>
      <div className="card">
        <p className="small">
          Entities start with <b>demo books</b> so you can explore. When you connect an entity to
          QuickBooks, its demo data is replaced automatically on first sync. For entities that
          won&apos;t be connected (or when you&apos;re ready to run fully real), clear the remaining demo
          data so combined reports and strategy estimates only reflect reality.
        </p>
        <form className="toolbar" action="/api/entities/clear-demo" method="post" style={{ marginBottom: 0 }}>
          <select name="entity" defaultValue="all">
            <option value="all">All entities</option>
            {entities.map((e) => (
              <option key={e.slug} value={e.slug}>{e.name}</option>
            ))}
          </select>
          <button className="btn danger" type="submit">Clear demo data</button>
          <span className="xsmall mut">
            Removes demo transactions only — QuickBooks data, mileage, receipts, and your settings
            are never touched. To get demo data back: <code>npm run seed</code>.
          </span>
        </form>
      </div>

      <p className="disclaimer">
        This app only reads from QuickBooks — it never writes back, so it can never change your
        books. Tokens are encrypted before being stored on this computer.
      </p>
    </div>
  );
}
