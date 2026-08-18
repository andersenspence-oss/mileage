// sun.js — sunrise, sunset and civil twilight (NOAA solar position algorithm),
// plus the three different "night" definitions a pilot has to keep straight.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Julian day number for 00:00 UT of a calendar date. */
export function julianDay(year, month, day) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

function solarGeometry(jd) {
  const t = (jd - 2451545.0) / 36525.0;                       // Julian century
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * D2R) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * M * D2R) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const seconds = 21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const obliq = e0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(obliq * D2R) * Math.sin(appLong * D2R)) * R2D;
  const y = Math.tan((obliq / 2) * D2R) ** 2;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0 * D2R)
    - 2 * e * Math.sin(M * D2R)
    + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R)
    - 0.5 * y * y * Math.sin(4 * L0 * D2R)
    - 1.25 * e * e * Math.sin(2 * M * D2R));
  return { declDeg: decl, eqTimeMin: eqTime };
}

function hourAngle(latDeg, declDeg, zenithDeg) {
  const cosH = (Math.cos(zenithDeg * D2R) / (Math.cos(latDeg * D2R) * Math.cos(declDeg * D2R)))
    - Math.tan(latDeg * D2R) * Math.tan(declDeg * D2R);
  if (cosH > 1) return null;     // sun never rises to that altitude
  if (cosH < -1) return Infinity; // sun never sets below it
  return Math.acos(cosH) * R2D;
}

/**
 * Sun times for a date and position.
 * @param lonDeg east positive (so 111 W is -111)
 * @returns minutes after 00:00 UTC, or null / 'up' / 'down' for polar cases
 */
export function sunTimes({ year, month, day, latDeg, lonDeg }) {
  const jd = julianDay(year, month, day);
  const { declDeg, eqTimeMin } = solarGeometry(jd + 0.5);
  const solarNoon = 720 - 4 * lonDeg - eqTimeMin;
  const make = (zenith) => {
    const ha = hourAngle(latDeg, declDeg, zenith);
    if (ha === null) return { rise: null, set: null, state: 'never above' };
    if (ha === Infinity) return { rise: null, set: null, state: 'never below' };
    return { rise: solarNoon - 4 * ha, set: solarNoon + 4 * ha, state: 'normal' };
  };
  const official = make(90.833);      // upper limb + refraction
  const civil = make(96);             // civil twilight
  const nautical = make(102);
  const astronomical = make(108);
  return {
    declinationDeg: declDeg,
    equationOfTimeMin: eqTimeMin,
    solarNoonMinUtc: solarNoon,
    sunriseMinUtc: official.rise,
    sunsetMinUtc: official.set,
    state: official.state,
    civilDawnMinUtc: civil.rise,
    civilDuskMinUtc: civil.set,
    nauticalDawnMinUtc: nautical.rise,
    nauticalDuskMinUtc: nautical.set,
    astronomicalDawnMinUtc: astronomical.rise,
    astronomicalDuskMinUtc: astronomical.set,
    dayLengthMin: official.rise != null ? official.set - official.rise : null,
  };
}

/**
 * The three regulatory "nights", derived from the same solar times:
 *   91.209  position lights: sunset to sunrise
 *   1.1     night (loggable night time): end of evening civil twilight to
 *           the beginning of morning civil twilight
 *   61.57(b) night takeoff/landing currency: one hour after sunset to one
 *           hour before sunrise
 */
export function nightWindows(times) {
  const add = (m, d) => (m == null ? null : m + d);
  return {
    positionLights: { start: times.sunsetMinUtc, end: times.sunriseMinUtc, rule: '14 CFR 91.209 — position lights' },
    loggableNight: { start: times.civilDuskMinUtc, end: times.civilDawnMinUtc, rule: '14 CFR 1.1 — night' },
    currency: { start: add(times.sunsetMinUtc, 60), end: add(times.sunriseMinUtc, -60), rule: '14 CFR 61.57(b) — night currency' },
  };
}

/** Minutes-after-midnight (UTC) formatted as HH:MM with an optional UTC offset applied. */
export function formatClock(minUtc, offsetHours = 0) {
  if (minUtc == null || !Number.isFinite(minUtc)) return '—';
  let m = Math.round(minUtc + offsetHours * 60);
  let dayShift = 0;
  while (m < 0) { m += 1440; dayShift -= 1; }
  while (m >= 1440) { m -= 1440; dayShift += 1; }
  const h = Math.floor(m / 60), mm = m % 60;
  const suffix = dayShift === 0 ? '' : dayShift > 0 ? ' (+1 day)' : ' (−1 day)';
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}${suffix}`;
}
