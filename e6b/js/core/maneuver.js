// maneuver.js — turns, climbs, descents and glides.

import { tanD, atan2D, FT_PER_NM } from './units.js';

const R2D = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Turns
//
// Level turn physics: the horizontal component of lift supplies the centripetal
// force, so with V in knots
//   rate  (deg/s) = 1091 tan(bank) / V
//   radius (ft)   = V^2 / (11.26 tan(bank))
// The 1091 and 11.26 constants are just g and the knot-to-ft/s conversion
// folded together, and are reproduced here from first principles.

const G_FTS2 = 32.174049;
const KT_TO_FTS = FT_PER_NM / 3600;                 // 1.6878 ft/s per knot
export const TURN_RATE_CONST = G_FTS2 * R2D / KT_TO_FTS;   // 1091.3
export const TURN_RADIUS_CONST = G_FTS2 / (KT_TO_FTS * KT_TO_FTS); // 11.294

/** Rate of turn in degrees per second for a bank angle at a true airspeed. */
export function rateOfTurn(bankDeg, tasKt) {
  return TURN_RATE_CONST * tanD(bankDeg) / tasKt;
}

/** Bank angle required for a given rate of turn. */
export function bankForRate(rateDegPerSec, tasKt) {
  return Math.atan((rateDegPerSec * tasKt) / TURN_RATE_CONST) * R2D;
}

/** Bank for a standard-rate (3 deg/sec) turn. */
export function standardRateBank(tasKt) {
  return bankForRate(3, tasKt);
}

/** The cockpit rule of thumb: bank = TAS/10 + 7 for standard rate. */
export function standardRateBankRuleOfThumb(tasKt) {
  return tasKt / 10 + 7;
}

/** Turn radius in feet. */
export function turnRadiusFt(bankDeg, tasKt) {
  return (tasKt * tasKt) / (TURN_RADIUS_CONST * tanD(bankDeg));
}

/** Turn diameter in NM — the number that matters for holding-pattern airspace. */
export function turnRadiusNm(bankDeg, tasKt) {
  return turnRadiusFt(bankDeg, tasKt) / FT_PER_NM;
}

/** Time in seconds to turn through a given number of degrees. */
export function timeToTurnSec(degrees, rateDegPerSec) {
  return degrees / rateDegPerSec;
}

/** Load factor and stall-speed multiplier in a level turn. */
export function turnLoad(bankDeg) {
  const n = 1 / Math.cos(bankDeg * Math.PI / 180);
  return { loadFactor: n, stallSpeedFactor: Math.sqrt(n) };
}

/**
 * Pivotal altitude for eights-on-pylons: h = GS^2 / 11.3 (GS in knots).
 * The constant is the same g/(kt->ft/s)^2 group as the turn radius.
 */
export function pivotalAltitudeFt(gsKt) {
  return (gsKt * gsKt) / TURN_RADIUS_CONST;
}

// ---------------------------------------------------------------------------
// Climbs and descents

/** Feet per NM for a climb/descent gradient expressed as a percentage. */
export function pctToFtPerNm(pct) {
  return (pct / 100) * FT_PER_NM;
}
export function ftPerNmToPct(ftPerNm) {
  return (ftPerNm / FT_PER_NM) * 100;
}

/** Climb/descent angle in degrees for a gradient in ft/NM. */
export function gradientAngleDeg(ftPerNm) {
  return atan2D(ftPerNm, FT_PER_NM);
}

/**
 * Everything about a climb or descent segment. Supply the altitude change plus
 * any two of (distance, time, vertical speed) and the rest follow from groundspeed.
 */
export function climbDescent({ altitudeChangeFt, distanceNm, gsKt, vsFpm, timeMin, gradientFtPerNm }) {
  const out = { altitudeChangeFt };
  if (Number.isFinite(gradientFtPerNm) && !Number.isFinite(distanceNm)) {
    distanceNm = Math.abs(altitudeChangeFt) / gradientFtPerNm;
  }
  if (Number.isFinite(distanceNm) && Number.isFinite(gsKt)) {
    timeMin = (distanceNm / gsKt) * 60;
  }
  if (Number.isFinite(timeMin) && !Number.isFinite(vsFpm)) {
    vsFpm = altitudeChangeFt / timeMin;
  }
  if (Number.isFinite(vsFpm) && !Number.isFinite(timeMin)) {
    timeMin = altitudeChangeFt / vsFpm;
    if (Number.isFinite(gsKt) && !Number.isFinite(distanceNm)) distanceNm = gsKt * (timeMin / 60);
  }
  out.distanceNm = distanceNm;
  out.timeMin = timeMin;
  out.vsFpm = vsFpm;
  out.gradientFtPerNm = Number.isFinite(distanceNm) && distanceNm !== 0
    ? Math.abs(altitudeChangeFt) / distanceNm : gradientFtPerNm;
  out.gradientPct = ftPerNmToPct(out.gradientFtPerNm);
  out.angleDeg = gradientAngleDeg(out.gradientFtPerNm);
  return out;
}

