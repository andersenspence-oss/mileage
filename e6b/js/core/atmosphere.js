// atmosphere.js — ICAO Standard Atmosphere and the altimetry / temperature
// relationships every E6B problem is built on.
//
// References:
//   ICAO Doc 7488 / U.S. Standard Atmosphere 1976 (troposphere + lower stratosphere)
//   FAA-H-8083-25 (Pilot's Handbook of Aeronautical Knowledge), Ch. 4 & 12
//
// Sign conventions: altitudes in feet, temperatures in degrees Celsius,
// pressures in inches of mercury unless a name says otherwise.

export const ISA = {
  T0_C: 15,
  T0_K: 288.15,
  P0_INHG: 29.921258,       // 1013.25 hPa expressed in inHg
  P0_HPA: 1013.25,
  RHO0_KGM3: 1.225,
  RHO0_SLUG: 0.00237689,
  LAPSE_C_PER_FT: 0.0019812,      // 6.5 degC/km, exactly, on the international foot
  LAPSE_C_PER_1000FT: 1.9812,
  TROPOPAUSE_FT: 36089.24,        // 11 000 m
  TROPOPAUSE_T_C: -56.5,
  G: 9.80665,
  R: 287.05287,
  GAMMA: 1.4,
  A0_KT: 661.4788,                // speed of sound at ISA sea level
  EXP: 5.2558797,                 // g / (L R)
  INV_EXP: 1 / 5.2558797,
  K: 0.0019812 / 288.15,          // 6.87559e-6 per foot
  H_SCALE_FT: 20805.8,            // stratospheric scale height, R*T/g at 216.65 K
};

const K = ISA.K;

/** ISA temperature (degC) at a pressure altitude, flat above the tropopause. */
export function isaTempC(altFt) {
  if (!Number.isFinite(altFt)) return NaN;
  return altFt <= ISA.TROPOPAUSE_FT
    ? ISA.T0_C - ISA.LAPSE_C_PER_FT * altFt
    : ISA.TROPOPAUSE_T_C;
}

/** How far the actual temperature sits above (+) or below (-) standard. */
export function isaDeviationC(altFt, oatC) {
  return oatC - isaTempC(altFt);
}

/** Pressure ratio delta = P / P0 at a pressure altitude. */
export function pressureRatio(paFt) {
  if (!Number.isFinite(paFt)) return NaN;
  if (paFt <= ISA.TROPOPAUSE_FT) return Math.pow(1 - K * paFt, ISA.EXP);
  const dTrop = Math.pow(1 - K * ISA.TROPOPAUSE_FT, ISA.EXP);
  return dTrop * Math.exp(-(paFt - ISA.TROPOPAUSE_FT) / ISA.H_SCALE_FT);
}

/** Static pressure (inHg) at a pressure altitude. */
export function pressureInHg(paFt) {
  return ISA.P0_INHG * pressureRatio(paFt);
}

/** Static pressure (hPa) at a pressure altitude. */
export function pressureHpa(paFt) {
  return ISA.P0_HPA * pressureRatio(paFt);
}

/** Pressure altitude (ft) for a measured static/station pressure in inHg. */
export function pressureAltFromInHg(inHg) {
  if (!Number.isFinite(inHg) || inHg <= 0) return NaN;
  const delta = inHg / ISA.P0_INHG;
  const dTrop = Math.pow(1 - K * ISA.TROPOPAUSE_FT, ISA.EXP);
  if (delta >= dTrop) return (1 - Math.pow(delta, ISA.INV_EXP)) / K;
  return ISA.TROPOPAUSE_FT - ISA.H_SCALE_FT * Math.log(delta / dTrop);
}

export function pressureAltFromHpa(hPa) {
  return pressureAltFromInHg(hPa * ISA.P0_INHG / ISA.P0_HPA);
}

/**
 * Pressure altitude from an indicated altitude and altimeter setting.
 *
 * mode 'faa'   — the (29.92 - setting) x 1000 ft rule taught by the FAA and used
 *                by the answer keys on the airman knowledge test.
 * mode 'exact' — solves the ISA barometric equation for the altimeter's real
 *                behaviour (about 925 ft per inHg near sea level).
 */
export function pressureAltitude(indicatedAltFt, altimeterInHg, mode = 'faa') {
  if (!Number.isFinite(indicatedAltFt) || !Number.isFinite(altimeterInHg)) return NaN;
  // The FAA rule uses the rounded 29.92 datum, and so do the answer keys.
  if (mode === 'faa') return indicatedAltFt + (29.92 - altimeterInHg) * 1000;
  // The instrument shows the altitude whose ISA pressure, referenced to the set
  // datum, equals the sensed static pressure. Recover that static pressure, then
  // read it back on the 29.92 scale.
  const staticP = altimeterInHg * Math.pow(1 - K * indicatedAltFt, ISA.EXP);
  return pressureAltFromInHg(staticP);
}

/** Temperature ratio theta = T / T0. */
export function temperatureRatio(oatC) {
  return (oatC + 273.15) / ISA.T0_K;
}

/** Density ratio sigma = rho / rho0 at a pressure altitude and temperature. */
export function densityRatio(paFt, oatC) {
  return pressureRatio(paFt) / temperatureRatio(oatC);
}

/** Air density in kg/m^3. */
export function densityKgM3(paFt, oatC) {
  return ISA.RHO0_KGM3 * densityRatio(paFt, oatC);
}

