import { prisma } from "@/lib/db";
import { monthKey } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ClosePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const now = new Date();
  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKey(now);
  const [items, entities, reviewCount, flagCount] = await Promise.all([
    prisma.checklistItem.findMany({ where: { month }, orderBy: { sort: "asc" } }),
    prisma.entity.findMany({ orderBy: { sort: "asc" } }),
    prisma.transaction.count({ where: { categoryStatus: { in: ["uncategorized", "suggested"] } } }),
    prisma.anomalyFlag.count({ where: { status: "open" } }),
  ]);
  const done = items.filter((i) => i.done).length;

  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
  const ytdFrom = `${y}-01-01`;

  return (
    <div>
      <h1>Month-End Close &amp; CPA Package</h1>
      <p className="subtitle">Close the month with a checklist, then hand your CPA one organized bundle.</p>

      <form className="toolbar" method="get">
        <label className="small mut">Month:</label>
        <input type="month" name="month" defaultValue={month} />
        <button className="btn small secondary" type="submit">Switch</button>
      </form>

      {(reviewCount > 0 || flagCount > 0) && (
        <div className="callout warn">
          Before closing: <a href="/review">{reviewCount} transactions still need categories</a>
          {" · "}
          <a href="/flags">{flagCount} anomaly flags still open</a>
        </div>
      )}

      <h2>Close checklist — {month}</h2>
      <div className="card">
        {items.length === 0 ? (
          <form action="/api/checklist" method="post">
            <input type="hidden" name="action" value="init" />
            <input type="hidden" name="month" value={month} />
            <p className="small mut">No checklist for this month yet.</p>
            <button className="btn" type="submit">Create the standard checklist</button>
          </form>
        ) : (
          <>
            <div className="progressbar" style={{ marginBottom: 12 }}>
              <div style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
            </div>
            <div className="small mut" style={{ marginBottom: 10 }}>{done} of {items.length} complete</div>
            {items.map((i) => (
              <form key={i.id} action="/api/checklist" method="post" style={{ margin: "6px 0" }}>
                <input type="hidden" name="action" value="toggle" />
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="month" value={month} />
                <button
                  type="submit"
                  className="btn small secondary"
                  style={{ marginRight: 10, minWidth: 34 }}
                  aria-label={i.done ? "mark not done" : "mark done"}
                >
                  {i.done ? "✓" : "○"}
                </button>
                <span style={{ textDecoration: i.done ? "line-through" : "none", color: i.done ? "var(--muted)" : "inherit" }}>
                  {i.label}
                </span>
              </form>
            ))}
            <form action="/api/checklist" method="post" className="toolbar" style={{ marginTop: 14 }}>
              <input type="hidden" name="action" value="add" />
              <input type="hidden" name="month" value={month} />
              <input type="text" name="label" placeholder="Add your own step…" style={{ minWidth: 260 }} />
              <button className="btn small secondary" type="submit">Add</button>
            </form>
          </>
        )}
      </div>

      <h2>Tax-ready CPA package</h2>
      <p className="small mut">
        Everything your accountant needs for <b>{month}</b> (and year-to-date), one click each.
        Download the files into a folder and send the folder. For PDFs of the reports, open the
        report and print → Save as PDF.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Financial statements (combined group)</h3>
        <div className="toolbar" style={{ margin: "6px 0" }}>
          <a className="btn small secondary" href={`/api/reports/csv?type=pl&entity=all&from=${from}&to=${to}`}>P&amp;L — month (CSV)</a>
          <a className="btn small secondary" href={`/api/reports/csv?type=pl&entity=all&from=${ytdFrom}&to=${to}`}>P&amp;L — YTD (CSV)</a>
          <a className="btn small secondary" href={`/api/reports/csv?type=bs&entity=all&to=${to}`}>Balance Sheet (CSV)</a>
          <a className="btn small secondary" href={`/api/reports/csv?type=cf&entity=all&from=${ytdFrom}&to=${to}`}>Cash Flow — YTD (CSV)</a>
          <a className="btn small secondary" href={`/reports?type=pl&entity=all&from=${ytdFrom}&to=${to}`}>Printable reports →</a>
        </div>
        <h3>2. Per-entity P&amp;L (year-to-date CSVs)</h3>
        <div className="toolbar" style={{ margin: "6px 0", flexWrap: "wrap" }}>
          {entities.map((e) => (
            <a key={e.slug} className="btn small secondary" href={`/api/reports/csv?type=pl&entity=${e.slug}&from=${ytdFrom}&to=${to}`}>
              {e.name}
            </a>
          ))}
        </div>
        <h3>3. Categorized transaction ledger</h3>
        <div className="toolbar" style={{ margin: "6px 0" }}>
          <a className="btn small secondary" href={`/api/export/ledger?entity=all&from=${ytdFrom}&to=${to}`}>Full ledger — YTD (CSV)</a>
          <a className="btn small secondary" href={`/api/export/ledger?entity=all&from=${from}&to=${to}`}>Ledger — month only (CSV)</a>
        </div>
        <h3>4. Flagged items needing judgment</h3>
        <div className="toolbar" style={{ margin: "6px 0" }}>
          <a className="btn small secondary" href="/api/export/flags">Open flags (CSV)</a>
        </div>
        <h3>5. Receipt register (documentation)</h3>
        <div className="toolbar" style={{ margin: "6px 0" }}>
          <a className="btn small secondary" href="/api/export/receipts">Receipts with match status (CSV)</a>
        </div>
        <h3>6. Tax strategy briefing</h3>
        <div className="toolbar" style={{ margin: "6px 0" }}>
          <a className="btn small secondary" href="/plan/briefing">CPA briefing (print to PDF) →</a>
        </div>
      </div>

      <p className="disclaimer">
        Estimate only. Reports are cash-basis from locally synced books; your CPA remains the
        authority on filings.
      </p>
    </div>
  );
}
