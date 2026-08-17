// calcs/convert.js — unit conversions, generated from the exact factor tables.

import {
  LENGTH, SPEED, WEIGHT, VOLUME, PRESSURE, TIME, FUEL_LB_PER_GAL,
  convert, tempToC, tempFromC, TEMP_UNITS,
} from '../core/units.js';
import { fmt, autoDecimals } from '../ui.js';

function converter({ id, name, blurb, keywords, table, units, def, defUnit, note }) {
  return {
    id, cat: 'Conversions', name, blurb, keywords,
    fields: [
      { k: 'v', label: 'Value', kind: 'number', def },
      { k: 'u', label: 'Units', options: units, def: defUnit },
    ],
    compute(v) {
      if (!Number.isFinite(v.v)) return { error: 'Enter a value.' };
      const rows = units.map((u) => {
        const out = convert(v.v, v.u, u, table);
        return { label: u, value: out, decimals: autoDecimals(out), emph: u === v.u };
      });
      // Lead with the two most useful alternates; list the rest below.
      const alternates = rows.filter((r) => r.label !== v.u).slice(0, 2);
      return {
        primary: alternates.map((r) => ({
          label: `${v.u} → ${r.label}`, value: r.value, unit: r.label, decimals: r.decimals,
        })),
        secondary: rows,
        notes: note ? [note] : [],
      };
    },
  };
}

