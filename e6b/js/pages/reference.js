// pages/reference.js — the tables worth having in front of you on the written
// test and in the cockpit. Regulation citations are given so anything here can
// be checked against the source.

import { standardAtmosphereRow } from '../core/atmosphere.js';
import { windComponents } from '../core/wind.js';
import { standardRateBank, turnRadiusNm, pivotalAltitudeFt } from '../core/maneuver.js';
import { el, fmt, renderTable } from '../ui.js';

export function renderReference() {
  const root = el('div', { class: 'page' });
  const sections = [];

  const add = (id, title, ...body) => {
    sections.push({ id, title });
    root.append(el('section', { class: 'card', id: `ref-${id}` },
      el('h3', { class: 'card-title' }, title), ...body));
  };

  // ---------------------------------------------------------------- VFR mins
  add('vfr', 'VFR weather minimums — 14 CFR 91.155',
    renderTable({
      head: ['Airspace', 'Visibility', 'Distance from clouds'],
      rows: [
        ['Class A', 'Not applicable', 'IFR only'],
        ['Class B', '3 SM', 'Clear of clouds'],
        ['Class C', '3 SM', '500 below · 1 000 above · 2 000 horizontal'],
        ['Class D', '3 SM', '500 below · 1 000 above · 2 000 horizontal'],
        ['Class E — below 10 000 MSL', '3 SM', '500 below · 1 000 above · 2 000 horizontal'],
        ['Class E — at/above 10 000 MSL', '5 SM', '1 000 below · 1 000 above · 1 SM horizontal'],
        ['Class G — 1 200 AGL or less, <b>day</b>', '1 SM', 'Clear of clouds'],
        ['Class G — 1 200 AGL or less, <b>night</b>', '3 SM', '500 below · 1 000 above · 2 000 horizontal'],
        ['Class G — above 1 200 AGL, below 10 000 MSL, day', '1 SM', '500 below · 1 000 above · 2 000 horizontal'],
        ['Class G — above 1 200 AGL, below 10 000 MSL, night', '3 SM', '500 below · 1 000 above · 2 000 horizontal'],
        ['Class G — above 1 200 AGL and at/above 10 000 MSL', '5 SM', '1 000 below · 1 000 above · 1 SM horizontal'],
      ],
    }),
    note('Night exception, 91.155(b): in Class G at or below 1 200 ft AGL, an aeroplane in the traffic pattern within ½ mile of the runway may use 1 SM and clear of clouds. 91.155(c): you may not operate beneath the ceiling of a Class B, C, D or E surface area when the reported visibility is less than 3 SM. 91.155(d): special VFR needs 1 SM and clear of clouds, and at night both an instrument rating and an instrument-capable aeroplane.'));

  // ------------------------------------------------------------------- fuel
  add('fuel', 'Fuel, oxygen and lights',
    renderTable({
      head: ['Rule', 'Requirement'],
      rows: [
        ['Fuel, VFR day — 91.151', 'To the first point of intended landing plus <b>30 minutes</b> at normal cruise'],
        ['Fuel, VFR night — 91.151', 'Destination plus <b>45 minutes</b>'],
        ['Fuel, VFR helicopter — 91.151', 'Destination plus <b>20 minutes</b>'],
        ['Fuel, IFR — 91.167', 'Destination, then to the alternate, then <b>45 minutes</b> at normal cruise'],
        ['Alternate required — 91.169', '1-2-3 rule: from 1 hour before to 1 hour after ETA the forecast ceiling is below 2 000 ft or visibility below 3 SM'],
        ['Alternate minimums — 91.169(c)', 'Precision approach 600-2; non-precision 800-2; no IAP, descent and landing must be possible in VMC'],
        ['Oxygen, crew — 91.211', 'Cabin pressure altitude <b>12 500–14 000 MSL</b>: required for any part over 30 minutes'],
        ['Oxygen, crew — 91.211', 'Above <b>14 000 MSL</b>: the entire flight at that altitude'],
        ['Oxygen, passengers — 91.211', 'Above <b>15 000 MSL</b>: must be <i>provided</i> to every occupant'],
        ['Position lights — 91.209', 'Sunset to sunrise'],
        ['Loggable night — 1.1', 'End of evening civil twilight to the beginning of morning civil twilight'],
        ['Night currency — 61.57(b)', '3 takeoffs and landings to a full stop between 1 hour after sunset and 1 hour before sunrise, within 90 days'],
      ],
    }));

  // -------------------------------------------------------------- airspace
  add('airspace', 'Airspace at a glance',
    renderTable({
      head: ['Class', 'Vertical limits', 'Entry', 'Equipment'],
      rows: [
        ['A', '18 000 MSL to FL600', 'IFR clearance', 'Transponder + ADS-B Out, IFR equipment'],
        ['B', 'Surface to about 10 000 MSL', '<b>Clearance</b> — "cleared into the Class Bravo"', 'Two-way radio, Mode C, ADS-B Out; private certificate or endorsed student'],
        ['C', 'Surface to 4 000 AGL (5 NM core, 10 NM shelf from 1 200 AGL)', 'Two-way radio <b>established</b>', 'Two-way radio, Mode C, ADS-B Out'],
        ['D', 'Surface to about 2 500 AGL', 'Two-way radio <b>established</b>', 'Two-way radio'],
        ['E', 'From 700 or 1 200 AGL (or the surface) up to but not including 18 000 MSL', 'None for VFR', 'Mode C above 10 000 MSL'],
        ['G', 'Surface up to 700, 1 200 or 14 500 MSL', 'None', 'None'],
      ],
    }),
    renderTable({
      head: ['Speed limit — 91.117', 'Where'],
      rows: [
        ['250 KIAS', 'Below 10 000 ft MSL'],
        ['200 KIAS', 'At or below 2 500 ft AGL within 4 NM of the primary Class C or D airport'],
        ['200 KIAS', 'Beneath Class B airspace, or in a VFR corridor through it'],
        ['No FAA speed limit from 91.117', 'At or above 10 000 ft MSL (Mach limits and 91.817 still apply)'],
      ],
    }),
    renderTable({
      head: ['Transponder & ADS-B Out — 91.215, 91.225', 'Required'],
      rows: [
        ['Class A, B and C', 'Always'],
        ['Above the ceiling of Class B or C, up to 10 000 MSL', 'Yes'],
        ['Within the 30 NM Mode C veil of a Class B primary airport', 'Surface to 10 000 MSL'],
        ['Above 10 000 ft MSL', 'Yes, except at or below 2 500 ft AGL'],
        ['Class E airspace over the Gulf of Mexico', 'ADS-B: at and above 3 000 MSL within 12 NM of the US coast'],
      ],
    }));

  // ------------------------------------------------------------- altitudes
  add('altitudes', 'Cruising altitudes & currency',
    renderTable({
      head: ['Rule', 'Magnetic course 0–179°', 'Magnetic course 180–359°'],
      rows: [
        ['VFR more than 3 000 ft AGL — 91.159', 'Odd thousand + 500 (3 500, 5 500, 7 500…)', 'Even thousand + 500 (4 500, 6 500, 8 500…)'],
        ['IFR below 18 000 MSL — 91.179', 'Odd thousands (3 000, 5 000…)', 'Even thousands (4 000, 6 000…)'],
      ],
    }),
    renderTable({
      head: ['Currency', 'Requirement'],
      rows: [
        ['Flight review — 61.56', 'Every 24 calendar months: 1 hour ground + 1 hour flight'],
        ['Passenger currency — 61.57(a)', '3 takeoffs and landings in the preceding 90 days, same category, class and type'],
        ['Tailwheel / night full-stop', 'Landings must be to a full stop'],
        ['Instrument currency — 61.57(c)', 'Within 6 calendar months: 6 instrument approaches, holding, intercepting and tracking'],
        ['Medical — 61.23', 'Third class: 60 months if under 40 at the exam, 24 months if 40 or over'],
      ],
    }),
    renderTable({
      head: ['Inspections — AV1ATE', 'Interval'],
      rows: [
        ['<b>A</b>nnual — 91.409', '12 calendar months'],
        ['<b>V</b>OR check — 91.171', '30 days (IFR only)'],
        ['<b>1</b>00 hour — 91.409', 'For hire or flight instruction given for hire'],
        ['<b>A</b>ltimeter & static system — 91.411', '24 calendar months (IFR)'],
        ['<b>T</b>ransponder — 91.413', '24 calendar months'],
        ['<b>E</b>LT — 91.207', '12 calendar months; battery at 1 hour of use or 50 % of life'],
        ['Documents aboard — ARROW', 'Airworthiness certificate, Registration, Radio licence (international), Operating limitations, Weight and balance'],
      ],
    }));

  // --------------------------------------------------------- light signals
  add('lightgun', 'Light gun signals — AIM 4-3-13',
    renderTable({
      head: ['Signal', 'On the ground', 'In flight'],
      rows: [
        ['Steady <span class="sig g">green</span>', 'Cleared for takeoff', 'Cleared to land'],
        ['Flashing <span class="sig g">green</span>', 'Cleared to taxi', 'Return for landing — a steady green will follow'],
        ['Steady <span class="sig r">red</span>', 'Stop', 'Give way to other aircraft and continue circling'],
        ['Flashing <span class="sig r">red</span>', 'Taxi clear of the runway in use', 'Airport unsafe — do not land'],
        ['Flashing <span class="sig w">white</span>', 'Return to the starting point on the airport', 'Not applicable'],
        ['Alternating <span class="sig r">red</span>/<span class="sig g">green</span>', 'General warning — exercise extreme caution', 'General warning — exercise extreme caution'],
      ],
    }),
    note('Acknowledge by rocking the wings in daylight, or blinking the landing light at night. On the ground, move the ailerons or rudder.'));

  // ---------------------------------------------------------------- compass
  add('compass', 'Magnetic compass errors',
    renderTable({
      head: ['Error', 'What happens', 'Mnemonic'],
      rows: [
        ['Turning error', 'Turning to a <b>northerly</b> heading the compass lags — roll out early (undershoot). Turning to a <b>southerly</b> heading it leads — roll out late (overshoot). The lead or lag is roughly your latitude in degrees.', '<b>UNOS</b> — Undershoot North, Overshoot South'],
        ['Acceleration error', 'On an <b>east or west</b> heading, accelerating shows a turn toward north and decelerating a turn toward south.', '<b>ANDS</b> — Accelerate North, Decelerate South'],
        ['Variation', 'The angle between true and magnetic north; shown by isogonic lines on the chart.', 'East is least (subtract), west is best (add)'],
        ['Deviation', 'Error from magnetism inside the aeroplane; read it off the compass correction card.', 'Applied last, magnetic → compass'],
        ['Oscillation', 'Erratic swinging in turbulence — a combination of the errors above.', '—'],
        ['Dip', 'The physical cause of turning and acceleration error: the card tilts toward the magnetic pole.', '—'],
      ],
    }));

  // --------------------------------------------------------------- v-speeds
  add('vspeeds', 'V-speeds',
    renderTable({
      head: ['Speed', 'Meaning'],
      rows: [
        ['V<sub>SO</sub>', 'Stall speed in the landing configuration — the bottom of the white arc'],
        ['V<sub>S1</sub>', 'Stall speed in a specified configuration, usually clean — the bottom of the green arc'],
        ['V<sub>FE</sub>', 'Maximum flap extended — the top of the white arc'],
        ['V<sub>NO</sub>', 'Maximum structural cruising — the top of the green arc; stay below it in rough air'],
        ['V<sub>NE</sub>', 'Never exceed — the red line'],
        ['V<sub>A</sub>', 'Maneuvering speed. Not marked on the ASI, and it <b>decreases</b> with weight (× √weight ratio)'],
        ['V<sub>X</sub>', 'Best angle of climb — most altitude per unit of <i>distance</i>, for clearing obstacles'],
        ['V<sub>Y</sub>', 'Best rate of climb — most altitude per unit of <i>time</i>'],
        ['V<sub>G</sub>', 'Best glide — the greatest distance per foot of altitude lost'],
        ['V<sub>LE</sub> / V<sub>LO</sub>', 'Maximum with the gear extended / maximum for operating the gear'],
        ['V<sub>MC</sub>', 'Minimum control speed with the critical engine inoperative — the red radial on a twin'],
        ['V<sub>YSE</sub>', 'Best rate of climb single-engine — the blue line'],
      ],
    }),
    note('With altitude, V<sub>X</sub> increases and V<sub>Y</sub> decreases (in true airspeed) until they meet at the absolute ceiling.'));

  // ------------------------------------------------------------ rules of thumb
  add('rules', 'Rules of thumb',
    renderTable({
      head: ['Rule', 'Use'],
      rows: [
        ['<b>1 in 60</b>', '1 NM off course at 60 NM is 1° of error. Also: 1° of course error puts you 1 NM off after 60 NM.'],
        ['<b>60 to 1</b>', 'A 1° glidepath is about 100 ft/NM, so 3° ≈ 300 ft/NM (318 exactly).'],
        ['<b>Groundspeed × 5</b>', 'The rate of descent for a 3° path. 120 kt → 600 fpm.'],
        ['<b>3 to 1</b>', 'Start down 3 NM for every 1 000 ft to lose.'],
        ['<b>Half the groundspeed</b>', 'Roll into a standard-rate turn using a bank of TAS ÷ 10 + 7 degrees.'],
        ['<b>2 % per 1 000 ft</b>', 'Rough TAS increase over CAS. Optimistic — the real figure is nearer 1.6 %/1 000 ft low down.'],
        ['<b>Clock face</b>', 'Crosswind ≈ wind speed × (angle ÷ 60), capped at the full wind. 30° → ½, 45° → ¾, 60°+ → all of it.'],
        ['<b>Spread ÷ 2.5</b>', 'Convective cloud base in thousands of feet from the temperature/dewpoint spread in °C.'],
        ['<b>Lead the turn</b>', 'Roll out using half the bank angle as the lead in degrees.'],
        ['<b>Lead the descent</b>', 'Begin levelling off at 10 % of the rate of descent in feet (500 fpm → 50 ft early).'],
        ['<b>Time to a station</b>', 'Minutes to the station = 60 × minutes flown ÷ degrees of bearing change.'],
      ],
    }));

  // --------------------------------------------------------- generated tables
  const atmRows = [0, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 14000, 16000,
    18000, 20000, 25000, 30000, 35000, 36089, 40000].map((h) => {
    const r = standardAtmosphereRow(h);
    return [fmt(h, 0), fmt(r.tempC, 1), fmt(r.tempF, 0), fmt(r.pressureInHg, 2), fmt(r.pressureHpa, 0),
      fmt(r.densityRatio, 4), `× ${fmt(r.tasFactor, 3)}`, fmt(r.speedOfSoundKt, 0)];
  });
  add('atmosphere', 'ICAO standard atmosphere',
    renderTable({
      head: ['Alt (ft)', '°C', '°F', 'inHg', 'hPa', 'σ', 'TAS/CAS', 'a (kt)'],
      rows: atmRows,
      className: 'compact',
    }),
    note('Lapse rate 1.98 °C per 1 000 ft to the tropopause at 36 089 ft, constant −56.5 °C above it. Pressure halves at about 18 000 ft.'));

  const angles = [10, 20, 30, 40, 45, 50, 60, 70, 80, 90];
  add('xwind', 'Wind component table',
    renderTable({
      head: ['Angle off', 'Headwind', 'Crosswind'],
      rows: angles.map((a) => {
        const c = windComponents({ runwayHeadingDeg: 0, windDirDeg: a, windSpeedKt: 100 });
        return [`${a}°`, `${fmt(c.headwindKt, 0)} %`, `${fmt(c.crosswindKt, 0)} %`];
      }),
      className: 'compact',
    }),
    note('Percentages of the total wind speed. A 20 kt wind 40° off the runway gives 15 kt of headwind and 13 kt of crosswind.'));

  const speeds = [60, 80, 90, 100, 120, 140, 160, 200, 250];
  add('turns', 'Standard-rate turns',
    renderTable({
      head: ['TAS (kt)', 'Bank for 3°/sec', 'Radius (NM)', 'Pivotal altitude (ft)'],
      rows: speeds.map((v) => [
        fmt(v, 0),
        `${fmt(standardRateBank(v), 1)}°`,
        fmt(turnRadiusNm(standardRateBank(v), v), 2),
        fmt(pivotalAltitudeFt(v), 0),
      ]),
      className: 'compact',
    }),
    note('A standard-rate turn takes 2 minutes for 360° and 1 minute for 180°. Above about 250 kt it would need more than 30° of bank, so half-standard rate is used instead.'));

  // ------------------------------------------------------------------- index
  const toc = el('nav', { class: 'toc' },
    ...sections.map((sc) => {
      const a = el('a', { href: `#reference`, class: 'chip' }, sc.title.split(' — ')[0]);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById(`ref-${sc.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return a;
    }));
  root.prepend(toc);
  root.append(el('div', { class: 'note' }, 'Regulations are summarised for study. The controlling text is 14 CFR and the AIM — check the current edition before relying on any of it in flight.'));
  return root;
}

function note(html) {
  return el('div', { class: 'note', html });
}
