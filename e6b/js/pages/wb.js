// pages/wb.js — weight and balance with a live CG envelope.

import * as WB from '../core/wb.js';
import { FUEL_LB_PER_GAL } from '../core/units.js';
import { el, fmt, getState, setState, parseNumber, renderTable } from '../ui.js';

const ID = 'wb';

const DEFAULT_STATIONS = [
  { name: 'Empty weight', weight: '1467', arm: '39.0', lock: true },
  { name: 'Front seats', weight: '340', arm: '37.0' },
  { name: 'Rear seats', weight: '0', arm: '73.0' },
  { name: 'Fuel (gal)', weight: '38', arm: '48.0', fuel: true },
  { name: 'Baggage area 1', weight: '20', arm: '95.0' },
  { name: 'Baggage area 2', weight: '0', arm: '123.0' },
];

// A typical four-seat single: the forward limit slopes aft above 1 950 lb.
const DEFAULT_ENVELOPE = '1500,35\n1950,35\n2300,40.5\n2300,47.3\n1500,47.3';

function state() {
  const s = getState(ID);
  if (!Array.isArray(s.stations) || !s.stations.length) s.stations = DEFAULT_STATIONS.map((x) => ({ ...x }));
  s.limits ||= { gross: '2300', fwd: '35', aft: '47.3', fuelType: 'Avgas 100LL', burn: '0' };
  if (s.envelope === undefined) s.envelope = DEFAULT_ENVELOPE;
  return s;
}
const save = () => setState(ID, '__touch', Date.now());

function parseEnvelope(text) {
  const pts = String(text || '').split(/[\n;]+/).map((line) => {
    const [w, c] = line.split(/[, \t]+/).map((x) => parseNumber(x));
    return Number.isFinite(w) && Number.isFinite(c) ? { weight: w, cg: c } : null;
  }).filter(Boolean);
  return pts.length >= 3 ? pts : null;
}

