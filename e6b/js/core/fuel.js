// fuel.js — consumption, endurance, reserves and fuel weight.

import { FUEL_LB_PER_GAL } from './units.js';

/** Give any two of rate (gal/hr), time (min), quantity (gal); get the third. */
export function solveFuel({ rateGph, timeMin, quantityGal }) {
  const known = [rateGph, timeMin, quantityGal].filter(Number.isFinite).length;
  if (known < 2) return { solved: null };
  if (!Number.isFinite(quantityGal)) {
    return { solved: 'quantity', rateGph, timeMin, quantityGal: rateGph * (timeMin / 60) };
  }
  if (!Number.isFinite(timeMin)) {
    return { solved: 'time', rateGph, quantityGal, timeMin: (quantityGal / rateGph) * 60 };
  }
  return { solved: 'rate', timeMin, quantityGal, rateGph: quantityGal / (timeMin / 60) };
}

/** Weight of a quantity of fuel. */
export function fuelWeightLb(gallons, type = 'Avgas 100LL') {
  return gallons * (FUEL_LB_PER_GAL[type] ?? 6.0);
}

/** Gallons that weigh a given number of pounds. */
export function fuelGallons(weightLb, type = 'Avgas 100LL') {
  return weightLb / (FUEL_LB_PER_GAL[type] ?? 6.0);
}

/**
 * Trip fuel planning. Everything is in gallons and minutes.
 * Reserve is expressed as minutes at the cruise burn rate, matching 14 CFR 91.151
 * (30 min day VFR, 45 min night VFR, 45 min IFR to the alternate).
 */
export function tripFuel({
  distanceNm, gsKt, burnGph,
  taxiRunupGal = 0, climbGal = 0, reserveMin = 45,
  alternateNm = 0, alternateGsKt, usableGal,
}) {
  const enrouteMin = (distanceNm / gsKt) * 60;
  const enrouteGal = burnGph * (enrouteMin / 60);
  const altMin = alternateNm > 0 ? (alternateNm / (alternateGsKt || gsKt)) * 60 : 0;
  const altGal = burnGph * (altMin / 60);
  const reserveGal = burnGph * (reserveMin / 60);
  const totalGal = taxiRunupGal + climbGal + enrouteGal + altGal + reserveGal;
  const out = {
    enrouteTimeMin: enrouteMin,
    enrouteGal,
    alternateTimeMin: altMin,
    alternateGal: altGal,
    reserveGal,
    totalRequiredGal: totalGal,
    totalRequiredLb: totalGal * 6,
  };
  if (Number.isFinite(usableGal)) {
    out.marginGal = usableGal - totalGal;
    out.legal = out.marginGal >= 0;
    out.enduranceMin = (usableGal / burnGph) * 60;
    out.rangeNm = out.enduranceMin / 60 * gsKt;
    out.rangeWithReserveNm = ((usableGal - reserveGal) / burnGph) * gsKt;
  }
  return out;
}

/** Endurance and still-air range from usable fuel. */
export function endurance({ usableGal, burnGph, gsKt }) {
  const min = (usableGal / burnGph) * 60;
  return { enduranceMin: min, rangeNm: Number.isFinite(gsKt) ? gsKt * (min / 60) : NaN };
}

/** Specific range: NM per gallon, and its inverse. */
export function specificRange({ gsKt, burnGph }) {
  return { nmPerGal: gsKt / burnGph, galPerNm: burnGph / gsKt, galPer100Nm: 100 * burnGph / gsKt };
}

/** Fuel remaining after a leg, and the time that fuel is worth. */
export function fuelRemaining({ onboardGal, burnGph, timeMin }) {
  const used = burnGph * (timeMin / 60);
  const left = onboardGal - used;
  return { usedGal: used, remainingGal: left, remainingMin: (left / burnGph) * 60 };
}

/**
 * 14 CFR 91.151 / 91.167 reserve requirements, in minutes at normal cruise.
 * Provided so the planner can flag an illegal fuel load, not just a tight one.
 */
export const RESERVE_RULES = [
  { id: 'vfr-day', label: 'VFR day (91.151)', minutes: 30 },
  { id: 'vfr-night', label: 'VFR night (91.151)', minutes: 45 },
  { id: 'ifr', label: 'IFR + alternate (91.167)', minutes: 45 },
  { id: 'helicopter', label: 'VFR helicopter (91.151)', minutes: 20 },
];
