import Link from "next/link";
import { prisma } from "@/lib/db";
import { claudeAvailable } from "@/lib/claude";
import { usd, fmtDate, pct } from "@/lib/format";
import { pickerAccounts } from "@/lib/bookkeeping";
import { Flash, AccountSelect } from "@/app/components/ui";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const entities = await prisma.entity.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });
  const entity = params.entity ? entities.find((e) => e.slug === params.entity) : undefined;
  const where = {
    categoryStatus: { in: ["suggested", "uncategorized"] },
    entity: { status: "active" },
    ...(entity ? { entityId: entity.id } : {}),
  };
  const [queue, totalCount, confident, ruleCount, counts] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { entity: true, registerAccount: true, suggestions: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ categoryStatus: "asc" }, { date: "desc" }],
      take: 80,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.count({ where: { ...where, categoryStatus: "suggested", suggestions: { some: { status: "pending", confidence: { gte: 0.9 } } } } }),
    prisma.vendorRule.count(),
    prisma.transaction.groupBy({ by: ["entityId"], where: { categoryStatus: { in: ["suggested", "uncategorized"] } }, _count: true }),
  ]);
  const countBy = new Map(counts.map((c) => [c.entityId, c._count]));
  const pickers = new Map(await Promise.all([...new Set(queue.map((t) => t.entityId))].map(async (id) => [id, await pickerAccounts(id)] as const)));
  const here = entity ? `/review?entity=${entity.slug}` : "/review";

  return (
    <div>
      <h1>Review Queue</h1>
      <p className="subtitle">
        {totalCount} transactions need a category. The assistant suggests; you decide. It learns from every approval
        and correction ({ruleCount} learned vendor rules so far).
      </p>
      <div className="toolbar">
        <Link className={`btn small ${entity ? "secondary" : ""}`} href="/review">All ({counts.reduce((s, c) => s + c._count, 0)})</Link>
        {entities.map((e) => (
          <Link key={e.id} className={`btn small ${entity?.id === e.id ? "" : "secondary"}`} href={`/review?entity=${e.slug}`}>{e.name} ({countBy.get(e.id) ?? 0})</Link>
        ))}
      </div>
      <Flash params={params} />
      {params.generated !== undefined && (
        <div className="callout">
          Made {params.generated} suggestions{params.ai === "1" ? " (learned rules + AI)" : " (learned rules)"}.
          {params.ai === "0" && !claudeAvailable() && <> Add an <code>ANTHROPIC_API_KEY</code> to the <code>.env</code> file for much smarter suggestions.</>}
        </div>
      )}

      <div className="toolbar">
        <form className="inline" action="/api/categorize" method="post">
          <input type="hidden" name="entity" value={entity?.slug ?? ""} />
          <input type="hidden" name="returnTo" value={here} />
          <button className="btn secondary" type="submit">Suggest categories</button>
        </form>
        {confident > 0 && (
          <form className="inline" action="/api/review" method="post">
            <input type="hidden" name="action" value="approve_confident" />
            <input type="hidden" name="entity" value={entity?.slug ?? ""} />
            <input type="hidden" name="returnTo" value={here} />
            <button className="btn" type="submit">Approve all {confident} that are 90%+ sure</button>
          </form>
        )}
        <span className="small mut">{claudeAvailable() ? "Learned rules first, then AI for the rest." : "AI key not set: learned rules and history only."}</span>
      </div>

      {queue.length === 0 ? (
        <div className="card">Nothing to review. Everything is categorized.</div>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Payee / bank text</th><th className="num">Amount</th><th>Suggestion</th><th>Decide</th></tr>
          </thead>
          <tbody>
            {queue.map((t) => {
              const s = t.suggestions[0];
              const picker = pickers.get(t.entityId)!;
              const groups = picker.groups.map((g) => ({ label: g.label, accounts: g.accounts.filter((a) => a.id !== t.registerAccountId) })).filter((g) => g.accounts.length);
              const isCard = t.registerAccount?.type === "credit_card";
              return (
                <tr key={t.id}>
                  <td className="small">{fmtDate(t.date)}<div className="xsmall mut">{t.entity.name}</div><div className="xsmall mut">{t.registerAccount?.name}</div></td>
                  <td>
                    <Link href={`/txn/${t.id}`}><b>{t.payee || t.vendor || t.description || "Unknown"}</b></Link>
                    <div className="xsmall mut">{t.description}</div>
                  </td>
                  <td className={`num ${t.flow === "in" ? "pos" : ""}`}>
                    {t.flow === "in" ? "+" : "−"}{usd(t.amount, { cents: true })}
                    <div className="xsmall mut">{isCard ? (t.flow === "out" ? "charge" : "payment/refund") : (t.flow === "out" ? "out" : "in")}</div>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    {s ? (
                      <>
                        <b>{s.suggestedAccountName}</b>{" "}
                        <span className={`badge ${s.confidence >= 0.75 ? "green" : s.confidence >= 0.5 ? "amber" : "red"}`}>{pct(s.confidence)} sure</span>
                        <div className="xsmall mut">{s.rationale}</div>
                      </>
                    ) : <span className="mut small">No suggestion</span>}
                  </td>
                  <td style={{ minWidth: 260 }}>
                    {s && (
                      <form className="inline" action="/api/review" method="post">
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="action" value="approve" />
                        <input type="hidden" name="returnTo" value={here} />
                        <button className="btn small" type="submit">Approve</button>
                      </form>
                    )}{" "}
                    <form className="inline" action="/api/review" method="post">
                      <input type="hidden" name="txnId" value={t.id} />
                      <input type="hidden" name="action" value="edit" />
                      <input type="hidden" name="returnTo" value={here} />
                      <AccountSelect name="accountId" groups={groups} placeholder="Other…" style={{ maxWidth: 160 }} />{" "}
                      <button className="btn small secondary" type="submit">Save</button>
                    </form>{" "}
                    <Link className="xsmall" href={`/txn/${t.id}`}>split…</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {totalCount > queue.length && <p className="small mut">Showing {queue.length} of {totalCount}. Work through these and the next ones appear.</p>}
    </div>
  );
}
