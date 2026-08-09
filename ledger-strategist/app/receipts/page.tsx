import { prisma } from "@/lib/db";
import { documentationCoverage } from "@/lib/receipts";
import { claudeAvailable } from "@/lib/claude";
import { usd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ERROR_TEXT: Record<string, string> = {
  no_file: "No file was chosen.",
  too_big: "That image is over 15 MB — take a smaller photo and try again.",
  bad_type: "Use a photo file (jpg, png, webp, gif).",
};

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const [receipts, txnsRaw] = await Promise.all([
    prisma.receipt.findMany({ where: { status: { not: "dismissed" } }, orderBy: { date: "desc" }, take: 200 }),
    prisma.transaction.findMany({
      where: { flow: "out" },
      select: { id: true, date: true, amount: true, vendor: true, flow: true, entity: { select: { name: true } }, account: { select: { name: true } } },
    }),
  ]);
  const txnById = new Map(txnsRaw.map((t) => [t.id, t]));
  const matchedIds = new Set(receipts.filter((r) => r.status === "matched" && r.matchedTransactionId).map((r) => r.matchedTransactionId!));
  const coverage = documentationCoverage(
    txnsRaw.map((t) => ({ id: t.id, accountName: t.account?.name ?? null, amount: t.amount, flow: t.flow })),
    matchedIds
  );
  const suggested = receipts.filter((r) => r.status === "suggested");
  const unmatched = receipts.filter((r) => r.status === "unmatched");
  const matched = receipts.filter((r) => r.status === "matched");

  const ReceiptRow = ({ r, showActions }: { r: (typeof receipts)[number]; showActions: "suggested" | "unmatched" | "matched" }) => {
    const txn = r.matchedTransactionId ? txnById.get(r.matchedTransactionId) : null;
    return (
      <tr>
        <td className="small">{fmtDate(r.date)}</td>
        <td>
          <b>{r.vendor ?? "Unknown"}</b>
          <div className="xsmall mut">
            {r.source === "mileage_app" ? "from mileage app" : r.source}
            {r.note ? ` · ${r.note}` : ""}
          </div>
        </td>
        <td className="num">{r.amount > 0 ? usd(r.amount, { cents: true }) : <span className="warn">needs amount</span>}</td>
        <td className="small">
          {r.imageUrl && <a href={r.imageUrl} target="_blank">photo (Drive)</a>}
          {r.filePath && <a href={`/api/receipts?image=${r.id}`} target="_blank">photo</a>}
        </td>
        <td className="small">
          {txn ? (
            <>
              {txn.vendor ?? "?"} · {usd(txn.amount, { cents: true })} · {fmtDate(txn.date)}
              <div className="xsmall mut">{txn.entity.name} · {txn.account?.name ?? "uncategorized"}</div>
            </>
          ) : (
            <span className="mut">—</span>
          )}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {showActions === "suggested" && (
            <>
              <form className="inline" action="/api/receipts" method="post">
                <input type="hidden" name="action" value="confirm" /><input type="hidden" name="id" value={r.id} />
                <button className="btn small" type="submit">Confirm match</button>
              </form>{" "}
              <form className="inline" action="/api/receipts" method="post">
                <input type="hidden" name="action" value="unmatch" /><input type="hidden" name="id" value={r.id} />
                <button className="btn small secondary" type="submit">Wrong</button>
              </form>
            </>
          )}
          {showActions === "matched" && (
            <form className="inline" action="/api/receipts" method="post">
              <input type="hidden" name="action" value="unmatch" /><input type="hidden" name="id" value={r.id} />
              <button className="btn small secondary" type="submit">Unmatch</button>
            </form>
          )}
          {showActions === "unmatched" && (
            <>
              <details className="expand" style={{ display: "inline-block", margin: 0 }}>
                <summary className="small">Edit</summary>
                <div className="inner">
                  <form action="/api/receipts" method="post" className="toolbar" style={{ margin: 0 }}>
                    <input type="hidden" name="action" value="edit" /><input type="hidden" name="id" value={r.id} />
                    <input type="date" name="date" defaultValue={r.date.toISOString().slice(0, 10)} />
                    <input type="text" name="vendor" placeholder="Vendor" defaultValue={r.vendor ?? ""} style={{ width: 130 }} />
                    <input type="number" step="0.01" name="amount" placeholder="Amount" defaultValue={r.amount || ""} style={{ width: 100 }} />
                    <button className="btn small secondary" type="submit">Save</button>
                  </form>
                </div>
              </details>{" "}
              <form className="inline" action="/api/receipts" method="post">
                <input type="hidden" name="action" value="dismiss" /><input type="hidden" name="id" value={r.id} />
                <button className="btn small danger" type="submit">Dismiss</button>
              </form>
            </>
          )}
        </td>
      </tr>
    );
  };

  const Table = ({ rows, mode }: { rows: typeof receipts; mode: "suggested" | "unmatched" | "matched" }) => (
    <table className="data">
      <thead><tr><th>Date</th><th>Receipt</th><th className="num">Amount</th><th>Photo</th><th>Matched transaction</th><th>Actions</th></tr></thead>
      <tbody>{rows.map((r) => (<ReceiptRow key={r.id} r={r} showActions={mode} />))}</tbody>
    </table>
  );

  return (
    <div>
      <h1>Receipts</h1>
      <p className="subtitle">
        Every receipt tied to the transaction it proves. Fuel receipts flow in from your mileage
        app automatically; snap or upload anything else and the AI reads it.
      </p>

      {params.uploaded && (
        <div className="callout">
          Receipt uploaded{params.read === "1" ? " and read by AI — check the details below" : ". AI couldn't read it (or no API key) — fill in the amount below"}.
        </div>
      )}
      {params.scanned && (
        <div className="callout">
          Matching done: {params.auto} matched automatically (exact matches only), {params.suggested} waiting for your confirmation.
        </div>
      )}
      {params.error && <div className="callout bad">{ERROR_TEXT[params.error] ?? `Something went wrong: ${params.error}`}</div>}

      <div className="statgrid">
        <div className="stat"><div className="label">Receipts on file</div><div className="value">{receipts.length}</div></div>
        <div className="stat"><div className="label">Matched to the books</div><div className="value pos">{matched.length}</div></div>
        <div className="stat"><div className="label">Awaiting review</div><div className="value">{suggested.length + unmatched.length}</div></div>
        <div className="stat">
          <div className="label">Documentation coverage*</div>
          <div className={`value ${coverage.coverage >= 0.7 ? "pos" : "warn"}`}>{Math.round(coverage.coverage * 100)}%</div>
          <div className="xsmall mut">{coverage.documentedCount} of {coverage.sensitiveCount} receipt-sensitive expenses ≥$75</div>
        </div>
      </div>
      <p className="xsmall mut">
        *Share of meals, travel, fuel, supplies &amp; equipment expenses of $75+ in the books that have a matched receipt —
        the categories the IRS most expects documentation for.
      </p>

      <div className="toolbar">
        <form className="inline" action="/api/receipts" method="post" encType="multipart/form-data">
          <input type="hidden" name="action" value="upload" />
          <input type="file" name="file" accept="image/*" />{" "}
          <button className="btn" type="submit">Upload receipt photo</button>
        </form>
        <form className="inline" action="/api/receipts" method="post">
          <input type="hidden" name="action" value="match_scan" />
          <button className="btn secondary" type="submit">Match receipts to transactions</button>
        </form>
        <span className="small mut">{claudeAvailable() ? "AI reads vendor, date, and total off the photo." : "Add ANTHROPIC_API_KEY to .env and uploads get read automatically."}</span>
      </div>

      {suggested.length > 0 && (<><h2>Suggested matches — confirm these ({suggested.length})</h2><Table rows={suggested} mode="suggested" /></>)}
      {unmatched.length > 0 && (<><h2>Not yet matched ({unmatched.length})</h2><Table rows={unmatched} mode="unmatched" /></>)}
      {matched.length > 0 && (<><h2>Matched ({matched.length})</h2><Table rows={matched} mode="matched" /></>)}
      {receipts.length === 0 && (
        <div className="card">
          No receipts yet. Sync your <a href="/mileage">mileage log</a> (fuel receipts come along
          automatically) or upload a photo above.
        </div>
      )}

      <p className="disclaimer">
        Matching is suggested by amount, date, and vendor — you confirm every match. Uploaded
        photos stay in the local <code>data/receipts</code> folder on this computer.
      </p>
    </div>
  );
}
