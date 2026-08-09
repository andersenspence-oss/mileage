import { prisma } from "@/lib/db";
import { usd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  duplicate: { label: "Possible duplicate", cls: "red" },
  unusual_amount: { label: "Unusual amount", cls: "amber" },
  possible_personal: { label: "Personal vs business?", cls: "amber" },
  pattern_break: { label: "Pattern change", cls: "blue" },
};

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const flags = await prisma.anomalyFlag.findMany({
    where: { status: "open" },
    include: { transaction: { include: { entity: true, account: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <h1>Anomaly Flags</h1>
      <p className="subtitle">
        Likely duplicates, unusual charges, and possible personal-vs-business mix-ups. Resolve
        (you fixed it / it&apos;s a real issue) or dismiss (it&apos;s fine).
      </p>

      {params.scanned && (
        <div className="callout">Scan complete — {params.created} new flags raised.</div>
      )}

      <form className="toolbar" action="/api/flags" method="post">
        <input type="hidden" name="action" value="scan" />
        <button className="btn" type="submit">Scan the books now</button>
        <span className="small mut">Checks duplicates, outliers, personal-looking vendors, and broken spending patterns.</span>
      </form>

      {flags.length === 0 ? (
        <div className="card">No open flags. Run a scan after each sync or month-end.</div>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Flag</th><th>Transaction</th><th className="num">Amount</th><th>Why it was flagged</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {flags.map((f) => {
              const k = KIND_LABEL[f.kind] ?? { label: f.kind, cls: "" };
              const t = f.transaction;
              return (
                <tr key={f.id}>
                  <td><span className={`badge ${k.cls}`}>{k.label}</span></td>
                  <td className="small">
                    <b>{t.vendor ?? "Unknown"}</b> · {t.entity.name}
                    <div className="xsmall mut">{fmtDate(t.date)} · {t.account?.name ?? "uncategorized"}</div>
                  </td>
                  <td className="num">{usd(t.amount, { cents: true })}</td>
                  <td className="small">{f.detail}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form className="inline" action="/api/flags" method="post">
                      <input type="hidden" name="flagId" value={f.id} />
                      <input type="hidden" name="action" value="resolve" />
                      <button className="btn small" type="submit">Resolved</button>
                    </form>{" "}
                    <form className="inline" action="/api/flags" method="post">
                      <input type="hidden" name="flagId" value={f.id} />
                      <input type="hidden" name="action" value="dismiss" />
                      <button className="btn small secondary" type="submit">Dismiss</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
