// ui.js — DOM helpers, the unit-aware input field, and result rendering.

import {
  LENGTH, SPEED, WEIGHT, VOLUME, PRESSURE, TIME, convert,
  tempToC, tempFromC, round,
} from './core/units.js';

// ---------------------------------------------------------------------------
// Tiny DOM helper

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Escape user-supplied text before it is placed in an html: cell. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Field kinds: which unit family a field belongs to, and what it converts to.

export const KINDS = {
  speed: { table: SPEED, base: 'kt', units: ['kt', 'mph', 'km/h', 'm/s'] },
  vspeed: { table: SPEED, base: 'ft/min', units: ['ft/min', 'm/s'] },
  altitude: { table: LENGTH, base: 'ft', units: ['ft', 'm'] },
  distance: { table: LENGTH, base: 'NM', units: ['NM', 'SM', 'km'] },
  shortlen: { table: LENGTH, base: 'ft', units: ['ft', 'm'] },
  weight: { table: WEIGHT, base: 'lb', units: ['lb', 'kg'] },
  volume: { table: VOLUME, base: 'gal', units: ['gal', 'L', 'imp gal'] },
  flow: { table: VOLUME, base: 'gal', units: ['gal/hr', 'L/hr'], suffix: '/hr' },
  pressure: { table: PRESSURE, base: 'inHg', units: ['inHg', 'hPa', 'mb'] },
  time: { table: TIME, base: 'min', units: ['min', 'hr', 'sec'] },
  temp: { temp: true, base: 'C', units: ['C', 'F'], neg: true },
  angle: { fixed: '°', neg: true },
  bearing: { fixed: '°' },
  pct: { fixed: '%' },
  gradient: { fixed: 'ft/NM' },
  number: { fixed: '' },
  ratio: { fixed: ':1' },
  ftnm: { fixed: 'ft/NM' },
  gph: { fixed: 'gal/hr' },
  inches: { fixed: 'in' },
  text: { fixed: '', text: true },
};

/** Convert a display value in `unit` to the kind's base unit. */
export function toBase(value, kind, unit) {
  const k = KINDS[kind];
  if (!k || !Number.isFinite(value)) return value;
  if (k.temp) return tempToC(value, unit);
  if (k.fixed !== undefined) return value;
  if (kind === 'flow') {
    return convert(value, unit.replace('/hr', ''), k.base, k.table);
  }
  return convert(value, unit, k.base, k.table);
}

/** Convert a base-unit value to `unit` for display. */
export function fromBase(value, kind, unit) {
  const k = KINDS[kind];
  if (!k || !Number.isFinite(value)) return value;
  if (k.temp) return tempFromC(value, unit);
  if (k.fixed !== undefined) return value;
  if (kind === 'flow') return convert(value, k.base, unit.replace('/hr', ''), k.table);
  return convert(value, k.base, unit, k.table);
}

export function defaultUnit(kind) {
  const k = KINDS[kind];
  if (!k) return '';
  if (k.fixed !== undefined) return k.fixed;
  return k.units[0];
}

// ---------------------------------------------------------------------------
// Number formatting

export function fmt(value, decimals = 1, { commas = true } = {}) {
  if (value == null || !Number.isFinite(value)) return '—';
  const r = round(value, decimals);
  let s = Math.abs(r) >= 1e7 ? r.toExponential(2) : r.toFixed(Math.max(0, decimals));
  if (commas && Math.abs(r) >= 1000) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  return s;
}

/** Compass-style three digit heading, with 360 rather than 000. */
export function fmtDeg(value) {
  if (!Number.isFinite(value)) return '—';
  let d = Math.round(value) % 360;
  if (d <= 0) d += 360;
  return String(d).padStart(3, '0');
}

/** Sensible decimals for a magnitude, so 0.83 and 12 345 both read well. */
export function autoDecimals(v) {
  const a = Math.abs(v);
  if (!Number.isFinite(a)) return 0;
  if (a === 0) return 0;
  if (a < 0.01) return 5;
  if (a < 1) return 3;
  if (a < 10) return 2;
  if (a < 1000) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Persistent per-calculator state

const STORE_KEY = 'e6b.state.v1';
let store = {};
try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { store = {}; }

let saveTimer = null;
export function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushStore, 150);
}
/** Write the store synchronously — needed before location.reload(). */
export function flushStore() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}
export function getState(id) {
  return (store[id] ||= {});
}
export function setState(id, key, value) {
  (store[id] ||= {})[key] = value;
  saveStore();
}
export function getSetting(key, fallback) {
  const s = store.__settings || {};
  return key in s ? s[key] : fallback;
}
export function setSetting(key, value) {
  (store.__settings ||= {})[key] = value;
  saveStore();
}

