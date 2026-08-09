import { prisma } from "@/lib/db";
import { loadIntake } from "@/lib/intake";

export const dynamic = "force-dynamic";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const intake = await loadIntake();
  const entities = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  const unconfirmed = entities.filter((e) => !intake.entities[e.slug]?.confirmed);

  return (
    <div>
      <h1>Situation Intake</h1>
      <p className="subtitle">
        The strategy engine needs what the numbers can&apos;t tell it. Fill this once, update when
        life changes. Sensible defaults are pre-filled — <b>review every value</b>.
      </p>

      {params.saved && <div className="callout">Saved. Re-run the analysis on the Action Plan page to use the new answers.</div>}
      {unconfirmed.length > 0 && (
        <div className="callout warn">
          {unconfirmed.length} entities are marked unconfirmed (the SandCastle LLCs&apos; role was
          assumed, not verified). Confirm what each one actually is and owns below.
        </div>
      )}

      <form action="/api/intake" method="post">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>You &amp; taxes</h3>
          <label className="field"><span className="fieldname">Filing status</span>
            <select name="filingStatus" defaultValue={intake.owner.filingStatus}>
              <option value="married_joint">Married filing jointly</option>
              <option value="single">Single</option>
              <option value="head_of_household">Head of household</option>
              <option value="married_separate">Married filing separately</option>
            </select>
          </label>
          <label className="field"><span className="fieldname">Your best guess at your federal marginal tax bracket (your CPA can confirm)</span>
            <select name="fedMarginalRate" defaultValue={String(intake.owner.fedMarginalRate)}>
              <option value="0.22">22%</option>
              <option value="0.24">24%</option>
              <option value="0.32">32%</option>
              <option value="0.35">35%</option>
              <option value="0.37">37%</option>
            </select>
          </label>
          <label className="field"><span className="fieldname">State</span><input type="text" value="Utah" disabled /></label>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Family</h3>
          <label className="field"><input type="checkbox" name="spouseInvolved" defaultChecked={intake.family.spouseInvolved} /> Spouse works in (or could work in) the businesses</label>
          <label className="field"><span className="fieldname">Children who could do real, age-appropriate work (age 7+)</span>
            <input type="number" name="childrenEmployable" min={0} max={10} defaultValue={intake.family.childrenEmployable} />
          </label>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Home</h3>
          <label className="field"><input type="checkbox" name="officeUsed" defaultChecked={intake.home.officeUsed} /> I regularly and exclusively use part of my home to run the businesses</label>
          <label className="field"><span className="fieldname">Office share of the home (%)</span>
            <input type="number" name="officePercent" min={0} max={50} defaultValue={intake.home.officePercent} />
          </label>
          <label className="field"><span className="fieldname">Total annual home costs (mortgage interest/rent, utilities, insurance, HOA, repairs) $</span>
            <input type="number" name="annualHomeCosts" min={0} defaultValue={intake.home.annualHomeCosts} />
          </label>
          <label className="field"><span className="fieldname">Business meetings/planning days you could genuinely host at home per year</span>
            <input type="number" name="augustaMeetingsPerYear" min={0} max={30} defaultValue={intake.home.augustaMeetingsPerYear} />
          </label>
          <label className="field"><span className="fieldname">What a comparable local meeting venue costs per day $</span>
            <input type="number" name="localDailyVenueRate" min={0} defaultValue={intake.home.localDailyVenueRate} />
          </label>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Vehicles</h3>
          <label className="field"><span className="fieldname">Business miles you drive per year (estimate)</span>
            <input type="number" name="businessMilesPerYear" min={0} defaultValue={intake.vehicles.businessMilesPerYear} />
          </label>
          <label className="field"><input type="checkbox" name="heavyVehicle" defaultChecked={intake.vehicles.heavyVehicle} /> I own (or plan to buy) a heavy vehicle (&gt;6,000 lb GVWR) used mostly for business</label>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Retirement &amp; health</h3>
          <label className="field"><input type="checkbox" name="solo401kActive" defaultChecked={intake.retirement.solo401kActive} /> I already have a Solo 401(k) / SEP</label>
          <label className="field"><span className="fieldname">Current annual retirement contributions $</span>
            <input type="number" name="currentAnnualContribution" min={0} defaultValue={intake.retirement.currentAnnualContribution} />
          </label>
          <label className="field"><input type="checkbox" name="hdhpCoverage" defaultChecked={intake.health.hdhpCoverage} /> My health plan is a high-deductible (HSA-qualified) plan</label>
          <label className="field"><span className="fieldname">Current annual HSA contributions $</span>
            <input type="number" name="hsaContribution" min={0} defaultValue={intake.health.hsaContribution} />
          </label>
          <label className="field"><span className="fieldname">Family out-of-pocket medical costs per year $</span>
            <input type="number" name="annualOutOfPocketMedical" min={0} defaultValue={intake.health.annualOutOfPocketMedical} />
          </label>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Planning</h3>
          <label className="field"><span className="fieldname">Equipment purchases planned in the next 12 months (tables, imaging, cameras, computers) $</span>
            <input type="number" name="plannedEquipmentPurchases" min={0} defaultValue={intake.planning.plannedEquipmentPurchases} />
          </label>
          <label className="field"><span className="fieldname">Business costs you currently pay personally per year (phone, internet, travel, supplies) $</span>
            <input type="number" name="ownerPaidBusinessCosts" min={0} defaultValue={intake.planning.ownerPaidBusinessCosts} />
          </label>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>The eight entities</h3>
          <p className="small mut">
            This map is what lets the analyzer reason across the whole group. &quot;Tax treatment&quot; matters
            enormously — mark it <i>unknown</i> if unsure and your CPA can confirm each one.
          </p>
          <table className="data">
            <thead>
              <tr><th>Entity</th><th>Role</th><th>Tax treatment</th><th>Own %</th><th>Owns real estate?</th><th>Rents to the group?</th><th>Confirmed</th></tr>
            </thead>
            <tbody>
              {entities.map((e) => {
                const ei = intake.entities[e.slug];
                return (
                  <tr key={e.slug}>
                    <td><b>{e.name}</b></td>
                    <td>
                      <select name={`ent_${e.slug}_role`} defaultValue={ei.role}>
                        <option value="clinic">Operating — clinic</option>
                        <option value="media">Operating — media/education</option>
                        <option value="operating">Operating — other</option>
                        <option value="rental_realestate">Real estate / rental</option>
                        <option value="holding">Holding company</option>
                        <option value="dormant">Dormant / no activity</option>
                      </select>
                    </td>
                    <td>
                      <select name={`ent_${e.slug}_tax`} defaultValue={ei.taxTreatment}>
                        <option value="unknown">Unknown — ask CPA</option>
                        <option value="sole_prop">Sole proprietorship</option>
                        <option value="single_member_llc">Single-member LLC (default)</option>
                        <option value="partnership">Partnership</option>
                        <option value="s_corp">S-corporation</option>
                        <option value="c_corp">C-corporation</option>
                      </select>
                    </td>
                    <td><input style={{ width: 64 }} type="number" name={`ent_${e.slug}_ownership`} min={0} max={100} defaultValue={ei.ownershipPercent} /></td>
                    <td>
                      <select name={`ent_${e.slug}_realestate`} defaultValue={ei.ownsRealEstate}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unconfirmed">Not sure</option>
                      </select>
                    </td>
                    <td>
                      <select name={`ent_${e.slug}_rents`} defaultValue={ei.rentsToGroup}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </td>
                    <td><input type="checkbox" name={`ent_${e.slug}_confirmed`} defaultChecked={ei.confirmed} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Goals</h3>
          <textarea name="goals" rows={3} defaultValue={intake.goals} placeholder="e.g. cut this year's tax bill, build real-estate holdings, sell a clinic in 5 years…" />
        </div>

        <button className="btn" type="submit">Save intake</button>
      </form>

      <p className="disclaimer">
        Your answers stay in the local database on this computer. Estimate only — verify with your CPA.
      </p>
    </div>
  );
}
