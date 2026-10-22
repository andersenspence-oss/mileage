import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { registers } from "@/lib/bookkeeping";
import { Flash } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const regs = (await registers()).filter((r) => r.entity.status === "active");
  const recent = await prisma.importBatch.findMany({ where: { status: "imported" }, orderBy: { createdAt: "desc" }, take: 15 });
  const regById = new Map(regs.map((r) => [r.id, r]));
  const lastByReg = new Map<string, Date>();
  for (const b of recent) if (!lastByReg.has(b.registerAccountId)) lastByReg.set(b.registerAccountId, b.createdAt);

  return (
    <div>
      <h1>Import bank &amp; card downloads</h1>
      <p className="subtitle">
        Download transactions from the bank or card website as a <b>CSV</b> file and drop it here. Overlapping
        date ranges are fine: anything already imported is skipped automatically, and checks or payroll you
        already entered by hand are matched instead of doubled.
      </p>
      <Flash params={params} />

      {regs.length === 0 ? (
        <div className="callout warn">
          No bank or card accounts yet. Load each entity&apos;s chart of accounts on the{" "}
          <Link href="/quickbooks">QuickBooks 2016</Link> page first.
        </div>
      ) : (
        <form className="card" action="/api/import" method="post" encType="multipart/form-data">
          <input type="hidden" name="action" value="upload" />
          <label className="field">
            <span className="fieldname">Which account is this download from?</span>
            <select name="registerId" required defaultValue={params.account ?? ""}>
              <option value="" disabled>Choose…</option>
              {regs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.entity.name}: {r.name}{r.last4 ? ` (…${r.last4})` : ""}{r.type === "credit_card" ? " (card)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field"><span className="fieldname">CSV file</span><input type="file" name="file" accept=".csv,.CSV,.txt" required /></label>
          <button className="btn" type="submit">Upload and preview</button>
          <span className="small mut"> Nothing is saved until you confirm on the next screen.</span>
        </form>
      )}

      <h2>Where to find the download</h2>
      <div className="card small">
        Most bank and card sites: open the account, look for <b>Download</b>, <b>Export</b>, or a download icon above the
        transaction list, pick a date range (a little overlap with last time is fine), and choose <b>CSV</b> or
        <b> Comma Separated</b>. Avoid QFX/QBO/Quicken formats; those are for programs other than this one.
      </div>

      <h2>Accounts</h2>
      <table className="data">
        <thead><tr><th>Entity</th><th>Account</th><th>Last import</th><th></th></tr></thead>
        <tbody>
          {regs.map((r) => (
            <tr key={r.id}>
              <td className="small">{r.entity.name}</td>
              <td><b>{r.name}</b>{!r.startDate && <div className="xsmall warn">No go-live date yet (set it on QuickBooks 2016 page)</div>}</td>
              <td className="small">{lastByReg.get(r.id) ? fmtDate(lastByReg.get(r.id)!) : <span className="mut">never</span>}</td>
              <td><Link className="btn small secondary" href={`/register/${r.id}`}>Open register</Link></td>
            </tr>
          ))}
        </tbody>
      </table>

      {recent.length > 0 && (
        <>
          <h2>Recent imports</h2>
          <table className="data">
            <thead><tr><th>When</th><th>Account</th><th>File</th><th className="num">Added</th><th className="num">Matched</th><th className="num">Skipped (already in)</th></tr></thead>
            <tbody>
              {recent.map((b) => (
                <tr key={b.id}>
                  <td className="small">{fmtDate(b.createdAt)}</td>
                  <td className="small">{regById.get(b.registerAccountId)?.entity.name}: {regById.get(b.registerAccountId)?.name ?? "?"}</td>
                  <td className="small">{b.fileName}</td>
                  <td className="num">{b.added}</td><td className="num">{b.matched}</td><td className="num">{b.duplicates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
