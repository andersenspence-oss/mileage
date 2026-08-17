// app.js — routing, the calculator catalogue and the shell.

import { FLIGHT_CALCS } from './calcs/flight.js';
import { PLANNING_CALCS } from './calcs/planning.js';
import { ATMOS_CALCS } from './calcs/atmos.js';
import { CONVERT_CALCS } from './calcs/convert.js';
import { renderNavLog } from './pages/navlog.js';
import { renderWB } from './pages/wb.js';
import { renderWx } from './pages/wx.js';
import { renderSun } from './pages/sun.js';
import { renderTimer } from './pages/timer.js';
import { renderReference } from './pages/reference.js';
import {
  el, $, renderField, renderResults, readValues,
  getState, setState, getSetting, setSetting,
} from './ui.js';

export const CALCS = [...FLIGHT_CALCS, ...PLANNING_CALCS, ...ATMOS_CALCS, ...CONVERT_CALCS];
const BY_ID = new Map(CALCS.map((c) => [c.id, c]));
const CATEGORIES = ['Flight', 'Planning', 'Atmosphere', 'Conversions'];

const view = () => document.getElementById('view');

// ---------------------------------------------------------------------------
// Favourites and recents

function favourites() { return getSetting('favs', []); }
function toggleFav(id) {
  const f = favourites();
  const i = f.indexOf(id);
  if (i >= 0) f.splice(i, 1); else f.unshift(id);
  setSetting('favs', f);
}
function pushRecent(id) {
  const r = getSetting('recent', []).filter((x) => x !== id);
  r.unshift(id);
  setSetting('recent', r.slice(0, 6));
}

// ---------------------------------------------------------------------------
// Calculator list

function renderList() {
  const page = el('div', { class: 'page' });
  const state = getState('__list');

  const search = el('input', {
    class: 'search', type: 'search', placeholder: 'Search 40+ calculators…',
    autocomplete: 'off', value: state.q || '',
  });
  const chips = el('div', { class: 'chips' });
  const results = el('div', { class: 'calc-list' });

  const setCat = (c) => { state.cat = c; setState('__list', 'cat', c); draw(); };

  for (const c of ['All', ...CATEGORIES]) {
    const chip = el('button', { class: 'chip', type: 'button' }, c);
    chip.addEventListener('click', () => setCat(c === 'All' ? null : c));
    chips.append(chip);
  }

  function draw() {
    const q = (state.q || '').trim().toLowerCase();
    [...chips.children].forEach((ch, i) => {
      const active = (i === 0 && !state.cat) || ch.textContent === state.cat;
      ch.classList.toggle('on', active);
    });
    results.replaceChildren();

    const match = (c) => {
      if (state.cat && c.cat !== state.cat) return false;
      if (!q) return true;
      return (`${c.name} ${c.blurb} ${c.keywords} ${c.cat}`).toLowerCase().includes(q);
    };
    const list = CALCS.filter(match);

    if (!q && !state.cat) {
      const favs = favourites().map((id) => BY_ID.get(id)).filter(Boolean);
      if (favs.length) results.append(group('Favourites', favs));
      const recent = getSetting('recent', []).map((id) => BY_ID.get(id))
        .filter((c) => c && !favs.includes(c));
      if (recent.length) results.append(group('Recent', recent));
      results.append(group('Flight planning tools', [
        { id: '__navlog', name: 'Nav log', blurb: 'Multi-leg flight plan with headings, times and fuel.', href: '#plan/navlog' },
        { id: '__wb', name: 'Weight & balance', blurb: 'Load sheet, CG and envelope check.', href: '#plan/wb' },
        { id: '__wx', name: 'METAR & TAF decoder', blurb: 'Decodes offline, with density altitude and runway winds.', href: '#wx/metar' },
        { id: '__sun', name: 'Sunrise, sunset & night', blurb: 'Twilight times and the three definitions of night.', href: '#wx/sun' },
      ]));
      for (const cat of CATEGORIES) results.append(group(cat, CALCS.filter((c) => c.cat === cat)));
    } else if (!list.length) {
      results.append(el('div', { class: 'note' }, 'Nothing matches that. Try “wind”, “fuel”, “density” or “holding”.'));
    } else {
      results.append(group(`${list.length} result${list.length === 1 ? '' : 's'}`, list));
    }
  }

  search.addEventListener('input', () => { state.q = search.value; setState('__list', 'q', search.value); draw(); });

  page.append(el('div', { class: 'search-wrap' }, search), chips, results);
  draw();
  return page;
}

