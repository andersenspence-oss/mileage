// calcs/flight.js — the in-flight calculators: airspeed, wind, tracking.

import * as ATM from '../core/atmosphere.js';
import * as AS from '../core/airspeed.js';
import * as W from '../core/wind.js';
import * as N from '../core/nav.js';
import { fmt, fmtDeg } from '../ui.js';
import { hhmm, hms, compassPoint, norm360 } from '../core/units.js';

const deg = (d) => `${fmtDeg(d)}°`;

export const FLIGHT_CALCS = [
  {
    id: 'tas',
    cat: 'Flight',
    name: 'True airspeed & density altitude',
    blurb: 'CAS, altitude and temperature to TAS, DA, Mach.',
    keywords: 'tas true airspeed density altitude mach sigma cas eas',
    fields: [
      { k: 'cas', label: 'Calibrated airspeed', kind: 'speed', def: 120 },
      { k: 'alt', label: 'Indicated altitude', kind: 'altitude', def: 6500 },
      { k: 'baro', label: 'Altimeter setting', kind: 'pressure', def: 29.92 },
      { k: 'oat', label: 'Outside air temperature', kind: 'temp', def: 10 },
    ],
    compute(v) {
      const pa = ATM.pressureAltitude(v.alt, v.baro);
      const da = ATM.densityAltitude(pa, v.oat);
      const s = AS.airspeedSolution({ casKt: v.cas, paFt: pa, oatC: v.oat });
      const isaDev = ATM.isaDeviationC(pa, v.oat);
      return {
        primary: [
          { label: 'True airspeed', value: s.tasKt, unit: 'kt', decimals: 1 },
          { label: 'Density altitude', value: da, unit: 'ft', decimals: 0 },
        ],
        secondary: [
          { label: 'Pressure altitude', value: pa, unit: 'ft', decimals: 0 },
          { label: 'ISA deviation', text: `${isaDev >= 0 ? '+' : ''}${fmt(isaDev, 1)} °C` },
          { label: 'Mach number', value: s.mach, decimals: 3 },
          { label: 'Equivalent airspeed', value: s.easKt, unit: 'kt', decimals: 1 },
          { label: 'Density ratio σ', value: s.sigma, decimals: 4 },
          { label: 'Speed of sound', value: s.speedOfSoundKt, unit: 'kt', decimals: 1 },
          { label: 'TAS without compressibility', value: s.tasSlideRuleKt, unit: 'kt', decimals: 1 },
          { label: 'TAS by the 2%/1000 ft rule', value: s.tasRuleOfThumbKt, unit: 'kt', decimals: 1 },
        ],
        work: [
          `PA = indicated altitude + (29.92 − ${fmt(v.baro, 2)}) × 1000 = <b>${fmt(pa, 0)} ft</b>`,
          `ISA temp at that altitude = 15 − 1.98 × ${fmt(pa / 1000, 2)} = ${fmt(ATM.isaTempC(pa), 1)} °C`,
          `σ = δ / θ = ${fmt(ATM.pressureRatio(pa), 4)} / ${fmt(ATM.temperatureRatio(v.oat), 4)} = ${fmt(s.sigma, 4)}`,
          `DA = altitude where σ matches = <b>${fmt(da, 0)} ft</b>`,
          `TAS = M × a = ${fmt(s.mach, 3)} × ${fmt(s.speedOfSoundKt, 1)} = <b>${fmt(s.tasKt, 1)} kt</b>`,
        ],
        notes: [
          'Pressure altitude uses the FAA 1 000 ft-per-inch rule the written test is keyed to. True airspeed includes the compressibility term, so it stays right at jet speeds; the slide-rule figure is shown for comparison.',
        ],
      };
    },
  },

  {
    id: 'mach',
    cat: 'Flight',
    name: 'Mach number ↔ TAS',
    blurb: 'Mach, TAS, CAS and the speed of sound at altitude.',
    keywords: 'mach number sound tas cas ram rise sat tat',
    fields: [
      { k: 'mach', label: 'Mach number', kind: 'number', def: 0.78 },
      { k: 'pa', label: 'Pressure altitude', kind: 'altitude', def: 35000 },
      { k: 'oat', label: 'Static air temperature', kind: 'temp', def: -54 },
    ],
    compute(v) {
      const tas = AS.tasFromMach(v.mach, v.oat);
      const cas = AS.casFromMach(v.mach, v.pa);
      const a = ATM.speedOfSoundKt(v.oat);
      const tat = AS.totalAirTempC(v.oat, v.mach);
      return {
        primary: [
          { label: 'True airspeed', value: tas, unit: 'kt', decimals: 1 },
          { label: 'Calibrated airspeed', value: cas, unit: 'kt', decimals: 1 },
        ],
        secondary: [
          { label: 'Speed of sound', value: a, unit: 'kt', decimals: 1 },
          { label: 'Total air temperature', value: tat, unit: '°C', decimals: 1 },
          { label: 'Ram rise', value: tat - v.oat, unit: '°C', decimals: 1 },
          { label: 'ISA deviation', value: ATM.isaDeviationC(v.pa, v.oat), unit: '°C', decimals: 1 },
        ],
        work: [
          `a = 661.48 × √(T/288.15) = ${fmt(a, 2)} kt`,
          `TAS = M × a = ${fmt(v.mach, 3)} × ${fmt(a, 2)} = <b>${fmt(tas, 1)} kt</b>`,
          `TAT = SAT × (1 + 0.2 M²) = ${fmt(tat, 1)} °C`,
        ],
        notes: ['The speed of sound depends only on temperature — not on altitude or pressure.'],
      };
    },
  },

  {
    id: 'wind-triangle',
    cat: 'Flight',
    name: 'Heading & groundspeed',
    blurb: 'The wind triangle: course + wind → heading and groundspeed.',
    keywords: 'wind triangle heading groundspeed wca crab drift correction angle',
    fields: [
      { k: 'course', label: 'True course', kind: 'bearing', def: 270 },
      { k: 'tas', label: 'True airspeed', kind: 'speed', def: 110 },
      { k: 'wdir', label: 'Wind from', kind: 'bearing', def: 320 },
      { k: 'wspd', label: 'Wind speed', kind: 'speed', def: 25 },
      { k: 'dist', label: 'Leg distance (optional)', kind: 'distance', def: '' },
      { k: 'varn', label: 'Variation (E +, W −)', kind: 'angle', def: 0 },
    ],
    compute(v) {
      const r = W.windTriangle({ courseDeg: v.course, tasKt: v.tas, windDirDeg: v.wdir, windSpeedKt: v.wspd });
      if (!r) return { error: 'Enter a course, true airspeed and wind.' };
      if (r.impossible) {
        return {
          error: `The crosswind component (${fmt(Math.abs(r.crosswindKt), 1)} kt) is greater than the true airspeed — this course cannot be held.`,
        };
      }
      const chain = N.headingChain({ trueCourseDeg: v.course, wcaDeg: r.wcaDeg, variationDeg: v.varn || 0 });
      const sec = [
        { label: 'Wind correction angle', text: `${r.wcaDeg >= 0 ? '+' : '−'}${fmt(Math.abs(r.wcaDeg), 1)}° (crab ${r.wcaDeg >= 0 ? 'right' : 'left'})` },
        { label: 'Magnetic heading', text: deg(chain.magneticHeadingDeg) },
        { label: 'Magnetic course', text: deg(chain.magneticCourseDeg) },
        { label: r.headwindKt >= 0 ? 'Headwind component' : 'Tailwind component', value: Math.abs(r.headwindKt), unit: 'kt', decimals: 1 },
        { label: 'Crosswind component', text: `${fmt(Math.abs(r.crosswindKt), 1)} kt from the ${r.crosswindKt >= 0 ? 'right' : 'left'}` },
      ];
      if (Number.isFinite(v.dist)) {
        const t = (v.dist / r.groundspeedKt) * 60;
        sec.push({ label: 'Time for the leg', text: `${hhmm(t)}  (${fmt(t, 1)} min)` });
      }
      return {
        primary: [
          { label: 'True heading', text: deg(chain.trueHeadingDeg), unit: '' },
          { label: 'Groundspeed', value: r.groundspeedKt, unit: 'kt', decimals: 1 },
        ],
        secondary: sec,
        work: [
          `Wind is ${fmt(Math.abs(r.relativeWindDeg), 0)}° off the ${Math.abs(r.relativeWindDeg) < 90 ? 'nose' : 'tail'}, from the ${r.relativeWindDeg >= 0 ? 'right' : 'left'}`,
          `sin(WCA) = (WS ÷ TAS) × sin(wind − course) = (${fmt(v.wspd, 0)} ÷ ${fmt(v.tas, 0)}) × sin(${fmt(r.relativeWindDeg, 1)}°)`,
          `WCA = ${fmt(r.wcaDeg, 2)}°, so TH = ${fmt(v.course, 0)} ${r.wcaDeg >= 0 ? '+' : '−'} ${fmt(Math.abs(r.wcaDeg), 2)} = <b>${deg(chain.trueHeadingDeg)}</b>`,
          `GS = TAS·cos(WCA) − WS·cos(wind − course) = <b>${fmt(r.groundspeedKt, 1)} kt</b>`,
        ],
      };
    },
  },

  {
    id: 'wind-determine',
    cat: 'Flight',
    name: 'Actual wind (from heading & track)',
    blurb: 'Heading, TAS, course made good and groundspeed → the actual wind speed and direction.',
    keywords: 'determine actual wind speed direction aloft calculate heading track course groundspeed reverse unknown',
    fields: [
      { k: 'hdg', label: 'True heading flown', kind: 'bearing', def: 90 },
      { k: 'tas', label: 'True airspeed', kind: 'speed', def: 120 },
      { k: 'track', label: 'Course / track made good', kind: 'bearing', def: 100, hint: 'the "course" in a test question' },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 105 },
    ],
    compute(v) {
      const r = W.windFromTrack({ headingDeg: v.hdg, tasKt: v.tas, trackDeg: v.track, groundspeedKt: v.gs });
      return {
        primary: [
          { label: 'Wind from', text: `${deg(r.windDirDeg)}`, hint: compassPoint(r.windDirDeg) },
          { label: 'Wind speed', value: r.windSpeedKt, unit: 'kt', decimals: 1 },
        ],
        secondary: [
          { label: 'Drift', text: `${fmt(Math.abs(r.driftDeg), 1)}° to the ${r.driftDeg >= 0 ? 'right' : 'left'}` },
          { label: r.headwindKt >= 0 ? 'Headwind component' : 'Tailwind component', value: Math.abs(r.headwindKt), unit: 'kt', decimals: 1 },
          { label: 'Crosswind component', text: `${fmt(Math.abs(r.crosswindKt), 1)} kt from the ${r.crosswindKt >= 0 ? 'right' : 'left'}` },
        ],
        work: [
          'Wind vector = ground vector − air vector, resolved into north/east components.',
          `Air: ${fmt(v.tas, 0)} kt on ${deg(v.hdg)} · Ground: ${fmt(v.gs, 0)} kt on ${deg(v.track)}`,
          `Difference = ${fmt(r.windSpeedKt, 1)} kt blowing toward ${deg(norm360(r.windDirDeg + 180))}, i.e. <b>from ${deg(r.windDirDeg)}</b>`,
        ],
        notes: [
          'When a test question gives a course AND a separate heading, the course is the track made good — enter it here with the heading, TAS and groundspeed, and the wind falls out.',
          'Enter headings and tracks in the same reference. A GPS track is normally true; a heading indicator is magnetic.',
        ],
      };
    },
  },

  {
    id: 'wind-components',
    cat: 'Flight',
    name: 'Wind components',
    blurb: 'Headwind and crosswind for a runway or course.',
    keywords: 'crosswind headwind tailwind component runway limit demonstrated',
    fields: [
      { k: 'rwy', label: 'Runway / course', kind: 'bearing', def: 210, hint: 'magnetic' },
      { k: 'wdir', label: 'Wind from', kind: 'bearing', def: 250 },
      { k: 'wspd', label: 'Wind speed', kind: 'speed', def: 18 },
      { k: 'gust', label: 'Gusting to (optional)', kind: 'speed', def: '' },
      { k: 'limit', label: 'Demonstrated crosswind', kind: 'speed', def: 15 },
    ],
    compute(v) {
      const r = W.windComponents({ runwayHeadingDeg: v.rwy, windDirDeg: v.wdir, windSpeedKt: v.wspd });
      const sec = [
        { label: 'Angle off the runway', text: `${fmt(r.absAngleDeg, 0)}° from the ${r.angleOffDeg >= 0 ? 'right' : 'left'}` },
        { label: 'Clock-face estimate', value: Math.abs(r.clockRuleCrosswindKt), unit: 'kt', decimals: 1 },
        { label: 'Max wind at this angle for the limit', text: Number.isFinite(v.limit) ? `${fmt(W.maxWindForCrosswind(v.limit, r.absAngleDeg), 1)} kt` : '—' },
      ];
      const warn = [];
      if (Number.isFinite(v.gust)) {
        const g = W.windComponents({ runwayHeadingDeg: v.rwy, windDirDeg: v.wdir, windSpeedKt: v.gust });
        sec.unshift({ label: 'Crosswind in the gusts', value: Math.abs(g.crosswindKt), unit: 'kt', decimals: 1, emph: true });
        sec.unshift({ label: 'Headwind in the gusts', value: g.headwindKt, unit: 'kt', decimals: 1 });
        if (Number.isFinite(v.limit) && Math.abs(g.crosswindKt) > v.limit) {
          warn.push(`The gusts give ${fmt(Math.abs(g.crosswindKt), 1)} kt of crosswind — beyond the ${fmt(v.limit, 0)} kt demonstrated value.`);
        }
      }
      if (r.isTailwind) warn.push(`That is a ${fmt(r.tailwindKt, 1)} kt tailwind component.`);
      if (Number.isFinite(v.limit) && Math.abs(r.crosswindKt) > v.limit) {
        warn.push(`Steady-state crosswind exceeds the ${fmt(v.limit, 0)} kt demonstrated value.`);
      }
      return {
        primary: [
          { label: 'Crosswind', value: Math.abs(r.crosswindKt), unit: 'kt', decimals: 1, hint: `from the ${r.crossFrom}` },
          { label: r.isTailwind ? 'Tailwind' : 'Headwind', value: Math.abs(r.headwindKt), unit: 'kt', decimals: 1 },
        ],
        secondary: sec,
        warn,
        work: [
          `Angle between the wind and the runway = ${fmt(r.absAngleDeg, 0)}°`,
          `Headwind = ${fmt(v.wspd, 0)} × cos ${fmt(r.absAngleDeg, 0)}° = ${fmt(r.headwindKt, 1)} kt`,
          `Crosswind = ${fmt(v.wspd, 0)} × sin ${fmt(r.absAngleDeg, 0)}° = ${fmt(Math.abs(r.crosswindKt), 1)} kt`,
        ],
        notes: ['Runway numbers and tower-reported winds are magnetic; a METAR wind is true. Use the runway analysis page if you need to mix the two.'],
      };
    },
  },

  {
    id: 'runway-picker',
    cat: 'Flight',
    name: 'Runway analysis',
    blurb: 'Every runway ranked by headwind, with the true/magnetic wind sorted out.',
    keywords: 'runway best pick headwind crosswind metar true magnetic variation',
    fields: [
      { k: 'rwys', label: 'Runways', kind: 'text', def: '1, 19, 13, 31', placeholder: 'e.g. 9, 27, 18, 36', text: true },
      { k: 'wdir', label: 'Wind from', kind: 'bearing', def: 240 },
      { k: 'wspd', label: 'Wind speed', kind: 'speed', def: 14 },
      { k: 'istrue', label: 'Wind is true (from a METAR)', kind: 'toggle', def: false },
      { k: 'varn', label: 'Variation (E +, W −)', kind: 'angle', def: 11 },
    ],
    rawFields: ['rwys'],
    compute(v, raw) {
      const list = String(raw.rwys ?? '1, 19, 13, 31')
        .split(/[^0-9]+/).map((s) => s.trim()).filter(Boolean)
        .map(Number).filter((n) => n >= 1 && n <= 36);
      if (!list.length) return { error: 'Enter runway numbers, e.g. 9, 27.' };
      const rows = W.runwayAnalysis({
        runwayNumbers: list, windDirDeg: v.wdir, windSpeedKt: v.wspd,
        variationDeg: v.varn || 0, windIsTrue: !!v.istrue,
      });
      const best = rows[0];
      return {
        primary: [
          { label: 'Best runway', text: best.runway.padStart(2, '0'), hint: `${fmt(best.headwindKt, 0)} kt headwind, ${fmt(Math.abs(best.crosswindKt), 0)} kt cross` },
        ],
        table: {
          head: ['Rwy', 'Head/Tail', 'Crosswind', 'Angle'],
          rows: rows.map((r) => ({
            className: r === best ? 'hi' : '',
            cells: [
              r.runway.padStart(2, '0'),
              r.headwindKt >= 0 ? `${fmt(r.headwindKt, 1)} kt head` : `<b>${fmt(-r.headwindKt, 1)} kt tail</b>`,
              `${fmt(Math.abs(r.crosswindKt), 1)} kt ${r.crossFrom.charAt(0).toUpperCase()}`,
              `${fmt(r.absAngleDeg, 0)}°`,
            ],
          })),
        },
        notes: [
          v.istrue
            ? `Wind converted from ${deg(v.wdir)} true to ${deg(norm360(v.wdir - (v.varn || 0)))} magnetic before comparing with the runway numbers.`
            : 'Wind treated as magnetic (tower, ATIS or AWOS voice). Turn on the toggle for a METAR, which reports true.',
        ],
      };
    },
  },

  {
    id: 'winds-aloft',
    cat: 'Flight',
    name: 'Winds aloft interpolation',
    blurb: 'Get the wind and temperature for a cruise altitude between two FD levels.',
    keywords: 'winds aloft fd forecast interpolate level temperature',
    fields: [
      { k: 'la', label: 'Lower level', kind: 'altitude', def: 6000 },
      { k: 'ld', label: 'Lower wind from', kind: 'bearing', def: 230 },
      { k: 'ls', label: 'Lower wind speed', kind: 'speed', def: 18 },
      { k: 'lt', label: 'Lower temperature', kind: 'temp', def: 4 },
      { k: 'ua', label: 'Upper level', kind: 'altitude', def: 9000 },
      { k: 'ud', label: 'Upper wind from', kind: 'bearing', def: 260 },
      { k: 'us', label: 'Upper wind speed', kind: 'speed', def: 30 },
      { k: 'ut', label: 'Upper temperature', kind: 'temp', def: -2 },
      { k: 'target', label: 'Cruise altitude', kind: 'altitude', def: 7500 },
    ],
    compute(v) {
      const r = W.interpolateWindsAloft({
        lowerAltFt: v.la, lowerDirDeg: v.ld, lowerSpeedKt: v.ls, lowerTempC: v.lt,
        upperAltFt: v.ua, upperDirDeg: v.ud, upperSpeedKt: v.us, upperTempC: v.ut,
        targetAltFt: v.target,
      });
      const warn = [];
      if (r.fraction < 0 || r.fraction > 1) warn.push('The cruise altitude is outside the two levels — this is an extrapolation.');
      return {
        primary: [
          { label: 'Wind', text: `${deg(r.windDirDeg)} / ${fmt(r.windSpeedKt, 0)}`, hint: 'direction / speed in knots' },
          { label: 'Temperature', value: r.tempC, unit: '°C', decimals: 1 },
        ],
        secondary: [
          { label: 'Fraction between levels', text: `${fmt(r.fraction * 100, 0)} %` },
          { label: 'ISA deviation at cruise', value: r.tempC - ATM.isaTempC(v.target), unit: '°C', decimals: 1 },
        ],
        warn,
        notes: [
          'Winds are interpolated as vectors, not by averaging the numbers — averaging 340° and 020° arithmetically would give you 180°, exactly backwards.',
          'FD forecasts are true direction. Temperatures above 24 000 ft are always negative even without the minus sign.',
        ],
      };
    },
  },

  {
    id: 'drift',
    cat: 'Flight',
    name: 'Track from an uncorrected heading',
    blurb: 'Hold a heading with no correction — where do you actually end up?',
    keywords: 'drift track heading uncorrected groundspeed',
    fields: [
      { k: 'hdg', label: 'True heading', kind: 'bearing', def: 360 },
      { k: 'tas', label: 'True airspeed', kind: 'speed', def: 100 },
      { k: 'wdir', label: 'Wind from', kind: 'bearing', def: 270 },
      { k: 'wspd', label: 'Wind speed', kind: 'speed', def: 20 },
      { k: 'time', label: 'Time flown', kind: 'time', def: 30 },
    ],
    compute(v) {
      const r = W.trackFromHeading({ headingDeg: v.hdg, tasKt: v.tas, windDirDeg: v.wdir, windSpeedKt: v.wspd });
      const dist = r.groundspeedKt * (v.time / 60);
      const off = Math.abs(Math.sin(r.driftDeg * Math.PI / 180)) * dist;
      return {
        primary: [
          { label: 'Track made good', text: deg(r.trackDeg) },
          { label: 'Groundspeed', value: r.groundspeedKt, unit: 'kt', decimals: 1 },
        ],
        secondary: [
          { label: 'Drift', text: `${fmt(Math.abs(r.driftDeg), 1)}° to the ${r.driftDeg >= 0 ? 'right' : 'left'}` },
          { label: 'Distance covered', value: dist, unit: 'NM', decimals: 1 },
          { label: 'Off the intended course by', value: off, unit: 'NM', decimals: 1 },
        ],
        notes: ['A useful sanity check for how fast an uncorrected heading puts you into the next piece of airspace.'],
      };
    },
  },

  {
    id: 'off-course',
    cat: 'Flight',
    name: 'Off-course correction',
    blurb: 'The 1-in-60 rule: how many degrees to turn to get back on track.',
    keywords: 'off course correction 1 in 60 track error closing angle',
    fields: [
      { k: 'off', label: 'Distance off course', kind: 'distance', def: 5 },
      { k: 'flown', label: 'Distance flown', kind: 'distance', def: 60 },
      { k: 'remain', label: 'Distance remaining', kind: 'distance', def: 90 },
    ],
    compute(v) {
      const r = N.offCourseCorrection({ offCourseNm: v.off, flownNm: v.flown, remainingNm: v.remain });
      return {
        primary: [
          { label: 'Turn toward course by', value: r.totalCorrectionDeg, unit: '°', decimals: 1, hint: 'to reach the destination' },
          { label: 'Track error', value: r.trackErrorDeg, unit: '°', decimals: 1, hint: 'just to parallel the course' },
        ],
        secondary: [
          { label: 'Closing angle', value: r.closingAngleDeg, unit: '°', decimals: 1 },
        ],
        work: [
          `Track error = 60 × ${fmt(v.off, 1)} ÷ ${fmt(v.flown, 0)} = ${fmt(r.trackErrorDeg, 1)}°`,
          `Closing angle = 60 × ${fmt(v.off, 1)} ÷ ${fmt(v.remain, 0)} = ${fmt(r.closingAngleDeg, 1)}°`,
          `Total = <b>${fmt(r.totalCorrectionDeg, 1)}°</b> toward the course line`,
        ],
        notes: ['1 in 60: one nautical mile off at 60 NM is one degree of error. Correcting by the track error alone only makes the course parallel — you need the closing angle as well to actually get there.'],
      };
    },
  },

  {
    id: 'heading-convert',
    cat: 'Flight',
    name: 'True / magnetic / compass',
    blurb: 'Work the whole chain, in either direction.',
    keywords: 'true magnetic compass variation deviation east is least west is best',
    fields: [
      { k: 'tc', label: 'True course', kind: 'bearing', def: 90 },
      { k: 'wca', label: 'Wind correction angle', kind: 'angle', def: 0 },
      { k: 'varn', label: 'Variation (E +, W −)', kind: 'angle', def: -13 },
      { k: 'dev', label: 'Deviation (E +, W −)', kind: 'angle', def: 0 },
    ],
    compute(v) {
      const c = N.headingChain({ trueCourseDeg: v.tc, wcaDeg: v.wca, variationDeg: v.varn, deviationDeg: v.dev });
      return {
        primary: [
          { label: 'Compass heading', text: deg(c.compassHeadingDeg) },
          { label: 'Magnetic heading', text: deg(c.magneticHeadingDeg) },
        ],
        secondary: [
          { label: 'True course', text: deg(c.trueCourseDeg) },
          { label: 'True heading', text: deg(c.trueHeadingDeg) },
          { label: 'Magnetic course', text: deg(c.magneticCourseDeg) },
        ],
        work: [
          'True course ± wind correction = true heading',
          'True heading − variation = magnetic heading  (east variation is subtracted: "east is least")',
          'Magnetic heading − deviation = compass heading',
          `${fmt(v.tc, 0)} ${v.wca >= 0 ? '+' : '−'} ${fmt(Math.abs(v.wca), 0)} = ${fmt(c.trueHeadingDeg, 0)} → ${fmt(c.magneticHeadingDeg, 0)} → <b>${deg(c.compassHeadingDeg)}</b>`,
        ],
        notes: ['Enter westerly variation as a negative number — 13°W is −13. The app then handles "east is least, west is best" for you.'],
      };
    },
  },

  {
    id: 'great-circle',
    cat: 'Flight',
    name: 'Distance & course between points',
    blurb: 'Great-circle and rhumb-line distance from latitude and longitude.',
    keywords: 'great circle distance course latitude longitude coordinates rhumb bearing',
    fields: [
      { k: 'lat1', label: 'From latitude', kind: 'text', def: '37 02.4 N', text: true },
      { k: 'lon1', label: 'From longitude', kind: 'text', def: '113 30.3 W', text: true },
      { k: 'lat2', label: 'To latitude', kind: 'text', def: '40 46.6 N', text: true },
      { k: 'lon2', label: 'To longitude', kind: 'text', def: '111 58.7 W', text: true },
      { k: 'gs', label: 'Groundspeed (optional)', kind: 'speed', def: '' },
    ],
    rawFields: ['lat1', 'lon1', 'lat2', 'lon2'],
    compute(v, raw) {
      const la1 = N.parseLatLon(raw.lat1, false), lo1 = N.parseLatLon(raw.lon1, true);
      const la2 = N.parseLatLon(raw.lat2, false), lo2 = N.parseLatLon(raw.lon2, true);
      if (![la1, lo1, la2, lo2].every(Number.isFinite)) {
        return { error: 'Enter coordinates as 4030N / 11215W, "40 30.5 N", or signed decimals.' };
      }
      const d = N.gcDistanceNm(la1, lo1, la2, lo2);
      const b = N.gcInitialBearing(la1, lo1, la2, lo2);
      const rl = N.rhumbLine(la1, lo1, la2, lo2);
      const sec = [
        { label: 'Final course (true)', text: deg(N.gcFinalBearing(la1, lo1, la2, lo2)) },
        { label: 'Rhumb-line distance', value: rl.distanceNm, unit: 'NM', decimals: 1 },
        { label: 'Rhumb-line course', text: deg(rl.courseDeg) },
        { label: 'Distance', text: `${fmt(d * 1.15078, 1)} SM · ${fmt(d * 1.852, 1)} km` },
        { label: 'From', text: `${N.formatLatLon(la1)} ${N.formatLatLon(lo1, true)}` },
        { label: 'To', text: `${N.formatLatLon(la2)} ${N.formatLatLon(lo2, true)}` },
      ];
      if (Number.isFinite(v.gs)) {
        sec.splice(0, 0, { label: 'Time at that groundspeed', text: hhmm((d / v.gs) * 60), emph: true });
      }
      return {
        primary: [
          { label: 'Distance', value: d, unit: 'NM', decimals: 1 },
          { label: 'Initial course (true)', text: deg(b) },
        ],
        secondary: sec,
        notes: ['Great-circle courses change continuously; the initial and final courses differ on long legs. A rhumb line is the constant-heading route — longer, but simpler to fly.'],
      };
    },
  },

  {
    id: 'los',
    cat: 'Flight',
    name: 'Radio range & horizon',
    blurb: 'VHF line of sight, the visual horizon, and DME slant range.',
    keywords: 'line of sight radio range horizon vhf reception dme slant',
    fields: [
      { k: 'alt', label: 'Aircraft height above ground', kind: 'altitude', def: 8000 },
      { k: 'stn', label: 'Station height above ground', kind: 'altitude', def: 100 },
      { k: 'dme', label: 'DME slant range (optional)', kind: 'distance', def: '' },
      { k: 'above', label: 'Height above the station', kind: 'altitude', def: 8000 },
    ],
    compute(v) {
      const sec = [
        { label: 'Visual (geometric) horizon', value: N.visualHorizonNm(v.alt), unit: 'NM', decimals: 1 },
        { label: 'Radio horizon, aircraft only', value: N.radioHorizonNm(v.alt), unit: 'NM', decimals: 1 },
        { label: 'Radio horizon, station only', value: N.radioHorizonNm(v.stn), unit: 'NM', decimals: 1 },
      ];
      if (Number.isFinite(v.dme)) {
        const g = N.dmeGroundDistanceNm(v.dme, v.above);
        sec.push({ label: 'DME ground distance', value: g, unit: 'NM', decimals: 2, emph: true });
        sec.push({ label: 'Slant-range error', value: v.dme - g, unit: 'NM', decimals: 2 });
      }
      return {
        primary: [
          { label: 'VHF line of sight', value: N.lineOfSightNm(v.alt, v.stn), unit: 'NM', decimals: 0 },
        ],
        secondary: sec,
        work: ['Radio horizon (NM) = 1.23 × √(height in feet), using the standard 4/3-Earth refraction model.'],
        notes: ['Slant-range error matters most close in and high up: directly over a station at 6 000 ft the DME reads about 1 NM while the ground distance is zero.'],
      };
    },
  },
];
