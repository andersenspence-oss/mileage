// pages/sun.js — sunrise, sunset, twilight and the regulatory definitions of night.

import * as SUN from '../core/sun.js';
import { parseLatLon, formatLatLon } from '../core/nav.js';
import { el, fmt, getState, setState, parseNumber, renderTable } from '../ui.js';

const ID = 'sun';

export function renderSun() {
  const s = getState(ID);
  const today = new Date();
  if (s.date === undefined) s.date = today.toISOString().slice(0, 10);
  if (s.lat === undefined) s.lat = '37 02.4 N';
  if (s.lon === undefined) s.lon = '113 30.3 W';
  if (s.tz === undefined) s.tz = String(-today.getTimezoneOffset() / 60);

  const root = el('div', { class: 'page' });
  const out = el('div', {});

  const dateInput = el('input', { class: 'grid-input', type: 'date', value: s.date });
  dateInput.addEventListener('input', () => { s.date = dateInput.value; setState(ID, 'date', s.date); update(); });

  const textInput = (key, placeholder) => {
    const i = el('input', { class: 'grid-input', type: 'text', value: s[key] ?? '', placeholder, autocomplete: 'off' });
    i.addEventListener('input', () => { s[key] = i.value; setState(ID, key, i.value); update(); });
    return i;
  };

  const geo = el('button', { class: 'btn', type: 'button' }, 'Use my location');
  geo.addEventListener('click', () => {
    if (!navigator.geolocation) { geo.textContent = 'Location unavailable'; return; }
    geo.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition((pos) => {
      s.lat = pos.coords.latitude.toFixed(4);
      s.lon = pos.coords.longitude.toFixed(4);
      setState(ID, 'lat', s.lat); setState(ID, 'lon', s.lon);
      geo.textContent = 'Use my location';
      root.replaceWith(renderSun());
    }, () => { geo.textContent = 'Location denied'; }, { timeout: 10000 });
  });

  function update() {
    out.replaceChildren();
    const lat = parseLatLon(s.lat, false);
    const lon = parseLatLon(s.lon, true);
    const tz = parseNumber(s.tz) || 0;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date || '');
    if (!m || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      out.append(el('div', { class: 'warn' }, 'Enter a date and a position.'));
      return;
    }
    const t = SUN.sunTimes({ year: +m[1], month: +m[2], day: +m[3], latDeg: lat, lonDeg: lon });
    if (t.state !== 'normal') {
      out.append(el('div', { class: 'warn' }, t.state === 'never below'
        ? 'The sun does not set at this latitude on this date.'
        : 'The sun does not rise at this latitude on this date.'));
    }
    const L = (x) => SUN.formatClock(x, tz);
    const Z = (x) => SUN.formatClock(x, 0);
    const night = SUN.nightWindows(t);

    out.append(el('div', { class: 'primary-grid' },
      stat('Sunrise', L(t.sunriseMinUtc), 'local'),
      stat('Sunset', L(t.sunsetMinUtc), 'local'),
    ));

    out.append(renderTable({
      head: ['Event', 'Local', 'UTC'],
      rows: [
        ['Astronomical dawn', L(t.astronomicalDawnMinUtc), Z(t.astronomicalDawnMinUtc)],
        ['Nautical dawn', L(t.nauticalDawnMinUtc), Z(t.nauticalDawnMinUtc)],
        ['<b>Civil dawn</b>', L(t.civilDawnMinUtc), Z(t.civilDawnMinUtc)],
        ['<b>Sunrise</b>', L(t.sunriseMinUtc), Z(t.sunriseMinUtc)],
        ['Solar noon', L(t.solarNoonMinUtc), Z(t.solarNoonMinUtc)],
        ['<b>Sunset</b>', L(t.sunsetMinUtc), Z(t.sunsetMinUtc)],
        ['<b>Civil dusk</b>', L(t.civilDuskMinUtc), Z(t.civilDuskMinUtc)],
        ['Nautical dusk', L(t.nauticalDuskMinUtc), Z(t.nauticalDuskMinUtc)],
        ['Astronomical dusk', L(t.astronomicalDuskMinUtc), Z(t.astronomicalDuskMinUtc)],
      ],
    }));

    out.append(el('h4', { class: 'sub-title' }, 'The three kinds of night'));
    out.append(renderTable({
      head: ['Rule', 'Begins', 'Ends'],
      rows: [
        ['Position lights on<br><span class="dim">14 CFR 91.209 — sunset to sunrise</span>', L(night.positionLights.start), L(night.positionLights.end)],
        ['Loggable night time<br><span class="dim">14 CFR 1.1 — end of evening civil twilight to the beginning of morning civil twilight</span>', L(night.loggableNight.start), L(night.loggableNight.end)],
        ['Night takeoff & landing currency<br><span class="dim">14 CFR 61.57(b) — 1 hour after sunset to 1 hour before sunrise</span>', L(night.currency.start), L(night.currency.end)],
      ],
    }));

    out.append(el('div', { class: 'sec-list' },
      secRow('Day length', t.dayLengthMin != null ? `${Math.floor(t.dayLengthMin / 60)} h ${Math.round(t.dayLengthMin % 60)} min` : '—'),
      secRow('Position', `${formatLatLon(lat)} ${formatLatLon(lon, true)}`),
      secRow('Solar declination', `${fmt(t.declinationDeg, 2)}°`),
      secRow('Equation of time', `${fmt(t.equationOfTimeMin, 1)} min`),
    ));
  }

  root.append(
    el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Date & position'),
      el('div', { class: 'grid-4' },
        gfield('Date', dateInput),
        gfield('Latitude', textInput('lat', '37 02.4 N')),
        gfield('Longitude', textInput('lon', '113 30.3 W')),
        gfield('UTC offset (hours)', textInput('tz', '-6'))),
      geo),
    out,
    el('div', { class: 'note', html: 'Computed with the NOAA solar position algorithm — accurate to about a minute at ordinary latitudes. The FAA definitions differ from each other: lights come on at sunset, loggable night <i>time</i> starts at the end of civil twilight, and night currency needs the hour-after-sunset window.' }),
  );
  update();
  return root;
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