function group(title, items) {
  const wrap = el('div', { class: 'group' }, el('h3', { class: 'group-title' }, title));
  for (const c of items) {
    const href = c.href || `#calc/${c.id}`;
    const row = el('a', { class: 'calc-row', href },
      el('div', { class: 'calc-main' },
        el('div', { class: 'calc-name' }, c.name),
        el('div', { class: 'calc-blurb' }, c.blurb)),
      el('div', { class: 'calc-go' }, '›'));
    wrap.append(row);
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// One calculator

function renderCalc(id) {
  const calc = BY_ID.get(id);
  if (!calc) return renderList();
  pushRecent(id);

  const page = el('div', { class: 'page' });
  const state = getState(calc.id);
  const out = el('div', { class: 'out' });

  const recompute = () => {
    const values = readValues(calc, state);
    const raw = {};
    for (const k of calc.rawFields || []) {
      const f = calc.fields.find((x) => x.k === k);
      raw[k] = state[k] ?? f?.def ?? '';
    }
    let result;
    try {
      result = calc.compute(values, raw);
    } catch (err) {
      result = { error: 'Check the inputs — that combination does not compute.' };
      console.error(err);
    }
    out.replaceChildren(renderResults(result));
  };

  const fav = favourites().includes(calc.id);
  const star = el('button', { class: 'star' + (fav ? ' on' : ''), type: 'button', title: 'Favourite' }, fav ? '★' : '☆');
  star.addEventListener('click', () => {
    toggleFav(calc.id);
    const now = favourites().includes(calc.id);
    star.classList.toggle('on', now);
    star.textContent = now ? '★' : '☆';
  });

  const reset = el('button', { class: 'btn small', type: 'button' }, 'Clear');
  reset.addEventListener('click', () => {
    for (const f of calc.fields) delete state[f.k];
    setState(calc.id, '__cleared', Date.now());
    location.reload();
  });

  const fields = el('div', { class: 'fields' });
  for (const f of calc.fields) fields.append(renderField(calc.id, f, state, recompute));

  page.append(
    el('div', { class: 'calc-head' },
      el('div', {},
        el('h2', { class: 'calc-title' }, calc.name),
        el('p', { class: 'calc-sub' }, calc.blurb)),
      star),
    el('div', { class: 'card' }, fields, el('div', { class: 'field-actions' }, reset)),
    out,
  );
  recompute();
  return page;
}

// ---------------------------------------------------------------------------
// Sub-navigation for grouped pages

function withSubnav(items, active, body) {
  const nav = el('div', { class: 'subnav' },
    ...items.map((it) => el('a', { class: 'subtab' + (it.route === active ? ' on' : ''), href: `#${it.route}` }, it.label)));
  return el('div', {}, nav, body);
}

// ---------------------------------------------------------------------------
// Router

const ROUTES = {
  calc: () => renderList(),
  plan: (sub) => withSubnav(
    [{ route: 'plan/navlog', label: 'Nav log' }, { route: 'plan/wb', label: 'Weight & balance' }],
    `plan/${sub || 'navlog'}`,
    sub === 'wb' ? renderWB() : renderNavLog(),
  ),
  wx: (sub) => withSubnav(
    [{ route: 'wx/metar', label: 'METAR & TAF' }, { route: 'wx/sun', label: 'Sun & night' }],
    `wx/${sub || 'metar'}`,
    sub === 'sun' ? renderSun() : renderWx(),
  ),
  timer: () => renderTimer(),
  ref: () => renderReference(),
};

const TITLES = {
  calc: 'Flight computer', plan: 'Flight planning', wx: 'Weather',
  timer: 'Timer', ref: 'Reference',
};

function route() {
  const hash = location.hash.replace(/^#/, '') || 'calc';
  const [tab, sub] = hash.split('/');
  const v = view();
  v.replaceChildren();

  let body, title = TITLES[tab] || 'Flight computer';
  if (tab === 'calc' && sub) {
    body = renderCalc(sub);
    title = BY_ID.get(sub)?.cat ?? 'Flight computer';
  } else {
    body = (ROUTES[tab] || ROUTES.calc)(sub);
  }

  $('#title').textContent = title;
  $('#back').style.visibility = (tab === 'calc' && sub) ? 'visible' : 'hidden';
  v.append(body);
  v.scrollTop = 0;
  window.scrollTo(0, 0);

  for (const a of document.querySelectorAll('#tabbar a')) {
    a.classList.toggle('on', a.dataset.tab === tab);
  }
}

// ---------------------------------------------------------------------------
// Settings sheet

function openSettings() {
  const sheet = el('div', { class: 'sheet-backdrop' });
  const theme = getSetting('theme', 'auto');
  const themeRow = el('div', { class: 'chips' },
    ...['auto', 'dark', 'light'].map((t) => {
      const c = el('button', { class: 'chip' + (theme === t ? ' on' : ''), type: 'button' }, t[0].toUpperCase() + t.slice(1));
      c.addEventListener('click', () => {
        setSetting('theme', t);
        applyTheme();
        [...themeRow.children].forEach((x) => x.classList.toggle('on', x === c));
      });
      return c;
    }));

  const clear = el('button', { class: 'btn danger', type: 'button' }, 'Clear every saved value');
  clear.addEventListener('click', () => {
    if (confirm('Clear all saved inputs, favourites and timers?')) {
      localStorage.removeItem('e6b.state.v1');
      location.reload();
    }
  });

  const panel = el('div', { class: 'sheet' },
    el('h3', {}, 'Settings'),
    el('div', { class: 'sheet-row' }, el('span', {}, 'Appearance'), themeRow),
    el('p', { class: 'note' }, 'Every input you type is saved on this device only. Nothing is uploaded, and the whole app works in airplane mode once it has been opened one time.'),
    el('p', {
      class: 'note',
      html: '<b>Accuracy:</b> pressure altitude uses the FAA 1 000 ft-per-inch convention the knowledge-test answer keys use. Density altitude, true airspeed and the wind triangle come from the ICAO standard atmosphere and exact trigonometry rather than a slide-rule approximation.',
    }),
    clear,
    el('button', { class: 'btn', type: 'button', onclick: () => sheet.remove() }, 'Done'),
  );
  sheet.append(panel);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.append(sheet);
}

function applyTheme() {
  const t = getSetting('theme', 'auto');
  document.documentElement.dataset.theme = t === 'auto' ? '' : t;
}

// ---------------------------------------------------------------------------
// Boot

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  $('#back').addEventListener('click', () => { location.hash = '#calc'; });
  $('#gear').addEventListener('click', openSettings);
  route();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
});
