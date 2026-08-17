// pages/wx.js — offline METAR / TAF decoder, wired into the performance maths.

import { decodeMetar, decodeRemarks, ceilingFt } from '../core/metar.js';
import * as ATM from '../core/atmosphere.js';
import * as W from '../core/wind.js';
import { el, esc, fmt, fmtDeg, getState, setState, parseNumber, renderTable } from '../ui.js';

const ID = 'wx';

const SAMPLE = 'KSGU 171553Z 21015G25KT 180V240 10SM FEW070 SCT100 32/M01 A2998 RMK AO2 SLP098 T03171011';

export function renderWx() {
  const s = getState(ID);
  if (s.raw === undefined) s.raw = SAMPLE;
  if (s.elev === undefined) s.elev = '2941';
  if (s.rwys === undefined) s.rwys = '1, 19';
  if (s.varn === undefined) s.varn = '11';

  const root = el('div', { class: 'page' });
  const out = el('div', {});

  const area = el('textarea', {
    class: 'metar-input', rows: 4, spellcheck: 'false', autocapitalize: 'characters',
    placeholder: 'Paste a METAR, SPECI or TAF here',
  }, s.raw);
  area.addEventListener('input', () => { s.raw = area.value; setState(ID, 'raw', area.value); update(); });

  const smallInput = (key, label, placeholder) => {
    const i = el('input', { class: 'grid-input', type: 'text', inputmode: 'text', value: s[key] ?? '', placeholder, autocomplete: 'off' });
    i.addEventListener('input', () => { s[key] = i.value; setState(ID, key, i.value); update(); });
    return el('label', { class: 'gfld' }, el('span', { class: 'gfld-label' }, label), i);
  };

  function update() {
    out.replaceChildren();
    const raw = (s.raw || '').trim();
    if (!raw) { out.append(el('div', { class: 'note' }, 'Paste a report above. Nothing leaves the device — the decoder runs entirely offline.')); return; }

    for (const report of raw.split(/\n{2,}/)) {
      const d = decodeMetar(report);
      if (!d) continue;
      out.append(decodeCard(d, s));
    }
  }

  root.append(
    el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Raw report'),
      area,
      el('div', { class: 'grid-4' },
        smallInput('elev', 'Field elevation (ft)', '2941'),
        smallInput('rwys', 'Runways', '9, 27'),
        smallInput('varn', 'Variation E+/W−', '11')),
      el('div', { class: 'chips' },
        sampleChip('METAR', SAMPLE, area, s, update),
        sampleChip('Low IFR', 'KSLC 171753Z 34012KT 1/2SM R34R/2000FT -SN BR VV004 M02/M04 A3012', area, s, update),
        sampleChip('TAF', 'TAF KSGU 171130Z 1712/1812 20010KT P6SM SKC FM172200 24015G25KT P6SM FEW080 TEMPO 1800/1804 3SM TSRA BKN040CB', area, s, update))),
    out,
    el('div', { class: 'note', html: 'METAR winds are <b>true</b>; tower, ATIS and AWOS voice winds are <b>magnetic</b>. The runway table below converts for you using the variation you enter.' }),
  );
  update();
  return root;
}

function sampleChip(label, text, area, s, update) {
  const c = el('button', { class: 'chip', type: 'button' }, label);
  c.addEventListener('click', () => { area.value = text; s.raw = text; setState('wx', 'raw', text); update(); });
  return c;
}