export const CONVERT_CALCS = [
  converter({
    id: 'conv-distance', name: 'Distance', blurb: 'NM, SM, km, feet, metres.',
    keywords: 'convert distance nautical statute mile kilometre feet metres length',
    table: LENGTH, units: ['NM', 'SM', 'km', 'm', 'ft', 'yd', 'in', 'cm'],
    def: 100, defUnit: 'NM',
    note: '1 NM = 1 852 m exactly = 6 076.115 ft. 1 SM = 5 280 ft exactly. The ratio NM : SM is 1 : 1.15078.',
  }),
  converter({
    id: 'conv-speed', name: 'Speed', blurb: 'Knots, mph, km/h, m/s, ft/min.',
    keywords: 'convert speed knots mph kph metres per second feet per minute velocity',
    table: SPEED, units: ['kt', 'mph', 'km/h', 'm/s', 'ft/min', 'ft/s'],
    def: 120, defUnit: 'kt',
    note: 'A knot is one nautical mile per hour. 1 kt = 1.15078 mph = 1.852 km/h = 101.27 ft/min.',
  }),
  converter({
    id: 'conv-weight', name: 'Weight', blurb: 'Pounds, kilograms, ounces, tons.',
    keywords: 'convert weight mass pounds kilograms ounces tonnes',
    table: WEIGHT, units: ['lb', 'kg', 'oz', 'g', 'ton', 'tonne'],
    def: 500, defUnit: 'lb',
    note: '1 lb = 0.45359237 kg exactly.',
  }),
  converter({
    id: 'conv-volume', name: 'Volume', blurb: 'US gallons, litres, quarts, imperial gallons.',
    keywords: 'convert volume gallons litres quarts imperial fuel capacity',
    table: VOLUME, units: ['gal', 'L', 'imp gal', 'qt', 'pt', 'mL', 'cu ft'],
    def: 40, defUnit: 'gal',
    note: '1 US gallon = 3.785411784 L exactly. An imperial gallon is 1.20095 US gallons — worth remembering when buying fuel abroad.',
  }),
  converter({
    id: 'conv-pressure', name: 'Pressure', blurb: 'inHg, hectopascals/millibars, psi.',
    keywords: 'convert pressure inches mercury hectopascal millibar psi qnh altimeter',
    table: PRESSURE, units: ['inHg', 'hPa', 'psi', 'mb', 'mmHg', 'kPa'],
    def: 29.92, defUnit: 'inHg',
    note: '29.92 inHg = 1013.2 hPa. Millibars and hectopascals are the same unit under two names. 1 inHg ≈ 33.86 hPa ≈ 1 000 ft of altitude near sea level.',
  }),
  converter({
    id: 'conv-time', name: 'Time', blurb: 'Minutes, hours, seconds — decimal and clock.',
    keywords: 'convert time minutes hours seconds decimal logbook tenths',
    table: TIME, units: ['min', 'hr', 'sec'],
    def: 90, defUnit: 'min',
    note: 'Logbooks are kept in decimal hours: 1:15 is 1.3 hours, not 1.15.',
  }),

  {
    id: 'conv-temp',
    cat: 'Conversions',
    name: 'Temperature',
    blurb: 'Celsius, Fahrenheit, Kelvin, Rankine.',
    keywords: 'convert temperature celsius fahrenheit kelvin rankine centigrade',
    fields: [
      { k: 'v', label: 'Value', kind: 'number', def: 15, neg: true },
      { k: 'u', label: 'Units', options: TEMP_UNITS, def: 'C' },
    ],
    compute(v) {
      if (!Number.isFinite(v.v)) return { error: 'Enter a temperature.' };
      const c = tempToC(v.v, v.u);
      return {
        primary: [
          { label: 'Celsius', value: c, unit: '°C', decimals: 1 },
          { label: 'Fahrenheit', value: tempFromC(c, 'F'), unit: '°F', decimals: 1 },
        ],
        secondary: [
          { label: 'Kelvin', value: tempFromC(c, 'K'), unit: 'K', decimals: 2 },
          { label: 'Rankine', value: tempFromC(c, 'R'), unit: '°R', decimals: 2 },
        ],
        work: ['°F = °C × 9/5 + 32', '°C = (°F − 32) × 5/9', 'They cross at −40°, the one point where both scales agree.'],
      };
    },
  },

  {
    id: 'conv-fuel',
    cat: 'Conversions',
    name: 'Fuel weight',
    blurb: 'Gallons, litres and pounds for each fuel grade.',
    keywords: 'fuel weight gallons pounds kilograms avgas jet a density conversion',
    fields: [
      { k: 'v', label: 'Quantity', kind: 'number', def: 40 },
      { k: 'u', label: 'Units', options: ['gal', 'L', 'imp gal', 'lb', 'kg'], def: 'gal' },
      { k: 'type', label: 'Fuel', options: Object.keys(FUEL_LB_PER_GAL), def: 'Avgas 100LL' },
    ],
    compute(v) {
      if (!Number.isFinite(v.v)) return { error: 'Enter a quantity.' };
      const lbPerGal = FUEL_LB_PER_GAL[v.type];
      let gal;
      if (v.u === 'lb') gal = v.v / lbPerGal;
      else if (v.u === 'kg') gal = (v.v / 0.45359237) / lbPerGal;
      else gal = convert(v.v, v.u, 'gal', VOLUME);
      const lb = gal * lbPerGal;
      return {
        primary: [
          { label: 'Weight', value: lb, unit: 'lb', decimals: 1 },
          { label: 'Volume', value: gal, unit: 'gal', decimals: 2 },
        ],
        secondary: [
          { label: 'Litres', value: convert(gal, 'gal', 'L', VOLUME), decimals: 1 },
          { label: 'Imperial gallons', value: convert(gal, 'gal', 'imp gal', VOLUME), decimals: 2 },
          { label: 'Kilograms', value: lb * 0.45359237, decimals: 1 },
          { label: 'Density used', text: `${lbPerGal} lb per US gallon` },
        ],
        notes: ['The FAA uses 6 lb/gal for avgas and 6.7 lb/gal for Jet A in weight-and-balance problems. Real density varies a little with temperature; these are the book figures.'],
      };
    },
  },

  {
    id: 'conv-vs',
    cat: 'Conversions',
    name: 'Rate & gradient',
    blurb: 'Feet per minute, feet per nautical mile, percent and degrees.',
    keywords: 'convert rate climb gradient feet per minute nautical mile percent degrees angle',
    fields: [
      { k: 'v', label: 'Value', kind: 'number', def: 500 },
      { k: 'u', label: 'Units', options: ['ft/min', 'ft/NM', '%', 'degrees', 'm/s'], def: 'ft/min' },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 100 },
    ],
    compute(v) {
      const FT_NM = 6076.11548556;
      if (!Number.isFinite(v.v)) return { error: 'Enter a value.' };
      let ftPerNm;
      switch (v.u) {
        case 'ft/min': ftPerNm = v.v / (v.gs / 60); break;
        case 'm/s': ftPerNm = (v.v * 196.850394) / (v.gs / 60); break;
        case 'ft/NM': ftPerNm = v.v; break;
        case '%': ftPerNm = (v.v / 100) * FT_NM; break;
        case 'degrees': ftPerNm = Math.tan(v.v * Math.PI / 180) * FT_NM; break;
        default: ftPerNm = v.v;
      }
      const fpm = ftPerNm * (v.gs / 60);
      return {
        primary: [
          { label: 'Rate', value: fpm, unit: 'ft/min', decimals: 0, hint: `at ${fmt(v.gs, 0)} kt groundspeed` },
          { label: 'Gradient', value: ftPerNm, unit: 'ft/NM', decimals: 0 },
        ],
        secondary: [
          { label: 'Percent gradient', value: (ftPerNm / FT_NM) * 100, unit: '%', decimals: 2 },
          { label: 'Angle', value: Math.atan2(ftPerNm, FT_NM) * 180 / Math.PI, unit: '°', decimals: 2 },
          { label: 'Metres per second', value: fpm / 196.850394, decimals: 2 },
          { label: 'Feet per statute mile', value: ftPerNm / 1.15078, decimals: 0 },
        ],
        notes: ['A gradient is a property of the flight path; a rate of climb is what your groundspeed turns it into. Departure procedures publish gradients precisely because the required rate changes with speed.'],
      };
    },
  },
];
