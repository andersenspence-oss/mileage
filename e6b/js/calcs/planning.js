// calcs/planning.js — time, fuel, climbs, descents, turns and endurance problems.

import * as N from '../core/nav.js';
import * as M from '../core/maneuver.js';
import * as F from '../core/fuel.js';
import * as H from '../core/holding.js';
import * as AS from '../core/airspeed.js';
import { fmt, fmtDeg } from '../ui.js';
import { hhmm, hms, FT_PER_NM } from '../core/units.js';

const deg = (d) => `${fmtDeg(d)}°`;

export const PLANNING_CALCS = [
  {
    id: 'tsd',
    cat: 'Planning',
    name: 'Time · speed · distance',
    blurb: 'Fill in any two and the third appears.',
    keywords: 'time speed distance ete groundspeed leg',
    fields: [
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: '' },
      { k: 'time', label: 'Time', kind: 'time', def: '' },
      { k: 'dist', label: 'Distance', kind: 'distance', def: '' },
    ],
    compute(v) {
      const r = N.solveTSD({ speedKt: v.gs, timeMin: v.time, distanceNm: v.dist });
      if (!r.solved) return { error: 'Enter any two of groundspeed, time and distance.' };
      const gs = r.speedKt, t = r.timeMin, d = r.distanceNm;
      const primary = [];
      if (r.solved === 'distance') primary.push({ label: 'Distance', value: d, unit: 'NM', decimals: 1 });
      if (r.solved === 'time') primary.push({ label: 'Time', text: hhmm(t), hint: `${fmt(t, 1)} minutes` });
      if (r.solved === 'speed') primary.push({ label: 'Groundspeed', value: gs, unit: 'kt', decimals: 1 });
      if (r.solved === 'check') {
        primary.push({ label: 'Time for that distance', text: hhmm(r.checkTimeMin), hint: `${fmt(r.checkTimeMin, 1)} minutes` });
      }
      return {
        primary,
        secondary: [
          { label: 'Groundspeed', value: gs, unit: 'kt', decimals: 1 },
          { label: 'Time', text: `${hhmm(t)} · ${fmt(t, 1)} min · ${hms(t)}` },
          { label: 'Distance', text: `${fmt(d, 1)} NM · ${fmt(d * 1.15078, 1)} SM` },
          { label: 'Per minute', text: `${fmt(gs / 60, 2)} NM/min` },
        ],
        notes: ['Leave one box empty and it becomes the answer. Time accepts 1:30 as well as 90.'],
      };
    },
  },

  {
    id: 'fuel-basic',
    cat: 'Planning',
    name: 'Fuel burn · time · quantity',
    blurb: 'Any two of burn rate, time and gallons.',
    keywords: 'fuel burn rate gph endurance gallons pounds consumption',
    fields: [
      { k: 'rate', label: 'Fuel flow', kind: 'gph', def: '' },
      { k: 'time', label: 'Time', kind: 'time', def: '' },
      { k: 'qty', label: 'Fuel quantity', kind: 'volume', def: '' },
      { k: 'type', label: 'Fuel type', options: ['Avgas 100LL', 'Jet A', 'JP-4', 'JP-5', 'Oil'], def: 'Avgas 100LL' },
    ],
    compute(v) {
      const r = F.solveFuel({ rateGph: v.rate, timeMin: v.time, quantityGal: v.qty });
      if (!r.solved) return { error: 'Enter any two of fuel flow, time and quantity.' };
      const lb = F.fuelWeightLb(r.quantityGal, v.type);
      return {
        primary: [
          r.solved === 'quantity' ? { label: 'Fuel used', value: r.quantityGal, unit: 'gal', decimals: 1 }
            : r.solved === 'time' ? { label: 'Endurance', text: hhmm(r.timeMin), hint: `${fmt(r.timeMin, 0)} minutes` }
              : { label: 'Fuel flow', value: r.rateGph, unit: 'gal/hr', decimals: 2 },
          { label: 'Weight', value: lb, unit: 'lb', decimals: 0 },
        ],
        secondary: [
          { label: 'Fuel flow', value: r.rateGph, unit: 'gal/hr', decimals: 2 },
          { label: 'Time', text: hhmm(r.timeMin) },
          { label: 'Quantity', text: `${fmt(r.quantityGal, 1)} gal · ${fmt(r.quantityGal * 3.785412, 1)} L` },
          { label: 'Weight', text: `${fmt(lb, 0)} lb · ${fmt(lb * 0.45359237, 0)} kg` },
        ],
        notes: ['Avgas is 6.0 lb/gal and Jet A 6.7 lb/gal — the figures the FAA uses on the knowledge test and in weight-and-balance problems.'],
      };
    },
  },

  {
    id: 'fuel-trip',
    cat: 'Planning',
    name: 'Trip fuel & legal reserve',
    blurb: 'Adds taxi, climb, alternate and reserve, then checks it against what you can carry.',
    keywords: 'fuel required trip reserve alternate 91.151 91.167 legal endurance range',
    fields: [
      { k: 'dist', label: 'Distance', kind: 'distance', def: 240 },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 115 },
      { k: 'burn', label: 'Cruise fuel flow', kind: 'gph', def: 9.5 },
      { k: 'taxi', label: 'Taxi & run-up', kind: 'volume', def: 1.2 },
      { k: 'climb', label: 'Extra climb fuel', kind: 'volume', def: 1 },
      { k: 'altdist', label: 'To the alternate', kind: 'distance', def: 0 },
      {
        k: 'reserve', label: 'Reserve', options: [
          { value: '30', label: 'VFR day — 30 min' },
          { value: '45', label: 'VFR night / IFR — 45 min' },
          { value: '60', label: 'Personal minimum — 60 min' },
          { value: '20', label: 'VFR helicopter — 20 min' },
        ], def: '45',
      },
      { k: 'usable', label: 'Usable fuel on board', kind: 'volume', def: 38 },
    ],
    compute(v) {
      const reserveMin = Number(v.reserve) || 45;
      const r = F.tripFuel({
        distanceNm: v.dist, gsKt: v.gs, burnGph: v.burn,
        taxiRunupGal: v.taxi || 0, climbGal: v.climb || 0,
        reserveMin, alternateNm: v.altdist || 0, usableGal: v.usable,
      });
      const warn = [];
      if (r.legal === false) warn.push(`Short by ${fmt(-r.marginGal, 1)} gal. This flight cannot legally be made non-stop with that fuel load.`);
      else if (r.marginGal < 2) warn.push('Under 2 gallons of margin above the legal minimum — plan a stop or reduce the leg.');
      return {
        primary: [
          { label: 'Fuel required', value: r.totalRequiredGal, unit: 'gal', decimals: 1 },
          { label: 'Margin', value: r.marginGal, unit: 'gal', decimals: 1, hint: Number.isFinite(r.marginGal) ? `${fmt((r.marginGal / v.burn) * 60, 0)} extra minutes` : '' },
        ],
        secondary: [
          { label: 'En-route time', text: `${hhmm(r.enrouteTimeMin)} (${fmt(r.enrouteTimeMin, 0)} min)` },
          { label: 'En-route fuel', value: r.enrouteGal, unit: 'gal', decimals: 1 },
          { label: 'Taxi & run-up', value: v.taxi || 0, unit: 'gal', decimals: 1 },
          { label: 'Climb allowance', value: v.climb || 0, unit: 'gal', decimals: 1 },
          v.altdist ? { label: 'To the alternate', text: `${fmt(r.alternateGal, 1)} gal · ${hhmm(r.alternateTimeMin)}` } : null,
          { label: `Reserve (${reserveMin} min)`, value: r.reserveGal, unit: 'gal', decimals: 1 },
          { label: 'Total required', value: r.totalRequiredGal, unit: 'gal', decimals: 1, emph: true },
          { label: 'Total weight (avgas at 6 lb/gal)', value: r.totalRequiredLb, unit: 'lb', decimals: 0 },
          { label: 'Full endurance', text: hhmm(r.enduranceMin) },
          { label: 'Still-air range', value: r.rangeNm, unit: 'NM', decimals: 0 },
          { label: 'Range keeping the reserve', value: r.rangeWithReserveNm, unit: 'NM', decimals: 0 },
        ].filter(Boolean),
        warn,
        notes: [
          '14 CFR 91.151 — VFR: fuel to the first point of intended landing plus 30 minutes by day, 45 at night, at normal cruise. 91.167 — IFR: to the destination, then to the alternate, then 45 minutes.',
        ],
      };
    },
  },

  {
    id: 'climb-descent',
    cat: 'Planning',
    name: 'Climb & descent',
    blurb: 'Rate, gradient, distance and time — give it what you know.',
    keywords: 'climb descent rate gradient feet per nautical mile percent angle time distance',
    fields: [
      { k: 'change', label: 'Altitude to gain (+) or lose (−)', kind: 'altitude', def: 3000, neg: true },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 110 },
      { k: 'dist', label: 'Distance available', kind: 'distance', def: 12 },
      { k: 'vs', label: 'Rate (if you know it)', kind: 'vspeed', def: '' },
    ],
    compute(v) {
      const r = M.climbDescent({
        altitudeChangeFt: v.change, distanceNm: Number.isFinite(v.dist) ? v.dist : undefined,
        gsKt: v.gs, vsFpm: Number.isFinite(v.vs) ? v.vs : undefined,
      });
      if (!Number.isFinite(r.vsFpm) && !Number.isFinite(r.distanceNm)) {
        return { error: 'Enter a distance or a rate along with the altitude change.' };
      }
      return {
        primary: [
          { label: v.change >= 0 ? 'Rate of climb needed' : 'Rate of descent needed', value: Math.abs(r.vsFpm), unit: 'ft/min', decimals: 0 },
          { label: 'Gradient', value: r.gradientFtPerNm, unit: 'ft/NM', decimals: 0, hint: `${fmt(r.gradientPct, 2)} % · ${fmt(r.angleDeg, 2)}°` },
        ],
        secondary: [
          { label: 'Time', text: `${hhmm(Math.abs(r.timeMin))} (${fmt(Math.abs(r.timeMin), 1)} min)` },
          { label: 'Distance', value: r.distanceNm, unit: 'NM', decimals: 1 },
          { label: 'Altitude change', value: v.change, unit: 'ft', decimals: 0 },
          { label: 'Angle', value: r.angleDeg, unit: '°', decimals: 2 },
        ],
        work: [
          `Gradient = ${fmt(Math.abs(v.change), 0)} ft ÷ ${fmt(r.distanceNm, 1)} NM = <b>${fmt(r.gradientFtPerNm, 0)} ft/NM</b>`,
          `Rate = gradient × GS ÷ 60 = ${fmt(r.gradientFtPerNm, 0)} × ${fmt(v.gs, 0)} ÷ 60 = <b>${fmt(Math.abs(r.vsFpm), 0)} fpm</b>`,
          `Percent gradient = ft/NM ÷ 60.76 = ${fmt(r.gradientPct, 2)} %`,
        ],
        notes: ['A departure procedure gradient in ft/NM converts to a rate of climb only through your groundspeed — the faster you go, the higher the rate you need.'],
      };
    },
  },

  {
    id: 'tod',
    cat: 'Planning',
    name: 'Top of descent',
    blurb: 'Where to start down, and the rate it takes.',
    keywords: 'top of descent tod start down planning cruise arrival',
    fields: [
      { k: 'cruise', label: 'Cruise altitude', kind: 'altitude', def: 9500 },
      { k: 'target', label: 'Target altitude', kind: 'altitude', def: 4500 },
      { k: 'vs', label: 'Planned rate of descent', kind: 'vspeed', def: 500 },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 120 },
      { k: 'before', label: 'Level off this far before the fix', kind: 'distance', def: 0 },
    ],
    compute(v) {
      const r = M.topOfDescent({
        cruiseAltFt: v.cruise, targetAltFt: v.target, vsFpm: v.vs, gsKt: v.gs,
        targetDistanceNm: v.before || 0,
      });
      if (r.altitudeToLoseFt <= 0) return { error: 'The target altitude is at or above the cruise altitude.' };
      return {
        primary: [
          { label: 'Start down at', value: r.startDescentDistanceNm, unit: 'NM', decimals: 1, hint: 'before the fix' },
          { label: 'Descent time', text: hhmm(r.descentTimeMin), hint: `${fmt(r.descentTimeMin, 1)} minutes` },
        ],
        secondary: [
          { label: 'Altitude to lose', value: r.altitudeToLoseFt, unit: 'ft', decimals: 0 },
          { label: 'Descent distance', value: r.descentDistanceNm, unit: 'NM', decimals: 1 },
          { label: 'Gradient', text: `${fmt(r.gradientFtPerNm, 0)} ft/NM · ${fmt(r.gradientPct, 2)} %` },
          { label: 'The 3-to-1 mental estimate', value: r.ruleOfThumbNm, unit: 'NM', decimals: 0 },
        ],
        work: [
          `Time = ${fmt(r.altitudeToLoseFt, 0)} ft ÷ ${fmt(v.vs, 0)} fpm = ${fmt(r.descentTimeMin, 2)} min`,
          `Distance = ${fmt(v.gs, 0)} kt × ${fmt(r.descentTimeMin, 2)} min ÷ 60 = <b>${fmt(r.descentDistanceNm, 1)} NM</b>`,
        ],
        notes: ['The 3-to-1 rule (3 NM per 1 000 ft to lose) matches a 3° path — it is close for light aircraft and conservative for jets.'],
      };
    },
  },

  {
    id: 'required-descent',
    cat: 'Planning',
    name: 'Required rate of descent',
    blurb: 'Cross a fix at an altitude: what rate does that take right now?',
    keywords: 'required rate descent crossing restriction fix altitude glidepath 3 degree',
    fields: [
      { k: 'alt', label: 'Altitude to lose', kind: 'altitude', def: 2500 },
      { k: 'dist', label: 'Distance to the fix', kind: 'distance', def: 8 },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 130 },
    ],
    compute(v) {
      const r = M.requiredDescent({ altitudeFt: v.alt, distanceNm: v.dist, gsKt: v.gs });
      return {
        primary: [
          { label: 'Rate of descent', value: r.vsFpm, unit: 'ft/min', decimals: 0 },
          { label: 'Gradient', value: r.gradientFtPerNm, unit: 'ft/NM', decimals: 0, hint: `${fmt(r.angleDeg, 2)}°` },
        ],
        secondary: [
          { label: 'Time to the fix', text: `${hhmm(r.timeMin)} (${fmt(r.timeMin, 1)} min)` },
          { label: 'Percent gradient', value: r.gradientPct, unit: '%', decimals: 2 },
          { label: 'A 3° path at this groundspeed', value: r.threeDegreeFpm, unit: 'ft/min', decimals: 0 },
        ],
        work: [
          `Gradient = ${fmt(v.alt, 0)} ÷ ${fmt(v.dist, 1)} = ${fmt(r.gradientFtPerNm, 0)} ft/NM`,
          `Rate = ${fmt(r.gradientFtPerNm, 0)} × ${fmt(v.gs, 0)} ÷ 60 = <b>${fmt(r.vsFpm, 0)} fpm</b>`,
          'Cross-check: half the groundspeed with a zero added is the 3° rate.',
        ],
      };
    },
  },

  {
    id: 'glide',
    cat: 'Planning',
    name: 'Glide',
    blurb: 'How far you can glide, and what ratio you are actually getting.',
    keywords: 'glide ratio engine failure distance sink rate best glide lift drag',
    fields: [
      { k: 'height', label: 'Height above the landing site', kind: 'altitude', def: 5000 },
      { k: 'ratio', label: 'Glide ratio (: 1)', kind: 'ratio', def: 9 },
      { k: 'gs', label: 'Glide groundspeed', kind: 'speed', def: 65 },
      { k: 'sink', label: 'Or measured sink rate', kind: 'vspeed', def: '' },
    ],
    compute(v) {
      const r = M.glide({
        heightAglFt: v.height,
        glideRatio: Number.isFinite(v.sink) ? undefined : v.ratio,
        gsKt: v.gs, sinkFpm: Number.isFinite(v.sink) ? v.sink : undefined,
      });
      if (!Number.isFinite(r.distanceNm)) return { error: 'Enter a glide ratio, or a groundspeed with a sink rate.' };
      return {
        primary: [
          { label: 'Glide distance', value: r.distanceNm, unit: 'NM', decimals: 2 },
          { label: 'Time aloft', text: hms(r.timeMin), hint: `${fmt(r.timeMin, 1)} minutes` },
        ],
        secondary: [
          { label: 'Glide ratio', text: `${fmt(r.glideRatio, 2)} : 1` },
          { label: 'Sink rate', value: r.sinkFpm, unit: 'ft/min', decimals: 0 },
          { label: 'Height lost per NM', value: r.ftPerNm, unit: 'ft/NM', decimals: 0 },
          { label: 'Glide angle', value: r.angleDeg, unit: '°', decimals: 2 },
          { label: 'Distance in statute miles', value: r.distanceNm * 1.15078, unit: 'SM', decimals: 2 },
        ],
        notes: ['This is still-air performance. A headwind eats the distance quickly — enter the glide groundspeed, not the airspeed, to account for it.'],
      };
    },
  },

  {
    id: 'turn',
    cat: 'Planning',
    name: 'Turn performance',
    blurb: 'Bank, rate, radius and load factor.',
    keywords: 'turn rate radius standard rate bank angle load factor 3 degrees per second',
    fields: [
      { k: 'tas', label: 'True airspeed', kind: 'speed', def: 110 },
      { k: 'bank', label: 'Bank angle', kind: 'angle', def: '' },
      { k: 'rate', label: 'Or rate of turn', kind: 'number', def: 3, hint: '°/sec' },
    ],
    compute(v) {
      let bank = v.bank, rate = v.rate;
      if (!Number.isFinite(bank)) {
        if (!Number.isFinite(rate)) return { error: 'Enter a bank angle or a rate of turn.' };
        bank = M.bankForRate(rate, v.tas);
      } else {
        rate = M.rateOfTurn(bank, v.tas);
      }
      const radiusFt = M.turnRadiusFt(bank, v.tas);
      const load = M.turnLoad(bank);
      const stdBank = M.standardRateBank(v.tas);
      const warn = [];
      if (bank > 30) warn.push('Steep turn: at more than 30° of bank the load factor climbs quickly and the stall speed with it.');
      return {
        primary: [
          { label: 'Bank angle', value: bank, unit: '°', decimals: 1 },
          { label: 'Rate of turn', value: rate, unit: '°/sec', decimals: 2 },
        ],
        secondary: [
          { label: 'Turn radius', text: `${fmt(radiusFt, 0)} ft · ${fmt(radiusFt / FT_PER_NM, 2)} NM` },
          { label: 'Turn diameter', text: `${fmt(2 * radiusFt / FT_PER_NM, 2)} NM` },
          { label: 'Time for 360°', text: hms(360 / rate / 60) },
          { label: 'Time for 180°', text: hms(180 / rate / 60) },
          { label: 'Load factor', text: `${fmt(load.loadFactor, 2)} G` },
          { label: 'Stall speed increase', text: `× ${fmt(load.stallSpeedFactor, 3)}` },
          { label: 'Standard-rate bank at this speed', value: stdBank, unit: '°', decimals: 1 },
          { label: 'The TAS/10 + 7 estimate', value: M.standardRateBankRuleOfThumb(v.tas), unit: '°', decimals: 0 },
          { label: 'Pivotal altitude', value: M.pivotalAltitudeFt(v.tas), unit: 'ft', decimals: 0 },
        ],
        warn,
        work: [
          `Rate (°/s) = ${fmt(M.TURN_RATE_CONST, 1)} × tan(bank) ÷ TAS = ${fmt(rate, 2)}  (the textbook rounds the constant to 1091)`,
          `Radius (ft) = TAS² ÷ (${fmt(M.TURN_RADIUS_CONST, 2)} × tan bank) = ${fmt(radiusFt, 0)}  (textbook 11.26)`,
          `Load factor = 1 ÷ cos(bank) = ${fmt(load.loadFactor, 3)}`,
        ],
        notes: ['A standard-rate turn is 3° per second — 2 minutes for a full circle, 1 minute for a 180. Above about 250 kt a standard rate needs more than 30° of bank, which is why fast aeroplanes use half-standard rate.'],
      };
    },
  },

  {
    id: 'load-factor',
    cat: 'Planning',
    name: 'Load factor & maneuvering speed',
    blurb: 'Stall speed in a turn, and how Va moves with weight.',
    keywords: 'load factor g stall speed bank va maneuvering weight limit',
    fields: [
      { k: 'bank', label: 'Bank angle', kind: 'angle', def: 45 },
      { k: 'vs', label: 'Wings-level stall speed', kind: 'speed', def: 48 },
      { k: 'va', label: 'Va at gross weight', kind: 'speed', def: 105 },
      { k: 'gross', label: 'Gross weight', kind: 'weight', def: 2400 },
      { k: 'actual', label: 'Actual weight', kind: 'weight', def: 2000 },
    ],
    compute(v) {
      const n = AS.loadFactor(v.bank);
      const vsTurn = AS.stallSpeedInTurn(v.vs, v.bank);
      const va = AS.maneuveringSpeed(v.va, v.gross, v.actual);
      return {
        primary: [
          { label: 'Load factor', text: `${fmt(n, 2)} G` },
          { label: 'Stall speed in the turn', value: vsTurn, unit: 'kt', decimals: 1 },
        ],
        secondary: [
          { label: 'Stall speed increase', text: `${fmt((vsTurn / v.vs - 1) * 100, 1)} %` },
          { label: 'Va at the actual weight', value: va, unit: 'kt', decimals: 1 },
          { label: 'Va reduction', value: v.va - va, unit: 'kt', decimals: 1 },
          { label: 'Bank for 2 G', text: '60°' },
          { label: 'Bank at which stall speed doubles', text: '75.5°' },
        ],
        work: [
          `n = 1 ÷ cos ${fmt(v.bank, 0)}° = ${fmt(n, 3)}`,
          `Vs(turn) = Vs × √n = ${fmt(v.vs, 0)} × ${fmt(Math.sqrt(n), 3)} = ${fmt(vsTurn, 1)} kt`,
          `Va scales with √(weight ratio) = √(${fmt(v.actual, 0)} ÷ ${fmt(v.gross, 0)}) = ${fmt(Math.sqrt(v.actual / v.gross), 3)}`,
        ],
        notes: ['Maneuvering speed goes <b>down</b> as the aeroplane gets lighter — a lighter wing accelerates to its limit load at a lower speed.'],
      };
    },
  },

  {
    id: 'pnr',
    cat: 'Planning',
    name: 'Point of no return',
    blurb: 'The last point you can still get home from.',
    keywords: 'point of no return pnr radius of action endurance return',
    fields: [
      { k: 'endur', label: 'Usable endurance', kind: 'time', def: 300 },
      { k: 'gsout', label: 'Groundspeed outbound', kind: 'speed', def: 105 },
      { k: 'gsback', label: 'Groundspeed returning', kind: 'speed', def: 135 },
    ],
    compute(v) {
      const r = N.pointOfNoReturn({ enduranceMin: v.endur, gsOutKt: v.gsout, gsBackKt: v.gsback });
      return {
        primary: [
          { label: 'Time to the PNR', text: hhmm(r.timeToPnrMin), hint: `${fmt(r.timeToPnrMin, 0)} minutes` },
          { label: 'Distance to the PNR', value: r.distanceToPnrNm, unit: 'NM', decimals: 1 },
        ],
        secondary: [
          { label: 'Time back from the PNR', text: hhmm(r.timeBackMin) },
          { label: 'Total endurance used', text: hhmm(v.endur) },
        ],
        work: [
          'Time out = endurance × GS(back) ÷ (GS(out) + GS(back))',
          `= ${fmt(v.endur, 0)} × ${fmt(v.gsback, 0)} ÷ (${fmt(v.gsout, 0)} + ${fmt(v.gsback, 0)}) = <b>${fmt(r.timeToPnrMin, 1)} min</b>`,
        ],
        notes: ['Use the endurance you are actually willing to burn — subtract your reserve first, or the PNR is the point of no fuel.'],
      };
    },
  },

  {
    id: 'etp',
    cat: 'Planning',
    name: 'Equal time point',
    blurb: 'Where continuing and turning back take the same time.',
    keywords: 'equal time point etp critical point cp decision',
    fields: [
      { k: 'dist', label: 'Total distance', kind: 'distance', def: 400 },
      { k: 'gson', label: 'Groundspeed continuing', kind: 'speed', def: 180 },
      { k: 'gsback', label: 'Groundspeed returning', kind: 'speed', def: 140 },
    ],
    compute(v) {
      const r = N.equalTimePoint({ distanceNm: v.dist, gsOnKt: v.gson, gsBackKt: v.gsback });
      return {
        primary: [
          { label: 'Distance to the ETP', value: r.distanceToEtpNm, unit: 'NM', decimals: 1 },
          { label: 'Time to the ETP', text: hhmm(r.timeToEtpMin) },
        ],
        secondary: [
          { label: 'From the ETP, onward', text: hhmm(r.timeOnFromEtpMin) },
          { label: 'From the ETP, back', text: hhmm(r.timeBackFromEtpMin) },
          { label: 'Percent of the way', text: `${fmt(100 * r.distanceToEtpNm / v.dist, 1)} %` },
        ],
        work: [
          'Distance = D × GS(back) ÷ (GS(on) + GS(back))',
          `= ${fmt(v.dist, 0)} × ${fmt(v.gsback, 0)} ÷ ${fmt(v.gson + v.gsback, 0)} = <b>${fmt(r.distanceToEtpNm, 1)} NM</b>`,
        ],
        notes: ['With no wind the ETP is the halfway point. A headwind outbound moves it closer to the departure field.'],
      };
    },
  },

  {
    id: 'holding-entry',
    cat: 'Planning',
    name: 'Holding entry',
    blurb: 'Direct, parallel or teardrop, with the headings to fly.',
    keywords: 'holding entry direct parallel teardrop pattern hold sector aim',
    fields: [
      { k: 'inbound', label: 'Inbound course to the fix', kind: 'bearing', def: 90 },
      { k: 'hdg', label: 'Your heading at the fix', kind: 'bearing', def: 200 },
      { k: 'turns', label: 'Turns', options: [{ value: 'right', label: 'Right (standard)' }, { value: 'left', label: 'Left (non-standard)' }], def: 'right' },
      { k: 'alt', label: 'Holding altitude', kind: 'altitude', def: 6000 },
    ],
    compute(v) {
      const r = H.holdingEntry({ inboundCourseDeg: v.inbound, headingDeg: v.hdg, turns: v.turns });
      const limit = H.holdingSpeedLimit(v.alt);
      const warn = r.boundaryNote ? [r.boundaryNote] : [];
      const names = { direct: 'Direct entry', parallel: 'Parallel entry', teardrop: 'Teardrop entry' };
      return {
        primary: [
          { label: 'Entry', text: names[r.entry], wide: true },
        ],
        secondary: [
          { label: 'Outbound course', text: deg(r.outboundCourseDeg) },
          { label: 'Teardrop heading', text: deg(r.teardropHeadingDeg) },
          { label: 'Parallel heading', text: deg(r.parallelHeadingDeg) },
          { label: 'Heading relative to the inbound course', text: `${fmt(r.relativeAngleDeg, 0)}°` },
          { label: 'Max holding speed here', text: `${limit.kias} KIAS — ${limit.note}` },
          { label: 'Standard leg time', text: `${H.holdingLegTimeMin(v.alt)} minute${H.holdingLegTimeMin(v.alt) > 1 ? 's' : ''}` },
        ],
        warn,
        notes: [
          r.description,
          'Sectors are ±5° tolerant by the AIM: near a boundary either entry is legal, so fly whichever keeps you in protected airspace.',
        ],
      };
    },
  },

  {
    id: 'holding-wind',
    cat: 'Planning',
    name: 'Holding wind correction',
    blurb: 'Triple the drift outbound, and time the leg so the inbound comes out right.',
    keywords: 'holding wind correction timing outbound leg triple drift one minute',
    fields: [
      { k: 'inbound', label: 'Inbound course', kind: 'bearing', def: 270 },
      { k: 'tas', label: 'True airspeed', kind: 'speed', def: 110 },
      { k: 'wdir', label: 'Wind from', kind: 'bearing', def: 200 },
      { k: 'wspd', label: 'Wind speed', kind: 'speed', def: 25 },
      { k: 'leg', label: 'Inbound leg time', kind: 'time', def: 1 },
    ],
    compute(v) {
      const r = H.holdWindCorrection({
        inboundCourseDeg: v.inbound, tasKt: v.tas,
        windDirDeg: v.wdir, windSpeedKt: v.wspd, legTimeMin: v.leg,
      });
      if (!Number.isFinite(r.outboundTimeMin) || r.outboundTimeMin <= 0) {
        return { error: 'The tailwind outbound exceeds the true airspeed — this hold cannot be flown at that speed.' };
      }
      return {
        primary: [
          { label: 'Outbound heading', text: deg(r.outboundHeadingDeg) },
          { label: 'Outbound time', text: hms(r.outboundTimeMin), hint: `${fmt(r.outboundTimeSec, 0)} seconds` },
        ],
        secondary: [
          { label: 'Inbound heading', text: deg(r.inboundHeadingDeg) },
          { label: 'Inbound drift correction', text: `${r.inboundWcaDeg >= 0 ? '+' : '−'}${fmt(Math.abs(r.inboundWcaDeg), 1)}°` },
          { label: 'Outbound correction (tripled)', text: `${r.outboundWcaDeg >= 0 ? '+' : '−'}${fmt(Math.abs(r.outboundWcaDeg), 1)}°` },
          { label: 'Inbound groundspeed', value: r.inboundGsKt, unit: 'kt', decimals: 0 },
          { label: 'Outbound groundspeed', value: r.outboundGsKt, unit: 'kt', decimals: 0 },
          { label: 'Leg length', value: r.legDistanceNm, unit: 'NM', decimals: 2 },
        ],
        notes: ['Timing starts abeam the fix outbound, or wings-level after the turn — whichever happens later. Adjust the next outbound leg by the error you saw on the inbound.'],
      };
    },
  },

  {
    id: 'vdp',
    cat: 'Planning',
    name: 'Visual descent point',
    blurb: 'How far before the threshold to leave MDA.',
    keywords: 'vdp visual descent point mda hat non precision approach',
    fields: [
      { k: 'mda', label: 'MDA', kind: 'altitude', def: 1200 },
      { k: 'tdze', label: 'Touchdown zone elevation', kind: 'altitude', def: 400 },
      { k: 'angle', label: 'Descent angle', kind: 'angle', def: 3 },
      { k: 'gs', label: 'Groundspeed', kind: 'speed', def: 90 },
    ],
    compute(v) {
      const r = M.visualDescentPoint({ mdaFt: v.mda, tdzeFt: v.tdze, angleDeg: v.angle });
      const fpm = r.gradientFtPerNm * (v.gs / 60);
      return {
        primary: [
          { label: 'VDP', value: r.vdpDistanceNm, unit: 'NM', decimals: 2, hint: 'before the threshold' },
          { label: 'Rate of descent from the VDP', value: fpm, unit: 'ft/min', decimals: 0 },
        ],
        secondary: [
          { label: 'Height above touchdown', value: r.heightAboveTdzeFt, unit: 'ft', decimals: 0 },
          { label: 'Gradient', value: r.gradientFtPerNm, unit: 'ft/NM', decimals: 0 },
          { label: 'The HAT ÷ 300 estimate', value: r.heightAboveTdzeFt / 300, unit: 'NM', decimals: 2 },
        ],
        notes: ['If the runway is not in sight by the VDP, a normal descent to the touchdown zone is no longer possible — plan the missed approach rather than diving at it.'],
      };
    },
  },

  {
    id: 'specific-range',
    cat: 'Planning',
    name: 'Specific range',
    blurb: 'Miles per gallon in the air, and what a power change is worth.',
    keywords: 'specific range nm per gallon efficiency economy power setting',
    fields: [
      { k: 'gs1', label: 'Groundspeed, setting A', kind: 'speed', def: 115 },
      { k: 'burn1', label: 'Fuel flow, setting A', kind: 'gph', def: 9.5 },
      { k: 'gs2', label: 'Groundspeed, setting B', kind: 'speed', def: 128 },
      { k: 'burn2', label: 'Fuel flow, setting B', kind: 'gph', def: 11.8 },
      { k: 'dist', label: 'Trip distance', kind: 'distance', def: 300 },
    ],
    compute(v) {
      const a = F.specificRange({ gsKt: v.gs1, burnGph: v.burn1 });
      const b = F.specificRange({ gsKt: v.gs2, burnGph: v.burn2 });
      const ta = (v.dist / v.gs1) * 60, tb = (v.dist / v.gs2) * 60;
      const fa = v.burn1 * ta / 60, fb = v.burn2 * tb / 60;
      return {
        primary: [
          { label: 'Setting A', value: a.nmPerGal, unit: 'NM/gal', decimals: 2 },
          { label: 'Setting B', value: b.nmPerGal, unit: 'NM/gal', decimals: 2 },
        ],
        secondary: [
          { label: 'Trip on setting A', text: `${hhmm(ta)} · ${fmt(fa, 1)} gal` },
          { label: 'Trip on setting B', text: `${hhmm(tb)} · ${fmt(fb, 1)} gal` },
          { label: 'Time saved by B', text: hhmm(ta - tb) },
          { label: 'Extra fuel for B', value: fb - fa, unit: 'gal', decimals: 2 },
          { label: 'Fuel per hour saved', text: `${fmt((fb - fa) / Math.max(1e-9, (ta - tb) / 60), 1)} gal per hour of time saved` },
        ],
        notes: ['Specific range is the honest measure of cruise efficiency: it already contains the wind, because it uses groundspeed.'],
      };
    },
  },
];