/** Air density in slugs/ft^3. */
export function densitySlugFt3(paFt, oatC) {
  return ISA.RHO0_SLUG * densityRatio(paFt, oatC);
}

/**
 * Density altitude (ft): the ISA altitude with the same air density.
 * This is the exact relation the FAA density-altitude chart is drawn from.
 */
export function densityAltitude(paFt, oatC) {
  const sigma = densityRatio(paFt, oatC);
  if (!Number.isFinite(sigma) || sigma <= 0) return NaN;
  // sigma = (1 - K h)^(EXP - 1)  in the troposphere
  return (1 - Math.pow(sigma, 1 / (ISA.EXP - 1))) / K;
}

/** The classroom approximation: DA = PA + 118.8 ft per degC above standard. */
export function densityAltitudeRuleOfThumb(paFt, oatC) {
  return paFt + 118.8 * isaDeviationC(paFt, oatC);
}

/** Speed of sound (kt) for a static air temperature. */
export function speedOfSoundKt(oatC) {
  const tK = oatC + 273.15;
  if (!(tK > 0)) return NaN;
  return ISA.A0_KT * Math.sqrt(tK / ISA.T0_K);
}

/**
 * True altitude from indicated altitude when the column is non-standard.
 * FAA rule of thumb: 4 ft per degC of ISA deviation per 1 000 ft above the
 * altimeter setting source (normally the airport elevation).
 */
export function trueAltitude(indicatedAltFt, stationElevFt, oatC, altimeterInHg) {
  const pa = pressureAltitude(indicatedAltFt, altimeterInHg, 'faa');
  const dev = isaDeviationC(pa, oatC);
  const above = indicatedAltFt - stationElevFt;
  return indicatedAltFt + 4 * dev * (above / 1000);
}

/** Absolute (AGL) altitude given a true altitude and terrain elevation. */
export function absoluteAltitude(trueAltFt, terrainElevFt) {
  return trueAltFt - terrainElevFt;
}

/**
 * Altimeter setting (QNH, inHg) from station pressure and field elevation.
 * This is the standard NWS/ICAO reduction.
 */
export function altimeterSettingFromStation(stationInHg, fieldElevFt) {
  const p = Math.pow(stationInHg, ISA.INV_EXP) + K * fieldElevFt * Math.pow(ISA.P0_INHG, ISA.INV_EXP);
  return Math.pow(p, ISA.EXP);
}

/** Station pressure (inHg) from altimeter setting and field elevation. */
export function stationPressureFromAltimeter(altimeterInHg, fieldElevFt) {
  const p = Math.pow(altimeterInHg, ISA.INV_EXP) - K * fieldElevFt * Math.pow(ISA.P0_INHG, ISA.INV_EXP);
  return Math.pow(p, ISA.EXP);
}

// ---------------------------------------------------------------------------
// Moisture

/** Saturation vapour pressure (hPa) over water, Magnus-Tetens (Bolton 1980). */
export function saturationVaporHpa(tC) {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/** Relative humidity (%) from temperature and dewpoint. */
export function relativeHumidity(tC, dewC) {
  return 100 * saturationVaporHpa(dewC) / saturationVaporHpa(tC);
}

/** Dewpoint (degC) from temperature and relative humidity (%). */
export function dewpointFromRH(tC, rhPct) {
  const e = (rhPct / 100) * saturationVaporHpa(tC);
  const ln = Math.log(e / 6.112);
  return (243.5 * ln) / (17.67 - ln);
}

/**
 * Convective cloud base height AGL.
 * FAA method: the spread closes at 2.5 degC (4.4 degF) per 1 000 ft.
 */
export function cloudBaseAglFt(tempC, dewC) {
  return ((tempC - dewC) / 2.5) * 1000;
}

/** Temperature at the cloud base, using the dry adiabatic lapse rate (3 degC/1000 ft). */
export function cloudBaseTempC(tempC, dewC) {
  const base = cloudBaseAglFt(tempC, dewC);
  return tempC - 3.0 * (base / 1000);
}

/**
 * Density altitude with humidity taken into account (virtual temperature).
 * Not needed for the knowledge test, but it is the physically correct answer
 * and it is what a hot, humid summer takeoff actually feels like.
 */
export function densityAltitudeHumid(paFt, oatC, dewC) {
  const pHpa = pressureHpa(paFt);
  const e = saturationVaporHpa(dewC);              // actual vapour pressure
  const tK = oatC + 273.15;
  // Virtual temperature: Tv = T / (1 - (e/p)(1 - eps)), eps = 0.622
  const tvK = tK / (1 - (e / pHpa) * (1 - 0.62198));
  return densityAltitude(paFt, tvK - 273.15);
}

/** A row of the standard atmosphere table. */
export function standardAtmosphereRow(altFt) {
  const t = isaTempC(altFt);
  const d = pressureRatio(altFt);
  const th = temperatureRatio(t);
  const s = d / th;
  return {
    altFt,
    tempC: t,
    tempF: t * 9 / 5 + 32,
    pressureInHg: ISA.P0_INHG * d,
    pressureHpa: ISA.P0_HPA * d,
    pressureRatio: d,
    densityRatio: s,
    densityKgM3: ISA.RHO0_KGM3 * s,
    speedOfSoundKt: speedOfSoundKt(t),
    sqrtSigma: Math.sqrt(s),
    tasFactor: 1 / Math.sqrt(s),
  };
}