export function renderWB() {
  const s = state();
  const root = el('div', { class: 'page' });
  const rerender = () => root.replaceWith(renderWB());

  const rowsWrap = el('div', { class: 'stations' });
  const out = el('div', {});

  const inp = (obj, key, placeholder, cls = '') => {
    const i = el('input', { class: 'grid-input ' + cls, type: 'text', inputmode: 'decimal', value: obj[key] ?? '', placeholder, autocomplete: 'off' });
    i.addEventListener('input', () => { obj[key] = i.value; save(); update(); });
    return i;
  };

  s.stations.forEach((st, idx) => {
    const nameInput = el('input', { class: 'grid-input wide', type: 'text', value: st.name ?? '', placeholder: 'Station', autocomplete: 'off' });
    nameInput.addEventListener('input', () => { st.name = nameInput.value; save(); update(); });
    const del = el('button', { class: 'icon-btn', type: 'button', title: 'Remove' }, '✕');
    del.addEventListener('click', () => { s.stations.splice(idx, 1); save(); rerender(); });
    const fuelToggle = el('button', { class: 'chip small' + (st.fuel ? ' on' : ''), type: 'button', title: 'Treat this row as gallons of fuel' }, st.fuel ? 'gal' : 'lb');
    fuelToggle.addEventListener('click', () => { st.fuel = !st.fuel; save(); rerender(); });
    rowsWrap.append(el('div', { class: 'station' },
      nameInput,
      inp(st, 'weight', st.fuel ? 'gal' : 'lb', 'num'),
      fuelToggle,
      inp(st, 'arm', 'arm in', 'num'),
      del));
  });

  const addBtn = el('button', { class: 'btn', type: 'button' }, '+ Add station');
  addBtn.addEventListener('click', () => { s.stations.push({ name: '', weight: '', arm: '' }); save(); rerender(); });

  const fuelSel = el('select', { class: 'fld-select' },
    ...Object.keys(FUEL_LB_PER_GAL).map((k) => el('option', { value: k, selected: s.limits.fuelType === k }, `${k} — ${FUEL_LB_PER_GAL[k]} lb/gal`)));
  fuelSel.addEventListener('change', () => { s.limits.fuelType = fuelSel.value; save(); update(); });

  const envArea = el('textarea', { class: 'envelope-input', rows: 5, spellcheck: 'false', placeholder: 'weight, cg (one vertex per line)' }, s.envelope);
  envArea.addEventListener('input', () => { s.envelope = envArea.value; save(); update(); });

  function update() {
    const lbPerGal = FUEL_LB_PER_GAL[s.limits.fuelType] ?? 6;
    const stations = s.stations.map((st) => {
      const raw = parseNumber(st.weight);
      const weight = st.fuel ? raw * lbPerGal : raw;
      return { name: st.name || 'Station', weight: Number.isFinite(weight) ? weight : 0, arm: parseNumber(st.arm), fuel: !!st.fuel, gallons: raw };
    });
    const sheet = WB.loadSheet(stations);
    const gross = parseNumber(s.limits.gross);
    const envelope = parseEnvelope(s.envelope);
    const check = WB.checkLimits({
      totalWeightLb: sheet.totalWeightLb, cgIn: sheet.cgIn, maxGrossLb: gross,
      forwardLimitIn: parseNumber(s.limits.fwd), aftLimitIn: parseNumber(s.limits.aft),
      envelope,
    });

    // Landing condition after burning fuel.
    const burnGal = parseNumber(s.limits.burn) || 0;
    const fuelRow = stations.find((x) => x.fuel);
    let landing = null;
    if (burnGal > 0 && fuelRow) {
      landing = WB.afterFuelBurn({
        totalWeightLb: sheet.totalWeightLb, cgIn: sheet.cgIn,
        fuelBurnedLb: Math.min(burnGal * lbPerGal, fuelRow.weight), fuelArmIn: fuelRow.arm,
      });
    }

    out.replaceChildren();
    for (const p of check.problems) out.append(el('div', { class: 'warn' }, p));
    if (check.ok) out.append(el('div', { class: 'ok' }, 'Within weight and balance limits.'));

    out.append(el('div', { class: 'primary-grid' },
      stat('Total weight', fmt(sheet.totalWeightLb, 0), 'lb'),
      stat('Center of gravity', fmt(sheet.cgIn, 2), 'in'),
    ));

    out.append(renderTable({
      head: ['Station', 'Weight', 'Arm', 'Moment'],
      rows: [
        ...sheet.rows.map((r) => [
          r.name + (r.fuel && Number.isFinite(r.gallons) ? ` (${fmt(r.gallons, 1)} gal)` : ''),
          fmt(r.weight, 1),
          Number.isFinite(r.arm) ? fmt(r.arm, 2) : '—',
          fmt(r.moment, 0),
        ]),
        { className: 'total', cells: ['Total', fmt(sheet.totalWeightLb, 1), fmt(sheet.cgIn, 2), fmt(sheet.totalMomentLbIn, 0)] },
      ],
    }));

    const sec = [];
    if (Number.isFinite(gross)) sec.push(secRow('Useful load remaining', `${fmt(gross - sheet.totalWeightLb, 0)} lb`));
    if (check.limits) {
      sec.push(secRow('CG limits at this weight', `${fmt(check.limits.forwardLimitIn, 2)} to ${fmt(check.limits.aftLimitIn, 2)} in`));
      sec.push(secRow('Margin forward / aft', `${fmt(check.marginFwdIn, 2)} in / ${fmt(check.marginAftIn, 2)} in`));
    }
    sec.push(secRow('Moment index (÷1000)', fmt(sheet.totalMomentLbIn / 1000, 2)));
    if (landing) {
      sec.push(secRow('Landing weight', `${fmt(landing.newWeightLb, 0)} lb`));
      sec.push(secRow('Landing CG', `${fmt(landing.newCgIn, 2)} in (${landing.cgShiftIn >= 0 ? '+' : ''}${fmt(landing.cgShiftIn, 2)})`));
      if (envelope && WB.inEnvelope({ cgIn: landing.newCgIn, weightLb: landing.newWeightLb }, envelope) === false) {
        out.append(el('div', { class: 'warn' }, 'The CG moves outside the envelope as fuel burns off.'));
      }
    }
    out.append(el('div', { class: 'sec-list' }, ...sec));

    if (envelope) {
      out.append(envelopeChart(envelope, { cg: sheet.cgIn, weight: sheet.totalWeightLb },
        landing ? { cg: landing.newCgIn, weight: landing.newWeightLb } : null));
    }
  }

  root.append(
    el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Loading'),
      el('div', { class: 'station station-head' },
        el('span', {}, 'Station'), el('span', {}, 'Weight'), el('span', {}, ''), el('span', {}, 'Arm'), el('span', {})),
      rowsWrap, addBtn,
      el('div', { class: 'grid-4' },
        gfield('Fuel grade', fuelSel),
        gfield('Fuel burn en route (gal)', inp(s.limits, 'burn', 'gal')),
      )),
    el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Limits'),
      el('div', { class: 'grid-4' },
        gfield('Max gross (lb)', inp(s.limits, 'gross', 'lb')),
        gfield('Forward CG limit (in)', inp(s.limits, 'fwd', 'in')),
        gfield('Aft CG limit (in)', inp(s.limits, 'aft', 'in')),
      ),
      el('details', { class: 'work' },
        el('summary', {}, 'CG envelope vertices'),
        el('div', { class: 'work-body' },
          el('p', { class: 'note', html: 'One vertex per line as <b>weight, CG</b>, tracing the envelope from the POH. Leave it blank to fall back on the simple forward/aft limits.' }),
          envArea))),
    el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Result'), out),
    el('div', { class: 'note' }, 'Arms are in inches from the datum, and a row marked "gal" is entered in gallons and converted with the grade you pick. The starting numbers are a typical four-seat single — replace them with the figures from your own weight and balance sheet.'),
  );
  update();
  return root;
}

