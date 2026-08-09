import { prisma } from "@/lib/db";
import { summarizeTrips } from "@/lib/mileage";
import { ASSUMPTIONS } from "@/lib/assumptions";
import { usd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ERROR_TEXT: Record<string, string> = {
  bad_url: "That doesn't look like a Google 'Publish to web' link — it should start with https://docs.google.com/…",
  no_url: "No sheet link saved yet — paste your published-CSV link below first.",
  not_published: "Google sent back a webpage instead of data. In your mileage Sheet: File → Share → Publish to web → choose the sheet and CSV → Publish, then copy that link here.",
  no_file: "No file was chosen.",
};

export default async function MileagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const [trips, urlSetting, entities] = await Promise.all([
    prisma.mileageTrip.findMany({ orderBy: { date: "desc" } }),
    prisma.setting.findUnique({ where: { key: "mileageSheetCsvUrl" } }),
    prisma.entity.findMany({ orderBy: { sort: "asc" } }),
  ]);
  const entityName = new Map(entities.map((e) => [e.slug, e.name]));
  const summary = summarizeTrips(trips, new Date(), ASSUMPTIONS.mileage_rate.value);
  const recentTrips = trips.slice(0, 15);
  const receiptCount = trips.filter((t) => t.receiptPhoto).length;

  return (
    <div>
      <h1>Mileage &amp; Vehicles</h1>
      <p className="subtitle">
        Live feed from your Mileage Log phone app. Real logged miles replace estimates in the tax
        strategy engine — trip categories map straight onto your entities.
      </p>

      {params.saved && <div className="callout">Sheet link saved. Click <b>Sync from Google Sheet</b> to pull your trips.</div>}
      {params.synced !== undefined && (
        <div className="callout">
          Imported/updated {params.synced} trips{Number(params.skipped) > 0 ? ` (${params.skipped} rows skipped — in-progress, voided, or missing miles)` : ""}.
          Re-run the analysis on the <a href="/plan">Action Plan</a> to use them.
        </div>
      )}
      {params.error && <div className="callout bad">{ERROR_TEXT[params.error] ?? `Something went wrong: ${params.error}`}</div>}

      {trips.length > 0 ? (
        <>
          <div className="statgrid">
            <div className="stat"><div className="label">Business miles (last 12 months)</div><div className="value">{summary.businessMiles12.toLocaleString()}</div></div>
            <div className="stat"><div className="label">Logged deduction (at dated IRS rates)</div><div className="value pos">{usd(summary.loggedDeduction12)}</div></div>
            <div className="stat"><div className="label">Business trips logged</div><div className="value">{summary.tripCount12.toLocaleString()}</div></div>
            <div className="stat"><div className="label">Fuel receipts captured</div><div className="value">{usd(summary.fuelTotal12)}</div></div>
          </div>
          <p className="xsmall mut">
            Last trip {summary.lastTripDate ? fmtDate(summary.lastTripDate) : "—"} · {receiptCount} receipt photos on file in your Google Drive ·
            personal miles tracked: {summary.personalMiles12.toLocaleString()}
          </p>

          <h2>Business miles by entity (last 12 months)</h2>
          <table className="data">
            <thead><tr><th>Entity</th><th className="num">Miles</th><th className="num">Share</th></tr></thead>
            <tbody>
              {Object.entries(summary.byEntity).sort((a, b) => b[1] - a[1]).map(([slug, miles]) => (
                <tr key={slug}>
                  <td>{slug === "misc" ? "Misc. Business (no single entity)" : entityName.get(slug) ?? slug}</td>
                  <td className="num">{miles.toLocaleString()}</td>
                  <td className="num">{summary.businessMiles12 ? Math.round((miles / summary.businessMiles12) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          {Object.keys(summary.byVehicle).length > 0 && (
            <>
              <h2>By vehicle</h2>
              <table className="data">
                <thead><tr><th>Vehicle</th><th className="num">Business miles (12 mo)</th></tr></thead>
                <tbody>
                  {Object.entries(summary.byVehicle).sort((a, b) => b[1] - a[1]).map(([v, m]) => (
                    <tr key={v}><td>{v}</td><td className="num">{m.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2>Recent trips</h2>
          <table className="data">
            <thead><tr><th>Date</th><th>Category</th><th>Purpose</th><th>Driver</th><th className="num">Miles</th><th className="num">Deduction</th><th>Receipt</th></tr></thead>
            <tbody>
              {recentTrips.map((t) => (
                <tr key={t.id}>
                  <td className="small">{fmtDate(t.date)}</td>
                  <td className="small">{t.category}</td>
                  <td className="small">{t.businessPurpose ?? t.notes ?? ""}</td>
                  <td className="small">{t.driver ?? ""}</td>
                  <td className="num">{t.miles.toLocaleString()}</td>
                  <td className="num">{t.deduction != null ? usd(t.deduction, { cents: true }) : "—"}</td>
                  <td className="small">{t.receiptPhoto ? <a href={t.receiptPhoto} target="_blank">view</a> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="callout warn">
          No trips imported yet. Connect your mileage Sheet below (2 minutes, once) or upload a CSV
          from the mileage app&apos;s <b>Download CSV</b> button.
        </div>
      )}

      <h2>Connect your mileage Sheet (once)</h2>
      <div className="card">
        <ol className="small">
          <li>Open your mileage Google Sheet (the one the phone app syncs into).</li>
          <li>Menu: <b>File → Share → Publish to web</b>.</li>
          <li>In the dialog, pick the mileage tab, change &quot;Web page&quot; to <b>Comma-separated values (.csv)</b>, click <b>Publish</b>, and copy the link.</li>
          <li>Paste it here and save.</li>
        </ol>
        <p className="xsmall mut">
          Privacy note: &quot;Publish to web&quot; makes that one sheet readable by anyone who has this exact
          (unguessable) link. If you&apos;d rather not, skip it and use the CSV upload below instead.
        </p>
        <form className="toolbar" action="/api/mileage" method="post">
          <input type="hidden" name="action" value="saveUrl" />
          <input type="text" name="url" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" style={{ minWidth: 380 }} defaultValue={urlSetting?.value ?? ""} />
          <button className="btn small secondary" type="submit">Save link</button>
        </form>
        <form className="toolbar" action="/api/mileage" method="post" style={{ marginTop: 4 }}>
          <input type="hidden" name="action" value="sync" />
          <button className="btn" type="submit" disabled={!urlSetting?.value}>Sync from Google Sheet</button>
          {urlSetting?.value ? <span className="small mut">Pulls the latest trips; safe to click any time.</span> : <span className="small mut">Save the link first.</span>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Or upload a CSV export</h3>
        <p className="small mut">In the mileage app: Export → <b>Download CSV</b>, then choose that file here.</p>
        <form className="toolbar" action="/api/mileage" method="post" encType="multipart/form-data">
          <input type="hidden" name="action" value="upload" />
          <input type="file" name="file" accept=".csv,text/csv" />
          <button className="btn small" type="submit">Import file</button>
        </form>
      </div>

      <p className="disclaimer">
        Mileage data stays on this computer. The IRS rate used for each trip is the one your
        mileage app logged for that date — the strategy engine uses your actual logged deduction.
      </p>
    </div>
  );
}