// ---------------------------------------------------------------------------
// Field rendering

/**
 * Build one input row. `field` is { k, label, kind, def, hint, options, step }.
 * Calls onChange() whenever the value or unit changes.
 */
export function renderField(calcId, field, state, onChange) {
  const unitKey = `${field.k}__unit`;
  const kind = KINDS[field.kind] || KINDS.number;
  let unit = state[unitKey] || field.unit || defaultUnit(field.kind);

  if (field.options) {
    const sel = el('select', { class: 'fld-select', id: `f-${calcId}-${field.k}` },
      ...field.options.map((o) => {
        const value = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return el('option', { value, selected: String(state[field.k] ?? field.def) === String(value) }, label);
      }));
    sel.addEventListener('change', () => { setState(calcId, field.k, sel.value); onChange(); });
    return el('label', { class: 'fld' },
      el('span', { class: 'fld-label' }, field.label),
      el('span', { class: 'fld-row' }, sel));
  }

  if (field.kind === 'toggle') {
    const btn = el('button', {
      class: 'toggle' + (state[field.k] ?? field.def ? ' on' : ''), type: 'button',
    }, state[field.k] ?? field.def ? 'Yes' : 'No');
    btn.addEventListener('click', () => {
      const next = !(state[field.k] ?? field.def);
      setState(calcId, field.k, next);
      btn.classList.toggle('on', next);
      btn.textContent = next ? 'Yes' : 'No';
      onChange();
    });
    return el('label', { class: 'fld' },
      el('span', { class: 'fld-label' }, field.label),
      el('span', { class: 'fld-row' }, btn));
  }

  const input = el('input', {
    class: 'fld-input',
    id: `f-${calcId}-${field.k}`,
    type: 'text',
    inputmode: field.kind === 'text' ? 'text'
      : (field.kind === 'bearing' || field.kind === 'number' ? 'numeric' : 'decimal'),
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    placeholder: field.placeholder || (field.def != null ? String(field.def) : ''),
    value: state[field.k] ?? '',
  });
  input.addEventListener('input', () => { setState(calcId, field.k, input.value); onChange(); });
  input.addEventListener('focus', () => input.select());

  const row = el('span', { class: 'fld-row' }, input);

  // The iOS decimal keypad has no minus key, so any field that can go
  // negative (temperature, variation, altitude change...) gets a ± button.
  if (field.neg || kind.neg) {
    const signBtn = el('button', { class: 'fld-sign', type: 'button', title: 'Flip the sign', 'aria-label': 'Make the value negative or positive' }, '±');
    signBtn.addEventListener('click', () => {
      let cur = String(input.value ?? '').trim();
      // An empty field means the greyed-out default is in effect; flip that.
      if (cur === '' && field.def != null && field.def !== '') cur = String(field.def);
      input.value = cur.startsWith('-') ? cur.slice(1) : cur === '' ? '-' : '-' + cur;
      setState(calcId, field.k, input.value);
      onChange();
    });
    row.append(signBtn);
  }

  if (kind.fixed !== undefined) {
    if (kind.fixed) row.append(el('span', { class: 'fld-unit fixed' }, kind.fixed));
  } else {
    const btn = el('button', { class: 'fld-unit', type: 'button', title: 'Change units' }, unit);
    btn.addEventListener('click', () => {
      const list = kind.units;
      const next = list[(list.indexOf(unit) + 1) % list.length];
      // Keep the physical quantity the same when the unit changes.
      const cur = parseNumber(state[field.k]);
      if (Number.isFinite(cur)) {
        const converted = fromBase(toBase(cur, field.kind, unit), field.kind, next);
        input.value = String(round(converted, autoDecimals(converted)));
        setState(calcId, field.k, input.value);
      }
      setState(calcId, unitKey, next);
      unit = next;
      btn.textContent = next;
      onChange();
    });
    row.append(btn);
  }

  return el('label', { class: 'fld' },
    el('span', { class: 'fld-label' }, field.label, field.hint ? el('span', { class: 'fld-hint' }, field.hint) : null),
    row);
}

