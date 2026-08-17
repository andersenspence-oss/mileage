// airspeed.js — the airspeed chain: IAS -> CAS -> EAS -> TAS -> Mach -> GS.
//
// The compressible relations are the same ones used by air-data computers:
//   qc = P0 [ (1 + 0.2 (CAS/a0)^2)^3.5 - 1 ]        (calibrated airspeed definition)
//   M  = sqrt( 5 [ (qc/P + 1)^(2/7) - 1 ] )         (subsonic Rayleigh/Bernoulli)
//   TAS = M a,   a = a0 sqrt(T/T0)
// Below roughly 200 kt and 10 000 ft these agree with the classic slide-rule
// (incompressible) answer to well inside a knot, so both are reported.

import { ISA, pressureRatio, densityRatio, speedOfSoundKt } from './atmosphere.js';

const P0 = ISA.P0_INHG;
const A0 = ISA.A0_KT;

/** Impact (dynamic) pressure in inHg for a calibrated airspeed in knots. */
export function qcFromCas(casKt) {
  return P0 * (Math.pow(1 + 0.2 * Math.pow(casKt / A0, 2), 3.5) - 1);
}

/** Calibrated airspeed (kt) for an impact pressure in inHg. */
export function casFromQc(qcInHg) {
  return A0 * Math.sqrt(5 * (Math.pow(qcInHg / P0 + 1, 2 / 7) - 1));
}

/** Mach number from calibrated airspeed and pressure altitude. */
export function machFromCas(casKt, paFt) {
  const p = P0 * pressureRatio(paFt);
  const qc = qcFromCas(casKt);
  return Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
}

/** Calibrated airspeed from Mach number and pressure altitude. */
export function casFromMach(mach, paFt) {
  const p = P0 * pressureRatio(paFt);
  const qc = p * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
  return casFromQc(qc);
}

/** True airspeed (kt) from Mach number and outside air temperature. */
export function tasFromMach(mach, oatC) {
  return mach * speedOfSoundKt(oatC);
}

/** Mach number from true airspeed and outside air temperature. */
export function machFromTas(tasKt, oatC) {
  return tasKt / speedOfSoundKt(oatC);
}

/**
 * True airspeed from calibrated airspeed, pressure altitude and OAT,
 * including compressibility. This is the primary answer.
 */
export function tasFromCas(casKt, paFt, oatC) {
  return tasFromMach(machFromCas(casKt, paFt), oatC);
}

/**
 * The slide-rule answer: TAS = CAS / sqrt(sigma), no compressibility term.
 * Kept so the app can show a pilot exactly how far the mechanical E6B is off.
 */
export function tasFromCasIncompressible(casKt, paFt, oatC) {
  return casKt / Math.sqrt(densityRatio(paFt, oatC));
}

/** Calibrated airspeed from true airspeed (compressible inverse). */
export function casFromTas(tasKt, paFt, oatC) {
  return casFromMach(machFromTas(tasKt, oatC), paFt);
}

/** Equivalent airspeed from true airspeed. */
export function easFromTas(tasKt, paFt, oatC) {
  return tasKt * Math.sqrt(densityRatio(paFt, oatC));
}

/** True airspeed from equivalent airspeed. */
export function tasFromEas(easKt, paFt, oatC) {
  return easKt / Math.sqrt(densityRatio(paFt, oatC));
}

/**
 * Total (ram) air temperature from static air temperature.
 * TAT = SAT (1 + 0.2 K M^2), K = probe recovery factor (1.0 for full recovery).
 */
export function totalAirTempC(satC, mach, recovery = 1.0) {
  return (satC + 273.15) * (1 + 0.2 * recovery * mach * mach) - 273.15;
}

/** Static air temperature recovered from an indicated total air temperature. */
export function staticAirTempC(tatC, mach, recovery = 1.0) {
  return (tatC + 273.15) / (1 + 0.2 * recovery * mach * mach) - 273.15;
}

/**
 * Full airspeed solution for one flight condition. Returns everything the
 * "True Airspeed" page shows, so the page never re-derives anything.
 */
export function airspeedSolution({ casKt, paFt, oatC }) {
  const sigma = densityRatio(paFt, oatC);
  const mach = machFromCas(casKt, paFt);
  const tas = tasFromMach(mach, oatC);
  return {
    sigma,
    sqrtSigma: Math.sqrt(sigma),
    mach,
    tasKt: tas,
    tasSlideRuleKt: casKt / Math.sqrt(sigma),
    easKt: tas * Math.sqrt(sigma),
    speedOfSoundKt: speedOfSoundKt(oatC),
    qcInHg: qcFromCas(casKt),
    // The classic "add 2% per 1 000 ft" mental estimate.
    tasRuleOfThumbKt: casKt * (1 + 0.02 * paFt / 1000),
  };
}

/**
 * Airspeeds scale with the square root of the weight ratio.
 * Used for stall speed and Vx/Vy at less than gross weight.
 */
export function speedAtWeight(speedAtRefKt, refWeight, actualWeight) {
  return speedAtRefKt * Math.sqrt(actualWeight / refWeight);
}

/** Stall speed in a level banked turn: Vs_turn = Vs / sqrt(cos bank). */
export function stallSpeedInTurn(vsKt, bankDeg) {
  return vsKt / Math.sqrt(Math.cos(bankDeg * Math.PI / 180));
}

/** Load factor in a level banked turn: n = 1 / cos(bank). */
export function loadFactor(bankDeg) {
  return 1 / Math.cos(bankDeg * Math.PI / 180);
}

/** Bank angle that produces a given load factor. */
export function bankForLoadFactor(n) {
  return Math.acos(1 / n) * 180 / Math.PI;
}

/**
 * Maneuvering speed at a weight below gross: Va scales with sqrt(weight ratio).
 * Lower weight means a LOWER maneuvering speed - a favourite test question.
 */
export function maneuveringSpeed(vaGrossKt, grossWeight, actualWeight) {
  return vaGrossKt * Math.sqrt(actualWeight / grossWeight);
}