function decodeCard(d, s) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'metar-raw' }, d.raw));

  const cat = d.flightCategory;
  if (cat) card.append(el('div', { class: `cat cat-${cat}` }, cat, el('span', {}, categoryHint(cat))));

  card.append(renderTable({ head: null, rows: d.lines.map(([k, v]) => [`<b>${k}</b>`, v]), className: 'kv' }));

  // Trends (TAF change groups)
  for (const t of d.trends || []) {
    const bits = [];
    if (t.wind) bits.push(windText(t.wind));
    if (t.visibility) bits.push(t.visibility.cavok ? 'CAVOK' : `visibility ${fmt(t.visibility.sm, 2)} SM`);
    if (t.weather?.length) bits.push(t.weather.map((x) => x.text).join(', '));
    if (t.sky?.length) bits.push('sky ' + t.sky.map((l) => `${l.coverText}${l.heightFt != null ? ` ${l.heightFt} ft` : ''}`).join(', '));
    card.append(el('div', { class: 'trend' }, el('b', {}, t.label || t.header), ' — ', bits.join('; ') || '(no change)'));
  }

  // Derived performance numbers.
  const elev = parseNumber(s.elev);
  if (d.altimeterInHg && Number.isFinite(elev) && d.tempC !== null) {
    const pa = ATM.pressureAltitude(elev, d.altimeterInHg);
    const da = ATM.densityAltitude(pa, d.tempC);
    const rows = [
      ['Pressure altitude', `${fmt(pa, 0)} ft`],
      ['Density altitude', `${fmt(da, 0)} ft`],
      ['ISA deviation', `${fmt(ATM.isaDeviationC(pa, d.tempC), 1)} °C`],
    ];
    if (d.dewC !== null) {
      rows.push(['Relative humidity', `${fmt(ATM.relativeHumidity(d.tempC, d.dewC), 0)} %`]);
      rows.push(['Convective cloud base', `${fmt(ATM.cloudBaseAglFt(d.tempC, d.dewC), 0)} ft AGL`]);
      rows.push(['Density altitude with humidity', `${fmt(ATM.densityAltitudeHumid(pa, d.tempC, d.dewC), 0)} ft`]);
    }
    card.append(el('h4', { class: 'sub-title' }, 'Performance at this field'));
    card.append(renderTable({ head: null, rows: rows.map(([a, b]) => [`<b>${a}</b>`, b]), className: 'kv' }));
  }

  // Runway winds.
  const rwList = String(s.rwys || '').split(/[^0-9]+/).map(Number).filter((n) => n >= 1 && n <= 36);
  if (d.wind && !d.wind.variable && d.wind.speedKt > 0 && rwList.length) {
    const rows = W.runwayAnalysis({
      runwayNumbers: rwList, windDirDeg: d.wind.directionDeg, windSpeedKt: d.wind.speedKt,
      variationDeg: parseNumber(s.varn) || 0, windIsTrue: true,
    });
    const gustRows = d.wind.gustKt ? W.runwayAnalysis({
      runwayNumbers: rwList, windDirDeg: d.wind.directionDeg, windSpeedKt: d.wind.gustKt,
      variationDeg: parseNumber(s.varn) || 0, windIsTrue: true,
    }) : null;
    card.append(el('h4', { class: 'sub-title' }, 'Runway winds (converted to magnetic)'));
    card.append(renderTable({
      head: ['Rwy', 'Head/Tail', 'Crosswind', d.wind.gustKt ? 'Cross in gusts' : ''].filter(Boolean),
      rows: rows.map((r, i) => [
        r.runway.padStart(2, '0'),
        r.headwindKt >= 0 ? `${fmt(r.headwindKt, 0)} kt head` : `<b>${fmt(-r.headwindKt, 0)} kt tail</b>`,
        `${fmt(Math.abs(r.crosswindKt), 0)} kt ${r.crossFrom.charAt(0).toUpperCase()}`,
        gustRows ? `${fmt(Math.abs(gustRows.find((g) => g.runway === r.runway).crosswindKt), 0)} kt` : null,
      ].filter((x) => x !== null)),
    }));
  }

  if (d.remarks) {
    const decoded = decodeRemarks(d.remarks).filter((x) => x.text);
    if (decoded.length) {
      card.append(el('h4', { class: 'sub-title' }, 'Remarks'));
      card.append(renderTable({ head: null, rows: decoded.map((x) => [`<b>${esc(x.code)}</b>`, esc(x.text)]), className: 'kv' }));
    }
  }

  if (d.unparsed?.length) {
    card.append(el('div', { class: 'note' }, `Not decoded: ${d.unparsed.join(' ')}`));
  }
  return card;
}

function categoryHint(cat) {
  return {
    VFR: 'ceiling above 3 000 ft and visibility over 5 SM',
    MVFR: 'ceiling 1 000–3 000 ft or visibility 3–5 SM',
    IFR: 'ceiling 500–999 ft or visibility 1 to under 3 SM',
    LIFR: 'ceiling under 500 ft or visibility under 1 SM',
  }[cat] || '';
}

function windText(w) {
  if (!w) return '';
  if (w.speedKt === 0) return 'calm';
  const dir = w.variable ? 'variable' : `${fmtDeg(w.directionDeg)}°`;
  return `wind ${dir} at ${Math.round(w.speedKt)} kt${w.gustKt ? ` gusting ${Math.round(w.gustKt)}` : ''}`;
}