function envelopeChart(envelope, point, landingPoint) {
  const W = 320, Hh = 240, pad = 34;
  const cgs = envelope.map((p) => p.cg).concat(point.cg, landingPoint ? [landingPoint.cg] : []);
  const wts = envelope.map((p) => p.weight).concat(point.weight, landingPoint ? [landingPoint.weight] : []);
  const minX = Math.min(...cgs) - 1, maxX = Math.max(...cgs) + 1;
  const minY = Math.min(...wts) - 50, maxY = Math.max(...wts) + 50;
  const x = (cg) => pad + ((cg - minX) / (maxX - minX)) * (W - pad - 8);
  const y = (w) => Hh - pad - ((w - minY) / (maxY - minY)) * (Hh - pad - 10);
  const poly = envelope.map((p) => `${x(p.cg)},${y(p.weight)}`).join(' ');

  const svg = `
  <svg viewBox="0 0 ${W} ${Hh}" class="env-chart" role="img" aria-label="Center of gravity envelope">
    <rect x="${pad}" y="10" width="${W - pad - 8}" height="${Hh - pad - 10}" class="env-bg"/>
    <polygon points="${poly}" class="env-poly"/>
    <line x1="${pad}" y1="${Hh - pad}" x2="${W - 8}" y2="${Hh - pad}" class="env-axis"/>
    <line x1="${pad}" y1="10" x2="${pad}" y2="${Hh - pad}" class="env-axis"/>
    ${landingPoint ? `<line x1="${x(point.cg)}" y1="${y(point.weight)}" x2="${x(landingPoint.cg)}" y2="${y(landingPoint.weight)}" class="env-burn"/>
      <circle cx="${x(landingPoint.cg)}" cy="${y(landingPoint.weight)}" r="4" class="env-land"/>` : ''}
    <circle cx="${x(point.cg)}" cy="${y(point.weight)}" r="5" class="env-point"/>
    <text x="${pad}" y="${Hh - 8}" class="env-lbl">${fmt(minX, 1)}</text>
    <text x="${W - 8}" y="${Hh - 8}" class="env-lbl" text-anchor="end">${fmt(maxX, 1)} in</text>
    <text x="4" y="${y(maxY) + 12}" class="env-lbl">${fmt(maxY, 0)}</text>
    <text x="4" y="${y(minY)}" class="env-lbl">${fmt(minY, 0)} lb</text>
  </svg>`;
  const wrap = el('div', { class: 'env-wrap', html: svg });
  wrap.append(el('div', { class: 'legend' },
    el('span', { class: 'k point' }, 'Takeoff'),
    landingPoint ? el('span', { class: 'k land' }, 'Landing') : null));
  return wrap;
}

function gfield(label, input) {
  return el('label', { class: 'gfld' }, el('span', { class: 'gfld-label' }, label), input);
}
function stat(label, value, unit) {
  return el('div', { class: 'primary' },
    el('div', { class: 'p-label' }, label),
    el('div', { class: 'p-value' }, el('span', { class: 'p-num' }, value), el('span', { class: 'p-unit' }, unit)));
}
function secRow(label, value) {
  return el('div', { class: 'sec' }, el('span', { class: 's-label' }, label), el('span', { class: 's-value' }, value));
}