/** Accept "1 1/2", "1:30", "30m", plain numbers, and leading/trailing junk. */
export function parseNumber(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim().replace(/,/g, '');
  if (!s) return NaN;
  // H:MM or MM:SS -> decimal of the leading unit
  const clock = /^(-?\d+):([0-5]?\d(?:\.\d+)?)$/.exec(s);
  if (clock) return Number(clock[1]) + Math.sign(Number(clock[1]) || 1) * Number(clock[2]) / 60;
  const mixed = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) * Math.sign(Number(mixed[1]) || 1);
  const frac = /^(-?\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s.replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** Read every field of a calculator into base units. */
export function readValues(calc, state) {
  const v = {};
  for (const f of calc.fields) {
    if (f.options) { v[f.k] = state[f.k] ?? f.def; continue; }
    if (f.kind === 'toggle') { v[f.k] = state[f.k] ?? f.def; continue; }
    const raw = state[f.k];
    let n = parseNumber(raw);
    if (!Number.isFinite(n) && f.def != null && (raw === undefined || raw === '')) n = parseNumber(f.def);
    if (!Number.isFinite(n)) { v[f.k] = NaN; continue; }
    const unit = state[`${f.k}__unit`] || f.unit || defaultUnit(f.kind);
    v[f.k] = toBase(n, f.kind, unit);
    v[`${f.k}__unit`] = unit;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Results

export function renderResults(result) {
  const wrap = el('div', { class: 'results' });
  if (!result) return wrap;

  if (result.error) {
    wrap.append(el('div', { class: 'warn' }, result.error));
    return wrap;
  }

  for (const w of result.warn || []) wrap.append(el('div', { class: 'warn' }, w));

  if (result.primary?.length) {
    const grid = el('div', { class: 'primary-grid' });
    for (const p of result.primary) {
      grid.append(el('div', { class: 'primary' + (p.wide ? ' wide' : '') },
        el('div', { class: 'p-label' }, p.label),
        el('div', { class: 'p-value' },
          el('span', { class: 'p-num' }, p.text ?? fmt(p.value, p.decimals ?? autoDecimals(p.value))),
          p.unit ? el('span', { class: 'p-unit' }, p.unit) : null),
        p.hint ? el('div', { class: 'p-hint' }, p.hint) : null));
    }
    wrap.append(grid);
  }

  if (result.secondary?.length) {
    const list = el('div', { class: 'sec-list' });
    for (const s of result.secondary) {
      if (s.heading) { list.append(el('div', { class: 'sec-heading' }, s.heading)); continue; }
      list.append(el('div', { class: 'sec' + (s.emph ? ' emph' : '') },
        el('span', { class: 's-label' }, s.label),
        el('span', { class: 's-value' }, s.text ?? `${fmt(s.value, s.decimals ?? autoDecimals(s.value))}${s.unit ? ' ' + s.unit : ''}`)));
    }
    wrap.append(list);
  }

  if (result.table) wrap.append(renderTable(result.table));

  if (result.work?.length) {
    const details = el('details', { class: 'work' },
      el('summary', {}, 'Show the work'),
      el('div', { class: 'work-body' }, ...result.work.map((w) => el('div', { class: 'work-line', html: w }))));
    wrap.append(details);
  }

  for (const n of result.notes || []) wrap.append(el('div', { class: 'note', html: n }));

  return wrap;
}

export function renderTable({ head, rows, className = '' }) {
  const table = el('table', { class: 'tbl ' + className });
  if (head) {
    table.append(el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))));
  }
  const tbody = el('tbody');
  for (const r of rows) {
    const cells = Array.isArray(r) ? r : r.cells;
    tbody.append(el('tr', { class: (!Array.isArray(r) && r.className) || '' },
      ...cells.map((c) => el('td', { html: c == null ? '—' : String(c) }))));
  }
  table.append(tbody);
  return el('div', { class: 'tbl-wrap' }, table);
}

/** A labelled group of raw HTML, used by the reference pages. */
export function card(title, ...children) {
  return el('section', { class: 'card' },
    title ? el('h3', { class: 'card-title' }, title) : null,
    ...children);
}
