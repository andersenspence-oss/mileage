// wind.js — the wind triangle, solved with trigonometry rather than a paper wheel.
//
// Conventions used everywhere in this file:
//   * Wind direction is the direction the wind is coming FROM.
//   * Courses, headings and wind directions are in the same reference (all true,
//     or all magnetic). The pages that mix them do the variation step explicitly.
//   * A positive wind correction angle means crab to the right.

import { sinD, cosD, asinD, atan2D, norm360, norm180 } from './units.js';

/**
 * Classic problem: given course, true airspeed and the wind, find the heading
 * to hold and the groundspeed you will make good.
 *
 *   sin(WCA) = (WS / TAS) sin(WD - TC)
 *   TH  = TC + WCA
 *   GS  = TAS cos(WCA) - WS cos(WD - TC)
 */
export function windTriangle({ courseDeg, tasKt, windDirDeg, windSpeedKt }) {
  const rel = norm180(windDirDeg - courseDeg);       // wind angle off the nose
  const sinWca = (windSpeedKt / tasKt) * sinD(rel);
  if (!Number.isFinite(sinWca)) return null;
  if (Math.abs(sinWca) > 1) {
    // The crosswind component exceeds the true airspeed: the course cannot be held.
    return {
      impossible: true,
      relativeWindDeg: rel,
      headwindKt: windSpeedKt * cosD(rel),
      crosswindKt: windSpeedKt * sinD(rel),
    };
  }
  const wca = asinD(sinWca);
  const heading = norm360(courseDeg + wca);
  const gs = tasKt * cosD(wca) - windSpeedKt * cosD(rel);
  return {
    impossible: false,
    wcaDeg: wca,
    headingDeg: heading,
    groundspeedKt: gs,
    relativeWindDeg: rel,
    headwindKt: windSpeedKt * cosD(rel),      // positive = headwind
    crosswindKt: windSpeedKt * sinD(rel),     // positive = from the right
    driftDeg: -wca,
    negativeGroundspeed: gs <= 0,
  };
}

/**
 * Reverse problem: you flew a heading at a known TAS and observed the track and
 * groundspeed. What was the wind? (Wind = ground vector - air vector.)
 */
export function windFromTrack({ headingDeg, tasKt, trackDeg, groundspeedKt }) {
  // Components in a north/east frame.
  const airN = tasKt * cosD(headingDeg);
  const airE = tasKt * sinD(headingDeg);
  const gndN = groundspeedKt * cosD(trackDeg);
  const gndE = groundspeedKt * sinD(trackDeg);
  const wN = gndN - airN;
  const wE = gndE - airE;
  const speed = Math.hypot(wN, wE);
  // Direction the wind blows TOWARD, reversed to the meteorological FROM.
  const towardDeg = atan2D(wE, wN);
  const windDir = norm360(towardDeg + 180);
  const rel = norm180(windDir - trackDeg);
  return {
    windDirDeg: speed < 1e-9 ? 0 : windDir,
    windSpeedKt: speed,
    wcaDeg: norm180(headingDeg - trackDeg),     // positive = crabbing right
    driftDeg: norm180(trackDeg - headingDeg),
    headwindKt: speed * cosD(rel),              // along the track made good
    crosswindKt: speed * sinD(rel),
  };
}

/**
 * Given course, TAS and the wind, but solving for the *course* you will make
 * good from a heading you are already holding (no correction applied).
 */
export function trackFromHeading({ headingDeg, tasKt, windDirDeg, windSpeedKt }) {
  const airN = tasKt * cosD(headingDeg);
  const airE = tasKt * sinD(headingDeg);
  // Wind vector points from the "from" direction toward its reciprocal.
  const wN = -windSpeedKt * cosD(windDirDeg);
  const wE = -windSpeedKt * sinD(windDirDeg);
  const gN = airN + wN, gE = airE + wE;
  return {
    trackDeg: norm360(atan2D(gE, gN)),
    groundspeedKt: Math.hypot(gN, gE),
    driftDeg: norm180(atan2D(gE, gN) - headingDeg),
  };
}

