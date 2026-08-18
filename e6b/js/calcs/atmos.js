// calcs/atmos.js — altimetry, temperature and moisture.

import * as ATM from '../core/atmosphere.js';
import { fmt } from '../ui.js';

export const ATMOS_CALCS = [
  {
    id: 'pa-da',
    cat: 'Atmosphere',
    name: 'Pressure & density altitude',
    blurb: 'The two altitudes performance actually depends on.',
    keywords: 'find pressure altitude density altitude airport field elevation altimeter setting barometric performance takeoff',
    fields: [
      { k: 'elev', label: 'Field elevation / altitude', kind: 'altitude', def: 2941 },
      { k: 'baro', label: 'Altimeter setting', kind: 'pressure', def: 30.05 },
      { k: 'oat', label: 'Temperature', kind: 'temp', def: 35 },
      { k: 'dew', label: 'Dewpoint (optional)', kind: 'temp', def: '' },
    ],
    compute(v) {
      const pa = ATM.pressureAltitude(v.elev, v.baro);
      const paExact = ATM.pressureAltitude(v.elev, v.baro, 'exact');
      const da = ATM.densityAltitude(pa, v.oat);
      const isa = ATM.isaTempC(pa);
      const dev = v.oat - isa;
      const sec = [
        { label: 'ISA temperature here', value: isa, unit: '°C', decimals: 1 },
        { label: 'ISA deviation', text: `${dev >= 0 ? '+' : ''}${fmt(dev, 1)} °C` },
        { label: 'Density altitude above the field', value: da - v.elev, unit: 'ft', decimals: 0 },
        { label: 'Density ratio σ', value: ATM.densityRatio(pa, v.oat), decimals: 4 },
        { label: 'Rule-of-thumb DA (118.8 ft/°C)', value: ATM.densityAltitudeRuleOfThumb(pa, v.oat), unit: 'ft', decimals: 0 },
        { label: 'Exact barometric pressure altitude', value: paExact, unit: 'ft', decimals: 0 },
        { label: 'Station pressure', text: `${fmt(ATM.stationPressureFromAltimeter(v.baro, v.elev), 2)} inHg` },
      ];
      if (Number.isFinite(v.dew)) {
        const humid = ATM.densityAltitudeHumid(pa, v.oat, v.dew);
        sec.splice(3, 0, { label: 'Density altitude allowing for humidity', value: humid, unit: 'ft', decimals: 0, emph: true });
        sec.splice(4, 0, { label: 'Humidity penalty', value: humid - da, unit: 'ft', decimals: 0 });
      }
      const warn = [];
      if (da > 8000) warn.push(`Density altitude over 8 000 ft: expect a marked loss of climb performance and a long ground roll.`);
      return {
        primary: [
          { label: 'Density altitude', value: da, unit: 'ft', decimals: 0 },
          { label: 'Pressure altitude', value: pa, unit: 'ft', decimals: 0 },
        ],
        secondary: sec,
        warn,
        work: [
          `PA = ${fmt(v.elev, 0)} + (29.92 − ${fmt(v.baro, 2)}) × 1000 = <b>${fmt(pa, 0)} ft</b>`,
          `ISA at ${fmt(pa, 0)} ft = 15 − 1.98 × ${fmt(pa / 1000, 2)} = ${fmt(isa, 1)} °C, so the day is ${fmt(Math.abs(dev), 1)} °C ${dev >= 0 ? 'warmer' : 'colder'} than standard`,
          `σ = δ/θ = ${fmt(ATM.pressureRatio(pa), 4)} ÷ ${fmt(ATM.temperatureRatio(v.oat), 4)} = ${fmt(ATM.densityRatio(pa, v.oat), 4)}`,
          `DA = the standard altitude with that density = <b>${fmt(da, 0)} ft</b>`,
        ],
        notes: [
          'Pressure altitude uses the FAA rule (1 000 ft per inch of mercury) because that is what the knowledge-test answer keys use. Density altitude is computed exactly, matching the FAA density-altitude chart rather than the 118.8 ft/°C shortcut.',
          'On a multiple-choice question, pick the answer <b>closest</b> to this result. Different E6B devices round the intermediate steps differently, so keyed answers can sit 20–40 ft away from the exact figure — the choices are always spaced far enough apart that the closest one is the keyed one.',
        ],
      };
    },
  },

  {
    id: 'isa',
    cat: 'Atmosphere',
    name: 'Standard atmosphere & ISA deviation',
    blurb: 'Temperature, pressure and density at any altitude.',
    keywords: 'isa standard atmosphere deviation lapse rate temperature pressure ratio delta theta sigma',
    fields: [
      { k: 'alt', label: 'Pressure altitude', kind: 'altitude', def: 10000 },
      { k: 'oat', label: 'Actual temperature (optional)', kind: 'temp', def: '' },
    ],
    compute(v) {
      const row = ATM.standardAtmosphereRow(v.alt);
      const sec = [
        { label: 'Standard pressure', text: `${fmt(row.pressureInHg, 2)} inHg · ${fmt(row.pressureHpa, 1)} hPa` },
        { label: 'Pressure ratio δ', value: row.pressureRatio, decimals: 4 },
        { label: 'Density ratio σ', value: row.densityRatio, decimals: 4 },
        { label: 'Air density', text: `${fmt(row.densityKgM3, 4)} kg/m³` },
        { label: 'Speed of sound', value: row.speedOfSoundKt, unit: 'kt', decimals: 1 },
        { label: 'TAS / CAS factor', text: `× ${fmt(row.tasFactor, 4)}` },
      ];
      if (Number.isFinite(v.oat)) {
        const dev = v.oat - row.tempC;
        sec.unshift({ label: 'ISA deviation', text: `${dev >= 0 ? '+' : ''}${fmt(dev, 1)} °C (ISA${dev >= 0 ? '+' : '−'}${fmt(Math.abs(dev), 0)})`, emph: true });
        sec.push({ label: 'Density altitude at the actual temperature', value: ATM.densityAltitude(v.alt, v.oat), unit: 'ft', decimals: 0 });
      }
      return {
        primary: [
          { label: 'Standard temperature', value: row.tempC, unit: '°C', decimals: 1, hint: `${fmt(row.tempF, 1)} °F` },
        ],
        secondary: sec,
        work: [
          v.alt <= 36089
            ? `T = 15 − 1.9812 °C per 1 000 ft × ${fmt(v.alt / 1000, 2)} = ${fmt(row.tempC, 1)} °C`
            : 'Above the tropopause (36 089 ft) the standard temperature is a constant −56.5 °C.',
          `δ = (1 − 6.8756×10⁻⁶ h)^5.2559 = ${fmt(row.pressureRatio, 4)}`,
        ],
        notes: ['The standard lapse rate is 1.98 °C per 1 000 ft (2 °C for mental arithmetic) up to 36 089 ft.'],
      };
    },
  },

  {
    id: 'true-altitude',
    cat: 'Atmosphere',
    name: 'True altitude & cold-weather correction',
    blurb: 'What the altimeter really means on a cold day.',
    keywords: 'true altitude cold weather correction temperature error indicated absolute terrain icao',
    fields: [
      { k: 'ind', label: 'Indicated altitude', kind: 'altitude', def: 8000 },
      { k: 'elev', label: 'Altimeter source elevation', kind: 'altitude', def: 4500, hint: 'usually the airport' },
      { k: 'oat', label: 'Temperature at altitude', kind: 'temp', def: -15 },
      { k: 'baro', label: 'Altimeter setting', kind: 'pressure', def: 29.92 },
      { k: 'terrain', label: 'Terrain / obstacle elevation', kind: 'altitude', def: 6000 },
    ],
    compute(v) {
      const pa = ATM.pressureAltitude(v.ind, v.baro);
      const dev = ATM.isaDeviationC(pa, v.oat);
      const ta = ATM.trueAltitude(v.ind, v.elev, v.oat, v.baro);
      const correction = ta - v.ind;
      const warn = [];
      if (correction < -100) {
        warn.push(`You are about ${fmt(-correction, 0)} ft LOWER than the altimeter shows. On an instrument approach in these temperatures, altitudes must be corrected upward.`);
      }
      return {
        primary: [
          { label: 'True altitude', value: ta, unit: 'ft', decimals: 0 },
          { label: 'Correction', text: `${correction >= 0 ? '+' : '−'}${fmt(Math.abs(correction), 0)} ft` },
        ],
        secondary: [
          { label: 'Pressure altitude', value: pa, unit: 'ft', decimals: 0 },
          { label: 'ISA deviation', text: `${dev >= 0 ? '+' : ''}${fmt(dev, 1)} °C` },
          { label: 'Height above the source', value: v.ind - v.elev, unit: 'ft', decimals: 0 },
          { label: 'True height above the terrain', value: ta - v.terrain, unit: 'ft', decimals: 0, emph: true },
          { label: 'Indicated height above the terrain', value: v.ind - v.terrain, unit: 'ft', decimals: 0 },
        ],
        warn,
        work: [
          'Correction ≈ 4 ft per °C of ISA deviation per 1 000 ft above the altimeter source',
          `= 4 × ${fmt(dev, 1)} × ${fmt((v.ind - v.elev) / 1000, 2)} = ${fmt(correction, 0)} ft`,
        ],
        notes: [
          '"From high to low, look out below" — flying into colder air or lower pressure without resetting leaves you lower than indicated.',
          'This is the ICAO 4 ft/°C/1 000 ft approximation, the same basis as the cold-temperature correction tables in the TERPS chart supplements.',
        ],
      };
    },
  },

  {
    id: 'altimeter-pressure',
    cat: 'Atmosphere',
    name: 'Altimeter setting ↔ station pressure',
    blurb: 'Convert between the setting you dial in and the pressure actually out there.',
    keywords: 'altimeter setting station pressure qnh qfe sea level reduce field elevation',
    fields: [
      { k: 'elev', label: 'Field elevation', kind: 'altitude', def: 5000 },
      { k: 'baro', label: 'Altimeter setting (QNH)', kind: 'pressure', def: 29.92 },
      { k: 'station', label: 'Or station pressure', kind: 'pressure', def: '' },
    ],
    compute(v) {
      const haveStation = Number.isFinite(v.station);
      const station = haveStation ? v.station : ATM.stationPressureFromAltimeter(v.baro, v.elev);
      const qnh = haveStation ? ATM.altimeterSettingFromStation(v.station, v.elev) : v.baro;
      const pa = ATM.pressureAltitude(v.elev, qnh);
      return {
        primary: [
          { label: 'Altimeter setting', value: qnh, unit: 'inHg', decimals: 2, hint: `${fmt(qnh * 33.8638867, 1)} hPa` },
          { label: 'Station pressure', value: station, unit: 'inHg', decimals: 2, hint: `${fmt(station * 33.8638867, 1)} hPa` },
        ],
        secondary: [
          { label: 'Pressure altitude of the field', value: pa, unit: 'ft', decimals: 0 },
          { label: 'Pressure altitude from station pressure alone', value: ATM.pressureAltFromInHg(station), unit: 'ft', decimals: 0 },
          { label: 'Altitude the altimeter shows on the ground with 29.92 set', value: pa, unit: 'ft', decimals: 0 },
        ],
        notes: ['An altimeter setting is the station pressure reduced to sea level through a standard column of air. That is why a field at 5 000 ft reports about 29.92 while the air pressure there is nearer 24.9 inHg.'],
      };
    },
  },

  {
    id: 'temp-dew',
    cat: 'Atmosphere',
    name: 'Cloud base, dewpoint & humidity',
    blurb: 'Spread to cloud base, relative humidity, and the freezing level.',
    keywords: 'cloud base dewpoint spread relative humidity fog freezing level lapse rate icing',
    fields: [
      { k: 'temp', label: 'Surface temperature', kind: 'temp', def: 24 },
      { k: 'dew', label: 'Surface dewpoint', kind: 'temp', def: 10 },
      { k: 'elev', label: 'Surface elevation', kind: 'altitude', def: 2900 },
    ],
    compute(v) {
      const spread = v.temp - v.dew;
      const baseAgl = ATM.cloudBaseAglFt(v.temp, v.dew);
      const rh = ATM.relativeHumidity(v.temp, v.dew);
      // Freezing level using the standard 2 °C per 1 000 ft lapse rate.
      const freezingAgl = (v.temp / 1.9812) * 1000;
      const warn = [];
      if (spread <= 2) warn.push('A spread of 2 °C or less means fog or low stratus is likely, especially with a light wind and clearing skies.');
      return {
        primary: [
          { label: 'Convective cloud base', value: baseAgl, unit: 'ft AGL', decimals: 0, hint: `${fmt(baseAgl + v.elev, 0)} ft MSL` },
          { label: 'Relative humidity', value: rh, unit: '%', decimals: 0 },
        ],
        secondary: [
          { label: 'Temperature / dewpoint spread', text: `${fmt(spread, 1)} °C · ${fmt(spread * 9 / 5, 1)} °F` },
          { label: 'Temperature at the cloud base', value: ATM.cloudBaseTempC(v.temp, v.dew), unit: '°C', decimals: 1 },
          { label: 'Freezing level (standard lapse rate)', text: v.temp > 0 ? `${fmt(freezingAgl, 0)} ft AGL · ${fmt(freezingAgl + v.elev, 0)} ft MSL` : 'At or below the surface' },
          { label: 'Saturation vapour pressure', text: `${fmt(ATM.saturationVaporHpa(v.temp), 2)} hPa` },
        ],
        warn,
        work: [
          `Spread = ${fmt(v.temp, 1)} − ${fmt(v.dew, 1)} = ${fmt(spread, 1)} °C`,
          `Cloud base = spread ÷ 2.5 °C per 1 000 ft = <b>${fmt(baseAgl, 0)} ft AGL</b>`,
          'The dry adiabatic lapse rate is 3 °C/1 000 ft and the dewpoint falls 0.5 °C/1 000 ft, so the spread closes at 2.5 °C per 1 000 ft.',
        ],
        notes: ['In °F the same rule is 4.4 °F per 1 000 ft. This estimates the base of cumulus formed by surface heating — it says nothing about a layer moving in from elsewhere.'],
      };
    },
  },
];
