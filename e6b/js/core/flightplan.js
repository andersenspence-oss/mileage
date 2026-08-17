// flightplan.js — a multi-leg nav log built on the same wind triangle the
// single-leg pages use, so the two can never disagree.

import { windTriangle } from './wind.js';
import { headingChain } from './nav.js';
import { norm360 } from './units.js';

/**
 * @param legs  [{ name, trueCourseDeg, distanceNm, tasKt, windDirDeg, windSpeedKt,
 *                 variationDeg, deviationDeg, burnGph }]
 * @param defaults values used for any field a leg leaves blank
 * @param startFuelGal fuel on board at engine start (after taxi), optional
 * @param departMinUtc departure time in minutes after midnight, optional
 */
export function computeNavLog({ legs, defaults = {}, startFuelGal, departMinUtc, taxiFuelGal = 0 }) {
  let cumDist = 0, cumTime = 0, cumFuel = taxiFuelGal;
  const rows = legs.map((leg, idx) => {
    const v = (k, d) => (Number.isFinite(leg[k]) ? leg[k] : (Number.isFinite(defaults[k]) ? defaults[k] : d));
    const tas = v('tasKt', NaN);
    const wd = v('windDirDeg', 0);
    const ws = v('windSpeedKt', 0);
    const varn = v('variationDeg', 0);
    const dev = v('deviationDeg', 0);
    const burn = v('burnGph', NaN);
    const dist = v('distanceNm', NaN);
    const tc = norm360(v('trueCourseDeg', NaN));

    const wt = windTriangle({ courseDeg: tc, tasKt: tas, windDirDeg: wd, windSpeedKt: ws });
    const wca = wt && !wt.impossible ? wt.wcaDeg : NaN;
    const gs = wt && !wt.impossible ? wt.groundspeedKt : NaN;
    const chain = headingChain({ trueCourseDeg: tc, wcaDeg: wca || 0, variationDeg: varn, deviationDeg: dev });
    const timeMin = Number.isFinite(dist) && gs > 0 ? (dist / gs) * 60 : NaN;
    const fuelGal = Number.isFinite(timeMin) && Number.isFinite(burn) ? burn * (timeMin / 60) : NaN;

    if (Number.isFinite(dist)) cumDist += dist;
    if (Number.isFinite(timeMin)) cumTime += timeMin;
    if (Number.isFinite(fuelGal)) cumFuel += fuelGal;

    return {
      index: idx,
      name: leg.name || `Leg ${idx + 1}`,
      trueCourseDeg: tc,
      distanceNm: dist,
      tasKt: tas,
      windDirDeg: wd,
      windSpeedKt: ws,
      wcaDeg: wca,
      trueHeadingDeg: chain.trueHeadingDeg,
      magneticCourseDeg: chain.magneticCourseDeg,
      magneticHeadingDeg: chain.magneticHeadingDeg,
      compassHeadingDeg: chain.compassHeadingDeg,
      groundspeedKt: gs,
      headwindKt: wt ? wt.headwindKt : NaN,
      crosswindKt: wt ? wt.crosswindKt : NaN,
      legTimeMin: timeMin,
      legFuelGal: fuelGal,
      cumDistanceNm: cumDist,
      cumTimeMin: cumTime,
      cumFuelGal: cumFuel,
      etaMinUtc: Number.isFinite(departMinUtc) ? departMinUtc + cumTime : NaN,
      fuelRemainingGal: Number.isFinite(startFuelGal) ? startFuelGal - cumFuel : NaN,
      unflyable: !!(wt && wt.impossible),
    };
  });

  return {
    rows,
    totalDistanceNm: cumDist,
    totalTimeMin: cumTime,
    totalFuelGal: cumFuel,
    averageGsKt: cumTime > 0 ? cumDist / (cumTime / 60) : NaN,
    fuelRemainingGal: Number.isFinite(startFuelGal) ? startFuelGal - cumFuel : NaN,
    etaMinUtc: Number.isFinite(departMinUtc) ? departMinUtc + cumTime : NaN,
  };
}
