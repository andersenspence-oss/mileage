// pages/navlog.js — a full VFR/IFR nav log: legs in, headings, times and fuel out.

import { computeNavLog } from '../core/flightplan.js';
import { el, esc, fmt, fmtDeg, getState, setState, parseNumber, renderTable } from '../ui.js';
import { hhmm } from '../core/units.js';

const ID = 'navlog';
const BLANK = () => ({ name: '', tc: '', dist: '', tas: '', wdir: '', wspd: '', alt: '' });

function state() {
  const s = getState(ID);
  if (!Array.isArray(s.legs) || !s.legs.length) {
    s.legs = [{ name: 'KSGU → KCDC', tc: '32', dist: '48', alt: '9500' }, BLANK()];
  }
  s.defaults ||= { tas: '110', wdir: '250', wspd: '18', varn: '11', burn: '9.5' };
  s.plan ||= { fuel: '38', taxi: '1.2', depart: '15:30' };
  return s;
}
const save = () => setState(ID, '__touch', Date.now());

function parseClock(text) {
  if (!text) return NaN;
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(text).trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}
function clock(min) {
  if (!Number.isFinite(min)) return '—';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function renderNavLog() {
  const s = state();
  const root = el('div', { class: 'page' });

  const rerender = () => {
    const next = renderNavLog();
    root.replaceWith(next);
  };

  const num = (obj, key, placeholder, cls = '', { neg = false } = {}) => {
    const i = el('input', {
      class: 'grid-input ' + cls, type: 'text', inputmode: 'decimal',
      value: obj[key] ?? '', placeholder, autocomplete: 'off',
    });
    i.addEventListener('input', () => { obj[key] = i.value; save(); update(); });
    if (!neg) return i;
    // iOS's decimal keypad has no minus key; give negative-capable fields a ± button.
    const sign = el('button', { class: 'sign-btn', type: 'button', title: 'Flip the sign' }, '±');
    sign.addEventListener('click', () => {
      const cur = String(i.value ?? '').trim();
      i.value = cur.startsWith('-') ? cur.slice(1) : cur === '' ? '-' : '-' + cur;
      obj[key] = i.value; save(); update();
    });
    return el('span', { class: 'pair tight' }, i, sign);
  };

  // ---- Aircraft & wind defaults -------------------------------------------
  const defs = el('div', { class: 'grid-4' },
    field('Cruise TAS', num(s.defaults, 'tas', 'kt')),
    field('Wind from', num(s.defaults, 'wdir', '°')),
    field('Wind speed', num(s.defaults, 'wspd', 'kt')),
    field('Variation E+/W−', num(s.defaults, 'varn', '°', '', { neg: true })),
    field('Fuel flow gal/hr', num(s.defaults, 'burn', 'gph')),
    field('Fuel on board', num(s.plan, 'fuel', 'gal')),
    field('Taxi fuel', num(s.plan, 'taxi', 'gal')),
    field('Departure (Z)', num(s.plan, 'depart', 'hh:mm')),
  );

  // ---- Legs ---------------------------------------------------------------
  const legWrap = el('div', { class: 'legs' });

  function legRow(leg, idx) {
    const nameInput = el('input', {
      class: 'grid-input wide', type: 'text', value: leg.name ?? '',
      placeholder: `Leg ${idx + 1} — checkpoint to checkpoint`, autocomplete: 'off',
    });
    nameInput.addEventListener('input', () => { leg.name = nameInput.value; save(); update(); });

    const del = el('button', { class: 'icon-btn', type: 'button', title: 'Remove this leg' }, '✕');
    del.addEventListener('click', () => { s.legs.splice(idx, 1); if (!s.legs.length) s.legs.push(BLANK()); save(); rerender(); });

    return el('div', { class: 'leg' },
      el('div', { class: 'leg-head' }, nameInput, del),
      el('div', { class: 'grid-5' },
        field('True course', num(leg, 'tc', '°')),
        field('Distance NM', num(leg, 'dist', 'NM')),
        field('Altitude', num(leg, 'alt', 'ft')),
        field('TAS (override)', num(leg, 'tas', s.defaults.tas)),
        field('Wind (override)', el('span', { class: 'pair' }, num(leg, 'wdir', s.defaults.wdir), num(leg, 'wspd', s.defaults.wspd))),
      ));
  }

  s.legs.forEach((leg, i) => legWrap.append(legRow(leg, i)));

  const addBtn = el('button', { class: 'btn', type: 'button' }, '+ Add leg');
  addBtn.addEventListener('click', () => { s.legs.push(BLANK()); save(); rerender(); });

  const out = el('div', { class: 'navlog-out' });

  function update() {
    const d = s.defaults;
    const legs = s.legs
      .filter((l) => Number.isFinite(parseNumber(l.tc)) && Number.isFinite(parseNumber(l.dist)))
      .map((l) => ({
        name: l.name || undefined,
        trueCourseDeg: parseNumber(l.tc),
        distanceNm: parseNumber(l.dist),
        tasKt: parseNumber(l.tas),
        windDirDeg: parseNumber(l.wdir),
        windSpeedKt: parseNumber(l.wspd),
      }));
    out.replaceChildren();
    if (!legs.length) {
      out.append(el('div', { class: 'note' }, 'Enter a true course and a distance for at least one leg.'));
      return;
    }
    const departMin = parseClock(s.plan.depart);
    const log = computeNavLog({
      legs,
      defaults: {
        tasKt: parseNumber(d.tas), windDirDeg: parseNumber(d.wdir), windSpeedKt: parseNumber(d.wspd),
        variationDeg: parseNumber(d.varn) || 0, burnGph: parseNumber(d.burn),
      },
      startFuelGal: parseNumber(s.plan.fuel),
      taxiFuelGal: parseNumber(s.plan.taxi) || 0,
      departMinUtc: departMin,
    });

    const rows = log.rows.map((r) => ({
      className: r.unflyable ? 'bad' : '',
      cells: [
        esc(r.name),
        `${fmtDeg(r.trueCourseDeg)}°`,
        `${fmtDeg(r.magneticHeadingDeg)}°`,
        fmt(r.distanceNm, 0),
        fmt(r.groundspeedKt, 0),
        hhmm(r.legTimeMin),
        hhmm(r.cumTimeMin),
        fmt(r.legFuelGal, 1),
        Number.isFinite(r.fuelRemainingGal) ? fmt(r.fuelRemainingGal, 1) : '—',
        Number.isFinite(r.etaMinUtc) ? clock(r.etaMinUtc) : '—',
      ],
    }));

    out.append(renderTable({
      head: ['Leg', 'TC', 'MH', 'NM', 'GS', 'ETE', 'Total', 'Fuel', 'Rem', 'ETA'],
      rows,
      className: 'navlog-table',
    }));

    const warn = [];
    if (log.rows.some((r) => r.unflyable)) warn.push('One leg cannot be flown — the crosswind exceeds the true airspeed.');
    if (Number.isFinite(log.fuelRemainingGal) && log.fuelRemainingGal < 0) {
      warn.push(`You run out of fuel before the destination — short by ${fmt(-log.fuelRemainingGal, 1)} gal.`);
    } else if (Number.isFinite(log.fuelRemainingGal) && Number.isFinite(parseNumber(d.burn))) {
      const reserveMin = (log.fuelRemainingGal / parseNumber(d.burn)) * 60;
      if (reserveMin < 45) warn.push(`Only ${fmt(reserveMin, 0)} minutes of fuel remain on arrival — below the 45-minute IFR/night reserve.`);
    }
    for (const w of warn) out.append(el('div', { class: 'warn' }, w));

    const reserveMin = Number.isFinite(log.fuelRemainingGal) && parseNumber(d.burn)
      ? (log.fuelRemainingGal / parseNumber(d.burn)) * 60 : NaN;

    out.append(el('div', { class: 'primary-grid' },
      stat('Total distance', `${fmt(log.totalDistanceNm, 0)}`, 'NM'),
      stat('Total time', hhmm(log.totalTimeMin), ''),
      stat('Total fuel', `${fmt(log.totalFuelGal, 1)}`, 'gal'),
      stat('Fuel remaining', Number.isFinite(log.fuelRemainingGal) ? fmt(log.fuelRemainingGal, 1) : '—', 'gal'),
    ));
    out.append(el('div', { class: 'sec-list' },
      secRow('Average groundspeed', `${fmt(log.averageGsKt, 0)} kt`),
      secRow('Arrival time', Number.isFinite(log.etaMinUtc) ? `${clock(log.etaMinUtc)}Z` : '—'),
      secRow('Reserve on arrival', Number.isFinite(reserveMin) ? hhmm(reserveMin) : '—'),
    ));
  }

  root.append(
    el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Aircraft, wind and fuel'), defs),
    el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Legs'), legWrap, addBtn),
    el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Nav log'), out),
    el('div', { class: 'note' }, 'Per-leg boxes left empty fall back to the cruise values above. Magnetic headings apply the variation; enter west variation as a negative number.'),
  );
  update();
  return root;
}

function field(label, input) {
  return el('label', { class: 'gfld' }, el('span', { class: 'gfld-label' }, label), input);
}
function stat(label, value, unit) {
  return el('div', { class: 'primary' },
    el('div', { class: 'p-label' }, label),
    el('div', { class: 'p-value' }, el('span', { class: 'p-num' }, value), unit ? el('span', { class: 'p-unit' }, unit) : null));
}
function secRow(label, value) {
  return el('div', { class: 'sec' }, el('span', { class: 's-label' }, label), el('span', { class: 's-value' }, value));
}
