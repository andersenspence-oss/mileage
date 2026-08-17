// holding.js — holding-pattern entries, wind-corrected legs and speed limits.
//
// Entry sectors follow AIM 5-3-8: a 70 degree teardrop sector and a 110 degree
// parallel sector split the half of the compass behind the fix, and the
// remaining 180 degrees is the direct sector.

import { norm360, norm180, sinD, cosD, asinD } from './units.js';

/**
 * Recommended entry for a hold.
 * @param inboundCourseDeg course flown TO the fix on the inbound leg
 * @param headingDeg       aircraft heading arriving at the fix
 * @param turns            'right' (standard) or 'left'
 */
export function holdingEntry({ inboundCourseDeg, headingDeg, turns = 'right' }) {
  const beta = norm180(headingDeg - inboundCourseDeg);
  let entry, sectorNote;
  if (turns === 'right') {
    if (beta > -110 && beta < 70) entry = 'direct';
    else if (beta >= 70 && beta <= 180) entry = 'parallel';
    else entry = 'teardrop';
  } else {
    if (beta > -70 && beta < 110) entry = 'direct';
    else if (beta <= -70 && beta >= -180) entry = 'parallel';
    else entry = 'teardrop';
  }
  const outbound = norm360(inboundCourseDeg + 180);
  const holdingSideSign = turns === 'right' ? -1 : 1;  // teardrop offsets toward the holding side
  const boundaryDist = Math.min(
    Math.abs(norm180(beta - (turns === 'right' ? 70 : -70))),
    Math.abs(norm180(beta - (turns === 'right' ? -110 : 110))),
    Math.abs(norm180(beta - 180)),
  );
  if (boundaryDist <= 5) sectorNote = 'Within 5 degrees of a sector boundary — either adjacent entry is acceptable.';
  return {
    entry,
    relativeAngleDeg: beta,
    outboundCourseDeg: outbound,
    teardropHeadingDeg: norm360(outbound + holdingSideSign * 30),
    parallelHeadingDeg: outbound,
    fixEndTurnDeg: turns === 'right' ? 180 : -180,
    turns,
    boundaryNote: sectorNote || null,
    description: describeEntry(entry, turns, inboundCourseDeg, outbound, holdingSideSign),
  };
}

function describeEntry(entry, turns, inbound, outbound, sign) {
  const dir = turns === 'right' ? 'right' : 'left';
  const opp = turns === 'right' ? 'left' : 'right';
  switch (entry) {
    case 'direct':
      return `Cross the fix and turn ${dir} to the outbound heading ${fmt(outbound)}. Start timing abeam the fix (or wings level, whichever is later).`;
    case 'parallel':
      return `Cross the fix, turn ${opp} to parallel the inbound course outbound on ${fmt(outbound)} on the non-holding side, fly one minute, then turn ${opp} through more than 180 degrees to intercept the inbound course ${fmt(inbound)} or return direct to the fix.`;
    case 'teardrop':
      return `Cross the fix, turn to ${fmt(norm360(outbound + sign * 30))} (30 degrees offset into the holding side), fly one minute, then turn ${dir} to intercept the inbound course ${fmt(inbound)}.`;
    default:
      return '';
  }
}

const fmt = (d) => String(Math.round(norm360(d)) === 0 ? 360 : Math.round(norm360(d))).padStart(3, '0');

/**
 * Wind-corrected holding pattern: the drift correction to hold inbound, the
 * tripled correction outbound, and the outbound leg time that yields a
 * one-minute inbound leg.
 */
export function holdWindCorrection({ inboundCourseDeg, tasKt, windDirDeg, windSpeedKt, legTimeMin = 1, turns = 'right' }) {
  const relIn = norm180(windDirDeg - inboundCourseDeg);
  const wcaIn = asinD((windSpeedKt / tasKt) * sinD(relIn));
  const gsIn = tasKt * cosD(wcaIn) - windSpeedKt * cosD(relIn);
  const outboundCourse = norm360(inboundCourseDeg + 180);
  const relOut = norm180(windDirDeg - outboundCourse);
  const wcaOut = asinD((windSpeedKt / tasKt) * sinD(relOut));
  const gsOut = tasKt * cosD(wcaOut) - windSpeedKt * cosD(relOut);
  // Standard technique: triple the inbound drift correction on the outbound leg.
  const outboundHeading = norm360(outboundCourse - 3 * wcaIn);
  const legDistanceNm = gsIn * (legTimeMin / 60);
  const outboundTimeMin = gsOut > 0 ? (legDistanceNm / gsOut) * 60 : NaN;
  return {
    inboundHeadingDeg: norm360(inboundCourseDeg + wcaIn),
    inboundWcaDeg: wcaIn,
    inboundGsKt: gsIn,
    outboundCourseDeg: outboundCourse,
    outboundHeadingDeg: outboundHeading,
    outboundWcaDeg: -3 * wcaIn,
    outboundGsKt: gsOut,
    legDistanceNm,
    outboundTimeMin,
    outboundTimeSec: outboundTimeMin * 60,
    headwindInboundKt: windSpeedKt * cosD(relIn),
    crosswindKt: windSpeedKt * sinD(relIn),
    turns,
  };
}

/** Maximum holding airspeeds, AIM 5-3-8 (civil, United States). */
export const HOLDING_SPEED_LIMITS = [
  { maxAltFt: 6000, kias: 200, note: 'MHA through 6 000 ft MSL' },
  { maxAltFt: 14000, kias: 230, note: '6 001 through 14 000 ft MSL' },
  { maxAltFt: Infinity, kias: 265, note: 'Above 14 000 ft MSL' },
];

export function holdingSpeedLimit(altFt) {
  return HOLDING_SPEED_LIMITS.find((l) => altFt <= l.maxAltFt);
}

/** Standard leg timing: 1 minute at or below 14 000 ft, 1 1/2 minutes above. */
export function holdingLegTimeMin(altFt) {
  return altFt <= 14000 ? 1 : 1.5;
}

/** Airspace a hold needs: leg length plus the turn diameter. */
export function holdDimensions({ gsKt, legTimeMin, turnRadiusNm }) {
  const legNm = gsKt * (legTimeMin / 60);
  return {
    legLengthNm: legNm,
    widthNm: 2 * turnRadiusNm,
    lengthNm: legNm + 2 * turnRadiusNm,
  };
}
