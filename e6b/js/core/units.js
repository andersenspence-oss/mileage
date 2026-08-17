// units.js — exact conversion factors and unit registry.
// All factors are the internationally defined exact values where one exists.
// Base units used internally: foot (length/alt), knot (speed), pound (weight),
// US gallon (volume), inHg (pressure), Celsius (temperature), minute (time).

export const EXACT = {
  M_PER_FT: 0.3048,          // exact, international foot
  M_PER_NM: 1852,            // exact, international nautical mile
  M_PER_SM: 1609.344,        // exact, international statute mile
  KG_PER_LB: 0.45359237,     // exact
  L_PER_USGAL: 3.785411784,  // exact
  L_PER_IMPGAL: 4.54609,     // exact
  PA_PER_INHG: 3386.389,     // inHg at 0 degC, standard gravity
  PA_PER_PSI: 6894.757293168,
  PA_PER_HPA: 100,
};

export const FT_PER_NM = EXACT.M_PER_NM / EXACT.M_PER_FT;   // 6076.11548556...
export const FT_PER_SM = EXACT.M_PER_SM / EXACT.M_PER_FT;   // 5280 exactly
export const NM_PER_SM = EXACT.M_PER_SM / EXACT.M_PER_NM;   // 0.8689762...
export const SM_PER_NM = EXACT.M_PER_NM / EXACT.M_PER_SM;   // 1.1507794...

// ---------------------------------------------------------------------------
// Length / distance. Base: foot.
export const LENGTH = {
  ft: 1,
  m: 1 / EXACT.M_PER_FT,
  km: 1000 / EXACT.M_PER_FT,
  NM: FT_PER_NM,
  SM: FT_PER_SM,
  in: 1 / 12,
  cm: 0.01 / EXACT.M_PER_FT,
  mi: FT_PER_SM,
  yd: 3,
};

// Speed. Base: knot.
export const SPEED = {
  kt: 1,
  mph: NM_PER_SM,                       // 1 mph = 0.868976 kt
  'km/h': 1000 / EXACT.M_PER_NM,        // 0.539957 kt
  'm/s': 3600 / EXACT.M_PER_NM,         // 1.943844 kt
  'ft/min': 60 / FT_PER_NM,             // 0.00987473 kt
  'ft/s': 3600 / FT_PER_NM,             // 0.592484 kt
};

// Weight / mass. Base: pound.
export const WEIGHT = {
  lb: 1,
  kg: 1 / EXACT.KG_PER_LB,
  g: 0.001 / EXACT.KG_PER_LB,
  oz: 1 / 16,
  ton: 2000,
  tonne: 1000 / EXACT.KG_PER_LB,
};

// Volume. Base: US gallon.
export const VOLUME = {
  gal: 1,
  L: 1 / EXACT.L_PER_USGAL,
  qt: 0.25,
  pt: 0.125,
  'imp gal': EXACT.L_PER_IMPGAL / EXACT.L_PER_USGAL,
  mL: 0.001 / EXACT.L_PER_USGAL,
  'cu ft': 7.480519480519481,
};

// Pressure. Base: inHg.
export const PRESSURE = {
  inHg: 1,
  hPa: EXACT.PA_PER_HPA / EXACT.PA_PER_INHG,
  mb: EXACT.PA_PER_HPA / EXACT.PA_PER_INHG,   // 1 mb == 1 hPa exactly
  psi: EXACT.PA_PER_PSI / EXACT.PA_PER_INHG,
  mmHg: 25.4,                                  // 1 inHg = 25.4 mmHg exactly
  Pa: 1 / EXACT.PA_PER_INHG,
  kPa: 1000 / EXACT.PA_PER_INHG,
};

// Time. Base: minute.
export const TIME = {
  min: 1,
  sec: 1 / 60,
  hr: 60,
  days: 1440,
};

// Fuel weights, pounds per US gallon.
// FAA figures (Pilot's Handbook / W&B Handbook, used on the knowledge test).
export const FUEL_LB_PER_GAL = {
  'Avgas 100LL': 6.0,
  'Jet A': 6.7,
  'Jet A-1': 6.7,
  'JP-4': 6.5,
  'JP-5': 6.8,
  'Auto gas': 6.0,
  Oil: 7.5,
  Water: 8.345,
};

export function convert(value, from, to, table) {
  if (!Number.isFinite(value)) return NaN;
  const f = table[from], t = table[to];
  if (f === undefined || t === undefined) throw new Error(`unknown unit ${from}/${to}`);
  return (value * f) / t;
}

// Temperature needs offsets, so it gets its own helpers.
export const TEMP_UNITS = ['C', 'F', 'K', 'R'];
export function tempToC(v, unit) {
  switch (unit) {
    case 'C': return v;
    case 'F': return (v - 32) * 5 / 9;
    case 'K': return v - 273.15;
    case 'R': return v * 5 / 9 - 273.15;
    default: throw new Error('unknown temp unit ' + unit);
  }
}
export function tempFromC(c, unit) {
  switch (unit) {
    case 'C': return c;
    case 'F': return c * 9 / 5 + 32;
    case 'K': return c + 273.15;
    case 'R': return (c + 273.15) * 9 / 5;
    default: throw new Error('unknown temp unit ' + unit);
  }
}

// ---------------------------------------------------------------------------
// Angle helpers used all over the wind/nav math.
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const sinD = (d) => Math.sin(d * D2R);
export const cosD = (d) => Math.cos(d * D2R);
export const tanD = (d) => Math.tan(d * D2R);
export const asinD = (x) => Math.asin(Math.max(-1, Math.min(1, x))) * R2D;
export const acosD = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * R2D;
export const atan2D = (y, x) => Math.atan2(y, x) * R2D;

/** Normalize a compass direction into [0, 360). 360 is reported as 360 only by callers that want it. */
export function norm360(deg) {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Normalize an angular difference into (-180, +180]. */
export function norm180(deg) {
  let d = norm360(deg);
  if (d > 180) d -= 360;
  return d;
}

/** Compass label for a heading, e.g. 247 -> "WSW". */
export function compassPoint(deg) {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round(norm360(deg) / 22.5) % 16];
}

/** Minutes -> "H:MM:SS" (or "MM:SS" under an hour). */
export function hms(minutes, { forceHours = false } = {}) {
  if (!Number.isFinite(minutes)) return '—';
  const neg = minutes < 0;
  let total = Math.round(Math.abs(minutes) * 60); // seconds
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  const out = (h > 0 || forceHours) ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
  return (neg ? '-' : '') + out;
}

/** Minutes -> "1+23" clock-style flight-plan format (hours + minutes). */
export function hhmm(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const neg = minutes < 0;
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${neg ? '-' : ''}${h}+${String(m).padStart(2, '0')}`;
}

/** Round to a fixed number of decimals, returning a number (not a string). */
export function round(v, d = 0) {
  if (!Number.isFinite(v)) return NaN;
  const f = Math.pow(10, d);
  return Math.round((v + Number.EPSILON * Math.sign(v) * Math.abs(v)) * f) / f;
}