/**
 * Runway / course wind components.
 * Headwind is positive; a tailwind comes back negative. Crosswind is positive
 * from the right. Both are reported with the "from the left/right" label the
 * POH performance charts expect.
 */
export function windComponents({ runwayHeadingDeg, windDirDeg, windSpeedKt }) {
  const angle = norm180(windDirDeg - runwayHeadingDeg);
  const head = windSpeedKt * cosD(angle);
  const cross = windSpeedKt * sinD(angle);
  return {
    angleOffDeg: angle,
    absAngleDeg: Math.abs(angle),
    headwindKt: head,
    tailwindKt: -head,
    crosswindKt: cross,
    crossFrom: cross >= 0 ? 'right' : 'left',
    isTailwind: head < 0,
    // The classic clock-face estimate, for cross-checking in the run-up area.
    clockRuleCrosswindKt: windSpeedKt * Math.min(1, Math.abs(angle) / 60),
  };
}

/** Wind components for every runway of an airport, sorted best-first. */
export function runwayAnalysis({ runwayNumbers, windDirDeg, windSpeedKt, variationDeg = 0, windIsTrue = false }) {
  // Runway numbers are magnetic. METAR winds are true; tower/ATIS winds are magnetic.
  const windMag = windIsTrue ? norm360(windDirDeg - variationDeg) : windDirDeg;
  return runwayNumbers
    .map((rw) => {
      const hdg = norm360(Number(rw) * 10);
      const c = windComponents({ runwayHeadingDeg: hdg, windDirDeg: windMag, windSpeedKt });
      return { runway: String(rw), headingDeg: hdg, ...c };
    })
    .sort((a, b) => b.headwindKt - a.headwindKt || Math.abs(a.crosswindKt) - Math.abs(b.crosswindKt));
}

/**
 * Maximum wind speed that keeps the crosswind at or below a demonstrated limit
 * for a given angle off the runway.
 */
export function maxWindForCrosswind(limitKt, angleOffDeg) {
  const s = Math.abs(sinD(angleOffDeg));
  return s < 1e-9 ? Infinity : limitKt / s;
}

/**
 * Headwind/crosswind for a given angle, expressed as percentages - this is the
 * table behind the "wind component chart" in every POH.
 */
export function componentFactors(angleOffDeg) {
  return {
    headwindPct: cosD(angleOffDeg) * 100,
    crosswindPct: Math.abs(sinD(angleOffDeg)) * 100,
  };
}

/**
 * Average two winds (e.g. interpolating between two winds-aloft levels or two
 * reporting stations). Vector averaging, not arithmetic averaging.
 */
export function averageWind(winds) {
  let n = 0, e = 0;
  for (const w of winds) {
    n += -w.windSpeedKt * cosD(w.windDirDeg);
    e += -w.windSpeedKt * sinD(w.windDirDeg);
  }
  n /= winds.length; e /= winds.length;
  return {
    windDirDeg: norm360(atan2D(e, n) + 180),
    windSpeedKt: Math.hypot(n, e),
  };
}

/**
 * Interpolate a winds-aloft forecast between two reported levels.
 * FD levels are given for 3 000, 6 000, 9 000 ... so cruising in between needs this.
 */
export function interpolateWindsAloft({ lowerAltFt, lowerDirDeg, lowerSpeedKt, lowerTempC,
  upperAltFt, upperDirDeg, upperSpeedKt, upperTempC, targetAltFt }) {
  const f = (targetAltFt - lowerAltFt) / (upperAltFt - lowerAltFt);
  const lN = -lowerSpeedKt * cosD(lowerDirDeg), lE = -lowerSpeedKt * sinD(lowerDirDeg);
  const uN = -upperSpeedKt * cosD(upperDirDeg), uE = -upperSpeedKt * sinD(upperDirDeg);
  const n = lN + f * (uN - lN), e = lE + f * (uE - lE);
  const temp = (Number.isFinite(lowerTempC) && Number.isFinite(upperTempC))
    ? lowerTempC + f * (upperTempC - lowerTempC) : NaN;
  return {
    fraction: f,
    windDirDeg: norm360(atan2D(e, n) + 180),
    windSpeedKt: Math.hypot(n, e),
    tempC: temp,
  };
}
