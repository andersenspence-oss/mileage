// nav.js — time/speed/distance, heading conversions, great-circle work, and the
// endurance problems (point of no return, equal-time point, radius of action).

import { sinD, cosD, asinD, atan2D, norm360, norm180, D2R, R2D, FT_PER_NM } from './units.js';

// ---------------------------------------------------------------------------
// Time - Speed - Distance. Give any two, get the third.

export function solveTSD({ speedKt, timeMin, distanceNm }) {
  const have = [speedKt, timeMin, distanceNm].filter(Number.isFinite).length;
  if (have < 2) return { solved: null };
  if (!Number.isFinite(distanceNm)) {
    return { solved: 'distance', speedKt, timeMin, distanceNm: speedKt * (timeMin / 60) };
  }
  if (!Number.isFinite(timeMin)) {
    return { solved: 'time', speedKt, distanceNm, timeMin: (distanceNm / speedKt) * 60 };
  }
  if (!Number.isFinite(speedKt)) {
    return { solved: 'speed', timeMin, distanceNm, speedKt: distanceNm / (timeMin / 60) };
  }
  // All three given: recompute time so an inconsistency is visible.
  return { solved: 'check', speedKt, timeMin, distanceNm, checkTimeMin: (distanceNm / speedKt) * 60 };
}

// ---------------------------------------------------------------------------
// True / magnetic / compass.
// Variation is signed: EAST positive, WEST negative ("east is least, west is best"
// falls out of the arithmetic below). Deviation follows the same sign rule.

export function trueToMagnetic(trueDeg, variationDeg) {
  return norm360(trueDeg - variationDeg);
}
export function magneticToTrue(magDeg, variationDeg) {
  return norm360(magDeg + variationDeg);
}
export function magneticToCompass(magDeg, deviationDeg) {
  return norm360(magDeg - deviationDeg);
}
export function compassToMagnetic(compassDeg, deviationDeg) {
  return norm360(compassDeg + deviationDeg);
}

/** Full chain: true course -> compass heading, with the wind correction in between. */
export function headingChain({ trueCourseDeg, wcaDeg = 0, variationDeg = 0, deviationDeg = 0 }) {
  const th = norm360(trueCourseDeg + wcaDeg);
  const mh = trueToMagnetic(th, variationDeg);
  const ch = magneticToCompass(mh, deviationDeg);
  return {
    trueCourseDeg: norm360(trueCourseDeg),
    trueHeadingDeg: th,
    magneticHeadingDeg: mh,
    compassHeadingDeg: ch,
    magneticCourseDeg: trueToMagnetic(trueCourseDeg, variationDeg),
  };
}

// ---------------------------------------------------------------------------
// Off-course corrections (the 1-in-60 rule).

/**
 * You are off course by `offCourseNm` after flying `flownNm`, with `remainingNm`
 * still to run. Returns the heading change to parallel the course, and the
 * larger change that puts you over the destination.
 */
export function offCourseCorrection({ offCourseNm, flownNm, remainingNm }) {
  const trackError = 60 * (offCourseNm / flownNm);
  const closing = 60 * (offCourseNm / remainingNm);
  return {
    trackErrorDeg: trackError,
    closingAngleDeg: closing,
    totalCorrectionDeg: trackError + closing,
  };
}

/** 1-in-60: a 1 NM offset at 60 NM is 1 degree of angle. */
export function oneInSixty({ offsetNm, distanceNm }) {
  return 60 * (offsetNm / distanceNm);
}

// ---------------------------------------------------------------------------
// Endurance problems.

/**
 * Point of no return: the farthest point from which you can still return to the
 * departure field with the fuel aboard.
 *   t_out = E * GS_back / (GS_out + GS_back)
 */
export function pointOfNoReturn({ enduranceMin, gsOutKt, gsBackKt }) {
  const t = enduranceMin * (gsBackKt / (gsOutKt + gsBackKt));
  return {
    timeToPnrMin: t,
    distanceToPnrNm: gsOutKt * (t / 60),
    timeBackMin: enduranceMin - t,
  };
}

/**
 * Equal time point (critical point) between two airfields a known distance apart:
 * the point from which the time to continue equals the time to return.
 *   d = D * GS_back / (GS_on + GS_back)
 */
export function equalTimePoint({ distanceNm, gsOnKt, gsBackKt }) {
  const d = distanceNm * (gsBackKt / (gsOnKt + gsBackKt));
  return {
    distanceToEtpNm: d,
    timeToEtpMin: (d / gsOnKt) * 60,
    timeOnFromEtpMin: ((distanceNm - d) / gsOnKt) * 60,
    timeBackFromEtpMin: (d / gsBackKt) * 60,
  };
}

/**
 * Radius of action from a moving base (a carrier, or a field you will reach on
 * a different leg). `separationNm` is how far the base moves away along the
 * return track during the sortie; leave it 0 for a fixed base.
 */
export function radiusOfAction({ enduranceMin, gsOutKt, gsBackKt, separationNm = 0 }) {
  const e = enduranceMin / 60;
  const radius = (gsOutKt * gsBackKt * e - gsOutKt * separationNm) / (gsOutKt + gsBackKt);
  return {
    radiusNm: radius,
    timeOutMin: (radius / gsOutKt) * 60,
    timeBackMin: enduranceMin - (radius / gsOutKt) * 60,
  };
}

// ---------------------------------------------------------------------------
// Great-circle and rhumb-line geometry on a sphere of 3440.065 NM radius
// (the mean Earth radius, 6371.0088 km).

export const EARTH_RADIUS_NM = 6371008.8 / 1852;

