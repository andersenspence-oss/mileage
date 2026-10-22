import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, fmtDate } from "@/lib/format";
import { previewImport } from "@/lib/bookkeeping";
import { Flash } from "@/app/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "new", cls: "green" },
  match: { label: "matches entry", cls: "blue" },
  duplicate: { label: "already imported", cls: "" },
  before_go_live: { label: "history (already in QB)", cls: "amber" },
};

export default async function ImportPreview({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) return <div><h1>Import</h1><p>That upload is gone. <Link href="/import">Start again</Link>.</p></div>;
  const reg = await prisma.account.findUniqueOrThrow({ where: { id: batch.registerAccountId }, include: { entity: true } });
  if (batch.status !== "preview") {
    return <div><h1>Import</h1><p>This file was already {batch.status}. <Link href="/import">Import another</Link> or <Link href={`/register/${reg.id}`}>open the register</Link>.</p></div>;
  }
  const pv = await previewImport(id);
  const m = pv.mapping;
  const colOptions = (_selected: number | null, allowNone: boolean) => (
    <>
      {allowNone && <option value="">(none)</option>}
      {pv.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </>
  );
  const willImport = pv.counts.new + pv.counts.match + pv.counts.beforeGoLive;
  const ins = pv.rows.filter((r) => r.status !== "duplicate" && r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outs = pv.rows.filter((r) => r.status !== "duplicate" && r.amount < 0).reduce((s, r) => s - r.amount, 0);

  return (
    <div>
      <h1>Check the download before importing</h1>
      <p className="subtitle">
        <b>{reg.entity.name}: {reg.name}</b> from <i>{batch.fileName}</i>. Make sure the dates and amounts below look right
        (money in shows green). If a column is wrong, fix it and click Update preview. The app remembers these settings for this account.
      </p>
      <Flash params={sp} />

      <form action="/api/import" method="post">
        <input type="hidden" name="batchId" value={batch.id} />
        <input type="hidden" name="headerRow" value={m.headerRow} />
        <input type="hidden" name="returnTo" value={`/import/${batch.id}`} />
        <div className="card">
          <div className="cardgrid">
            <label className="field"><span className="fieldname">Date column</span>
              <select name="dateCol" defaultValue={m.dateCol}>{colOptions(m.dateCol, false)}</select></label>
            <label className="field"><span className="fieldname">Date style</span>
              <select name="dateOrder" defaultValue={m.dateOrder}>
                <option value="mdy">Month/Day/Year (US)</option><option value="ymd">Year-Month-Day</option><option value="dmy">Day/Month/Year</option>
              </select></label>
            <label className="field"><span className="fieldname">Description column</span>
              <select name="descCol" defaultValue={m.descCol}>{colOptions(m.descCol, false)}</select></label>
            <label className="field"><span className="fieldname">Check number column</span>
              <select name="checkCol" defaultValue={m.checkCol ?? ""}>{colOptions(m.checkCol, true)}</select></label>
          </div>
          <div className="cardgrid">
            <label className="field"><span className="fieldname">Amounts are in…</span>
              <select name="amountMode" defaultValue={m.amountCol !== null ? "single" : "split"}>
                <option value="single">one Amount column (+ and −)</option>
                <option value="split">separate money-out and money-in columns</option>
              </select></label>
            <label className="field"><span className="fieldname">Amount column</span>
              <select name="amountCol" defaultValue={m.amountCol ?? ""}>{colOptions(m.amountCol, true)}</select></label>
            <label className="field"><span className="fieldname">Money-out column (debits / charges)</span>
              <select name="debitCol" defaultValue={m.debitCol ?? ""}>{colOptions(m.debitCol, true)}</select></label>
            <label className="field"><span className="fieldname">Money-in column (credits / deposits)</span>
              <select name="creditCol" defaultValue={m.creditCol ?? ""}>{colOptions(m.creditCol, true)}</select></label>
          </div>
          <label className="small"><input type="checkbox" name="flipSign" defaultChecked={m.flipSign} /> Flip + and − (use if purchases show as money in)</label>
          <input type="hidden" name="memoCol" value={m.memoCol ?? ""} />
          <div className="toolbar">
            <button className="btn secondary" type="submit" name="action" value="remap">Update preview</button>
          </div>
        </div>

        <div className="statgrid">
          <div className="stat"><div className="label">New</div><div className="value">{pv.counts.new}</div></div>
          <div className="stat"><div className="label">Matches entries already in books</div><div className="value">{pv.counts.match}</div></div>
          <div className="stat"><div className="label">Already imported (skipped)</div><div className="value mut">{pv.counts.duplicate}</div></div>
          {pv.counts.beforeGoLive > 0 && <div className="stat"><div className="label">Before go-live (history only)</div><div className="value">{pv.counts.beforeGoLive}</div></div>}
          <div className="stat"><div className="label">Money in / out</div><div className="value small"><span className="pos">{usd(ins, { cents: true })}</span> / {usd(outs, { cents: true })}</div></div>
        </div>

        {pv.errors.length > 0 && (
          <div className="callout warn small">
            <b>{pv.errors.length === 1 ? "1 line" : `${pv.errors.length} lines`} couldn&apos;t be read</b> and won&apos;t be imported. If these are real transactions, check the column choices above:
            <ul>{pv.errors.slice(0, 8).map((e) => <li key={e.line}>Line {e.line}: {e.problem} <span className="mut">({e.raw.slice(0, 90)})</span></li>)}</ul>
          </div>
        )}

        <div className="toolbar">
          <button className="btn" type="submit" name="action" value="commit" disabled={willImport === 0}>
            Import {pv.counts.new + pv.counts.beforeGoLive} new{pv.counts.match ? ` and match ${pv.counts.match}` : ""}
          </button>
          <button className="btn danger" type="submit" name="action" value="discard">Discard</button>
        </div>
      </form>

      <table className="data">
        <thead><tr><th>Line</th><th>Date</th><th>Description</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {pv.rows.slice(0, 400).map((r, i) => (
            <tr key={i} style={r.status === "duplicate" ? { opacity: 0.5 } : undefined}>
              <td className="xsmall mut">{r.line}</td>
              <td className="small">{fmtDate(r.date)}</td>
              <td className="small">{r.description}{r.checkNum ? <span className="mut"> · check {r.checkNum}</span> : null}</td>
              <td className={`num ${r.amount > 0 ? "pos" : ""}`}>{r.amount > 0 ? "+" : "−"}{usd(Math.abs(r.amount), { cents: true })}</td>
              <td><span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>{r.matchNote && <div className="xsmall mut">{r.matchNote}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pv.rows.length > 400 && <p className="small mut">Showing the first 400 of {pv.rows.length} lines; all will be imported.</p>}
    </div>
  );
}