/**
 * Required rate of descent (fpm) to lose `altitudeFt` over `distanceNm` at `gsKt`.
 * Also returns the 3-degree-glidepath cross-check every instrument pilot uses:
 * fpm = GS x 5, and 300 ft per NM.
 */
export function requiredDescent({ altitudeFt, distanceNm, gsKt }) {
  const gradient = altitudeFt / distanceNm;
  return {
    gradientFtPerNm: gradient,
    gradientPct: ftPerNmToPct(gradient),
    angleDeg: gradientAngleDeg(gradient),
    vsFpm: gradient * (gsKt / 60),
    timeMin: (distanceNm / gsKt) * 60,
    threeDegreeFpm: gsKt * 5,          // the "half your groundspeed x 10" rule
  };
}

/** Top of descent: where to start down, and how long the descent takes. */
export function topOfDescent({ cruiseAltFt, targetAltFt, vsFpm, gsKt, targetDistanceNm = 0 }) {
  const drop = cruiseAltFt - targetAltFt;
  const timeMin = drop / Math.abs(vsFpm);
  const distNm = gsKt * (timeMin / 60);
  return {
    altitudeToLoseFt: drop,
    descentTimeMin: timeMin,
    descentDistanceNm: distNm,
    startDescentDistanceNm: distNm + targetDistanceNm,
    gradientFtPerNm: drop / distNm,
    gradientPct: ftPerNmToPct(drop / distNm),
    // The mental version: 3 x the thousands of feet to lose.
    ruleOfThumbNm: 3 * (drop / 1000) + targetDistanceNm,
  };
}

/** Glide performance from a height, given a glide ratio (or L/D). */
export function glide({ heightAglFt, glideRatio, gsKt, sinkFpm }) {
  const out = {};
  if (Number.isFinite(glideRatio)) {
    out.distanceNm = (heightAglFt * glideRatio) / FT_PER_NM;
    out.glideRatio = glideRatio;
  }
  if (Number.isFinite(gsKt) && Number.isFinite(sinkFpm) && sinkFpm > 0) {
    const gr = (gsKt * FT_PER_NM / 60) / sinkFpm;
    out.glideRatio = gr;
    out.distanceNm = (heightAglFt * gr) / FT_PER_NM;
  }
  if (Number.isFinite(gsKt) && Number.isFinite(out.distanceNm)) {
    out.timeMin = (out.distanceNm / gsKt) * 60;
    if (!Number.isFinite(sinkFpm)) out.sinkFpm = heightAglFt / out.timeMin;
    else out.sinkFpm = sinkFpm;
  }
  out.ftPerNm = Number.isFinite(out.glideRatio) ? FT_PER_NM / out.glideRatio : NaN;
  out.angleDeg = gradientAngleDeg(out.ftPerNm);
  return out;
}

/**
 * Visual descent point on a non-precision approach: how far before the runway
 * threshold to leave MDA on a nominal 3 degree path.
 */
export function visualDescentPoint({ mdaFt, tdzeFt, angleDeg = 3 }) {
  const hat = mdaFt - tdzeFt;
  const ftPerNm = FT_PER_NM * Math.tan(angleDeg * Math.PI / 180);
  return { heightAboveTdzeFt: hat, vdpDistanceNm: hat / ftPerNm, gradientFtPerNm: ftPerNm };
}

/**
 * Climb gradient a departure procedure requires, converted to the rate of climb
 * you actually have to fly at your groundspeed.
 */
export function climbRequirement({ gradientFtPerNm, gsKt }) {
  return {
    vsFpm: gradientFtPerNm * (gsKt / 60),
    gradientPct: ftPerNmToPct(gradientFtPerNm),
    angleDeg: gradientAngleDeg(gradientFtPerNm),
  };
}

/** Rate of climb available converted to a gradient at a given groundspeed. */
export function climbAvailable({ vsFpm, gsKt }) {
  const g = vsFpm / (gsKt / 60);
  return { gradientFtPerNm: g, gradientPct: ftPerNmToPct(g), angleDeg: gradientAngleDeg(g) };
}
