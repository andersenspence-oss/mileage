import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const strategies = await prisma.strategy.findMany({ orderBy: [{ custom: "asc" }, { name: "asc" }] });

  return (
    <div>
      <h1>Strategy Library</h1>
      <p className="subtitle">
        The playbook the analyzer runs against your books. Each entry names the tax provision it
        rests on and what your CPA must verify. Disable any you don&apos;t want considered; add your own below.
      </p>

      <div className="cardgrid">
        {strategies.map((s) => (
          <div className="card" key={s.id} style={{ opacity: s.enabled ? 1 : 0.55 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <b>{s.name}</b>
              <span className={`badge ${s.complexity === "advanced" ? "red" : s.complexity === "high" ? "amber" : "green"}`}>
                {s.complexity}
              </span>
            </div>
            <p className="small" style={{ margin: "8px 0" }}>{s.description}</p>
            <div className="xsmall mut"><b>Rests on:</b> {s.provision}</div>
            <div className="xsmall mut" style={{ marginTop: 4 }}><b>Relevant when:</b> {s.eligibility}</div>
            <div className="xsmall mut" style={{ marginTop: 4 }}><b>Estimate method:</b> {s.impactFormula}</div>
            <div className="xsmall warn" style={{ marginTop: 6 }}><b>Verify with CPA:</b> {s.verifyNotes}</div>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <span className="badge">effort {s.effort}/5</span>
              {s.custom && <span className="badge blue">custom</span>}
              <form className="inline" action="/api/strategies" method="post">
                <input type="hidden" name="action" value="toggle" />
                <input type="hidden" name="id" value={s.id} />
                <button className="btn small secondary" type="submit">{s.enabled ? "Disable" : "Enable"}</button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <h2>Add your own strategy</h2>
      <div className="card">
        <form action="/api/strategies" method="post">
          <input type="hidden" name="action" value="add" />
          <label className="field"><span className="fieldname">Name</span><input type="text" name="name" required style={{ width: "100%" }} /></label>
          <label className="field"><span className="fieldname">Plain-language description</span><textarea name="description" rows={2} /></label>
          <label className="field"><span className="fieldname">Tax provision / principle it rests on</span><input type="text" name="provision" style={{ width: "100%" }} /></label>
          <label className="field"><span className="fieldname">When it applies (eligibility)</span><input type="text" name="eligibility" style={{ width: "100%" }} /></label>
          <label className="field"><span className="fieldname">What your CPA must verify</span><input type="text" name="verifyNotes" style={{ width: "100%" }} /></label>
          <label className="field"><span className="fieldname">Effort (1 = easy … 5 = heavy)</span><input type="number" name="effort" min={1} max={5} defaultValue={3} /></label>
          <button className="btn" type="submit">Add to library</button>
          <p className="xsmall mut">Custom strategies appear in the plan without an automatic dollar estimate — size them with your CPA.</p>
        </form>
      </div>

      <p className="disclaimer">
        This is a methodology library, not advice. Estimate only. Verify eligibility and current
        law with your CPA before acting.
      </p>
    </div>
  );
}
