import { prisma } from "@/lib/db";
import { claudeAvailable } from "@/lib/claude";
import { usd, fmtDate, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const queue = await prisma.transaction.findMany({
    where: { categoryStatus: { in: ["suggested", "uncategorized"] } },
    include: { entity: true, suggestions: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ categoryStatus: "asc" }, { date: "desc" }],
    take: 60,
  });
  const totalCount = await prisma.transaction.count({
    where: { categoryStatus: { in: ["suggested", "uncategorized"] } },
  });
  const accountNames = (
    await prisma.account.findMany({
      where: { type: { in: ["expense", "cogs", "income"] } },
      select: { name: true }, distinct: ["name"], orderBy: { name: "asc" },
    })
  ).map((a) => a.name);
  const ruleCount = await prisma.vendorRule.count();

  return (
    <div>
      <h1>Review Queue</h1>
      <p className="subtitle">
        {totalCount} transactions need a category. The assistant suggests; you decide. It learns
        from every approval and correction ({ruleCount} learned vendor rules so far).
      </p>

      {params.generated !== undefined && (
        <div className="callout">
          Generated {params.generated} suggestions{params.ai === "1" ? " (AI + rules)" : " (rules only)"}.
          {params.ai === "0" && !claudeAvailable() && (
            <> Add an <code>ANTHROPIC_API_KEY</code> to your <code>.env</code> for much smarter suggestions.</>
          )}
        </div>
      )}

      <form className="toolbar" action="/api/categorize" method="post">
        <button className="btn" type="submit">Suggest categories for everything</button>
        <span className="small mut">
          {claudeAvailable() ? "Uses your learned rules first, then Claude for the rest." : "AI key not set — learned rules and history only."}
        </span>
      </form>

      {queue.length === 0 ? (
        <div className="card">Nothing to review — the books are fully categorized. 🎉</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Entity</th><th>Vendor / description</th><th className="num">Amount</th>
              <th>Suggestion</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((t) => {
              const s = t.suggestions[0];
              return (
                <tr key={t.id}>
                  <td className="small">{fmtDate(t.date)}</td>
                  <td className="small">{t.entity.name}</td>
                  <td>
                    <b>{t.vendor ?? "Unknown vendor"}</b>
                    <div className="xsmall mut">{t.description}</div>
                  </td>
                  <td className={`num ${t.flow === "in" ? "pos" : ""}`}>{t.flow === "in" ? "+" : "−"}{usd(t.amount, { cents: true })}</td>
                  <td>
                    {s ? (
                      <>
                        <b>{s.suggestedAccountName}</b>{" "}
                        <span className={`badge ${s.confidence >= 0.75 ? "green" : s.confidence >= 0.5 ? "amber" : "red"}`}>
                          {pct(s.confidence)} sure
                        </span>
                        <span className="badge blue">{s.source === "claude" ? "AI" : "learned rule"}</span>
                        <div className="xsmall mut">{s.rationale}</div>
                      </>
                    ) : (
                      <span className="mut small">No suggestion yet — click the button above.</span>
                    )}
                  </td>
                  <td style={{ minWidth: 230 }}>
                    {s && (
                      <form className="inline" action="/api/review" method="post">
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="action" value="approve" />
                        <button className="btn small" type="submit">Approve</button>
                      </form>
                    )}{" "}
                    <form className="inline" action="/api/review" method="post">
                      <input type="hidden" name="txnId" value={t.id} />
                      <input type="hidden" name="action" value="edit" />
                      <select name="accountName" defaultValue="">
                        <option value="" disabled>Set category…</option>
                        {accountNames.map((n) => (<option key={n} value={n}>{n}</option>))}
                      </select>{" "}
                      <button className="btn small secondary" type="submit">Save</button>
                    </form>{" "}
                    {s && (
                      <form className="inline" action="/api/review" method="post">
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="action" value="reject" />
                        <button className="btn small danger" type="submit">Reject</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {totalCount > queue.length && (
        <p className="small mut">Showing the first {queue.length} of {totalCount}. Work through these and refresh.</p>
      )}
    </div>
  );
}