/** Great-circle distance in NM between two lat/lon points (haversine). */
export function gcDistanceNm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle course (true degrees) from point 1 to point 2. */
export function gcInitialBearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) * R2D);
}

/** Course at arrival (true degrees). */
export function gcFinalBearing(lat1, lon1, lat2, lon2) {
  return norm360(gcInitialBearing(lat2, lon2, lat1, lon1) + 180);
}

/** Point reached by flying `distNm` along a great circle on `bearingDeg`. */
export function gcDestination(lat1, lon1, bearingDeg, distNm) {
  const d = distNm / EARTH_RADIUS_NM;
  const p1 = lat1 * D2R, l1 = lon1 * D2R, b = bearingDeg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1),
    Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: norm180(l2 * R2D) };
}

/** Signed cross-track distance (NM) of a point from the A->B great circle. */
export function crossTrackNm(latA, lonA, latB, lonB, latP, lonP) {
  const d13 = gcDistanceNm(latA, lonA, latP, lonP) / EARTH_RADIUS_NM;
  const b13 = gcInitialBearing(latA, lonA, latP, lonP) * D2R;
  const b12 = gcInitialBearing(latA, lonA, latB, lonB) * D2R;
  return Math.asin(Math.sin(d13) * Math.sin(b13 - b12)) * EARTH_RADIUS_NM;
}

/** Rhumb-line (constant-heading) distance and course. */
export function rhumbLine(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R;
  let dLon = (lon2 - lon1) * D2R;
  const dPhi = Math.log(Math.tan(p2 / 2 + Math.PI / 4) / Math.tan(p1 / 2 + Math.PI / 4));
  const q = Math.abs(dPhi) > 1e-12 ? (p2 - p1) / dPhi : Math.cos(p1);
  if (Math.abs(dLon) > Math.PI) dLon = dLon > 0 ? dLon - 2 * Math.PI : dLon + 2 * Math.PI;
  const dist = Math.hypot(p2 - p1, q * dLon) * EARTH_RADIUS_NM;
  return { distanceNm: dist, courseDeg: norm360(Math.atan2(dLon, dPhi) * R2D) };
}

/** Parse 4030N/11215W, 40 30.5 N, or a signed decimal degree into decimal degrees. */
export function parseLatLon(text, isLon = false) {
  if (text == null) return NaN;
  const s = String(text).trim().toUpperCase().replace(/[°'"]/g, ' ').replace(/,/g, ' ');
  if (s === '') return NaN;
  const hemi = /[NSEW]/.exec(s);
  const sign = hemi && (hemi[0] === 'S' || hemi[0] === 'W') ? -1 : 1;
  const body = s.replace(/[NSEW]/g, ' ').trim();
  // Packed forms: DDMM / DDMMSS (longitude allows a leading three-digit degree).
  if (/^\d+$/.test(body) && hemi) {
    const degDigits = isLon || body.length % 2 === 1 ? 3 : 2;
    if (body.length >= degDigits + 2) {
      const d = Number(body.slice(0, degDigits));
      const m = Number(body.slice(degDigits, degDigits + 2));
      const sec = body.length > degDigits + 2 ? Number(body.slice(degDigits + 2)) : 0;
      return sign * (d + m / 60 + sec / 3600);
    }
  }
  const parts = body.split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  if (!parts.length) return NaN;
  const mag = Math.abs(parts[0]) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  return (parts[0] < 0 ? -1 : sign) * mag;
}

/** Decimal degrees -> "40°30.5'N". */
export function formatLatLon(deg, isLon = false) {
  if (!Number.isFinite(deg)) return '—';
  const hemi = isLon ? (deg < 0 ? 'W' : 'E') : (deg < 0 ? 'S' : 'N');
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${d}°${m.toFixed(1)}'${hemi}`;
}

// ---------------------------------------------------------------------------
// Distance to the horizon / line-of-sight radio range.

/**
 * Geometric (visual) horizon in NM: sqrt(2 R h) with R = 3440.065 NM,
 * which works out to 1.064 sqrt(h_ft) NM — the same thing as the familiar
 * 1.22 sqrt(h) statute miles.
 */
export function visualHorizonNm(heightFt) {
  return Math.sqrt(Math.max(0, heightFt) * 2 * EARTH_RADIUS_NM / FT_PER_NM);
}

/**
 * Radio horizon in NM using the standard 4/3-Earth refraction model:
 * d = 1.23 sqrt(h_ft), the figure in the AIM for VHF line of sight.
 */
export function radioHorizonNm(heightFt) {
  return 1.23 * Math.sqrt(Math.max(0, heightFt));
}

/** VHF line-of-sight range in NM between an aircraft and a ground station. */
export function lineOfSightNm(aircraftAltFt, stationElevFt = 0) {
  return radioHorizonNm(aircraftAltFt) + radioHorizonNm(stationElevFt);
}

/** Convert a distance across the ground into arc minutes of latitude. */
export function nmPerDegreeLongitude(latDeg) {
  return 60 * cosD(latDeg);
}

/** VOR course-width: how wide one degree of radial is at a given distance. */
export function radialWidthNm(distanceNm, degrees = 1) {
  return 2 * distanceNm * Math.tan((degrees / 2) * D2R);
}

/** Convert a slant range (DME) to ground distance given the height above the station. */
export function dmeGroundDistanceNm(slantNm, altAboveStationFt) {
  const h = altAboveStationFt / FT_PER_NM;
  const g = slantNm * slantNm - h * h;
  return g > 0 ? Math.sqrt(g) : 0;
}

export { sinD, cosD, asinD, atan2D, norm360, norm180 };
