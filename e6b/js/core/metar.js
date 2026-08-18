// metar.js — offline METAR / SPECI / TAF decoder.
//
// Everything is parsed locally: paste a raw report and it decodes with no
// network, which is the point on a knowledge test and in a run-up area.

const WX_INTENSITY = { '-': 'light', '+': 'heavy', VC: 'in the vicinity' };

const WX_DESCRIPTOR = {
  MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting', BL: 'blowing',
  SH: 'showers of', TS: 'thunderstorm', FZ: 'freezing',
};

const WX_PHENOMENA = {
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals',
  PL: 'ice pellets', GR: 'hail', GS: 'small hail / snow pellets', UP: 'unknown precipitation',
  BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'widespread dust',
  SA: 'sand', HZ: 'haze', PY: 'spray',
  PO: 'dust/sand whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
};

const SKY_COVER = {
  SKC: { text: 'sky clear', oktas: 0 },
  CLR: { text: 'clear below 12 000 ft (automated)', oktas: 0 },
  NSC: { text: 'no significant cloud', oktas: 0 },
  NCD: { text: 'no cloud detected', oktas: 0 },
  FEW: { text: 'few', oktas: 2 },
  SCT: { text: 'scattered', oktas: 4 },
  BKN: { text: 'broken', oktas: 6 },
  OVC: { text: 'overcast', oktas: 8 },
  VV: { text: 'vertical visibility (indefinite ceiling)', oktas: 8 },
};

const CEILING_LAYERS = new Set(['BKN', 'OVC', 'VV']);

function parseFractionSm(text) {
  // Handles "10", "1/2", "2 1/2", "M1/4"
  let t = text, minus = false;
  if (t.startsWith('M')) { minus = true; t = t.slice(1); }
  let value;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (mixed) value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (frac) value = Number(frac[1]) / Number(frac[2]);
  else if (/^\d+(\.\d+)?$/.test(t)) value = Number(t);
  else return null;
  return { sm: value, lessThan: minus };
}

function decodeWeather(token) {
  let t = token, out = [], intensity = '';
  if (t.startsWith('+') || t.startsWith('-')) { intensity = WX_INTENSITY[t[0]]; t = t.slice(1); }
  else if (t.startsWith('VC')) { intensity = WX_INTENSITY.VC; t = t.slice(2); }
  const parts = t.match(/.{2}/g) || [];
  const descriptors = [], phenomena = [];
  for (const p of parts) {
    if (WX_DESCRIPTOR[p]) descriptors.push(WX_DESCRIPTOR[p]);
    else if (WX_PHENOMENA[p]) phenomena.push(WX_PHENOMENA[p]);
    else return null;
  }
  if (!descriptors.length && !phenomena.length) return null;
  out = [intensity, ...descriptors, phenomena.join(' and ')].filter(Boolean);
  return { code: token, text: out.join(' ') };
}

const RE = {
  station: /^[A-Z][A-Z0-9]{3}$/,
  dayTime: /^(\d{2})(\d{2})(\d{2})Z$/,
  wind: /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS|KMH)$/,
  windVar: /^(\d{3})V(\d{3})$/,
  visSm: /^(M?\d+(?:\s\d+\/\d+|\/\d+)?)SM$/,
  visMeters: /^(\d{4})(NDV)?$/,
  rvr: /^R(\d{2}[LCR]?)\/([MP]?\d{4})(V([MP]?\d{4}))?(FT)?\/?([UDN])?$/,
  sky: /^(SKC|CLR|NSC|NCD|FEW|SCT|BKN|OVC|VV)(\d{3}|\/{3})?(CB|TCU)?$/,
  temp: /^(M?\d{2})\/(M?\d{2})?$/,
  altimeterA: /^A(\d{4})$/,
  altimeterQ: /^Q(\d{4})$/,
  tafValid: /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/,
  tafFrom: /^FM(\d{2})(\d{2})(\d{2})$/,
  prob: /^PROB(\d{2})$/,
};

const num = (s) => (s?.startsWith('M') ? -Number(s.slice(1)) : Number(s));

/**
 * Decode one METAR/SPECI (or one TAF change group). Returns a structured object
 * plus `lines`, a plain-English rendering ready for display.
 */
export function decodeMetar(raw) {
  const text = String(raw || '').trim().toUpperCase().replace(/=+$/, '').replace(/\s+/g, ' ');
  if (!text) return null;
  const tokens = text.split(' ');
  const d = {
    raw: text, type: 'METAR', station: null, time: null, modifiers: [],
    wind: null, visibility: null, rvr: [], weather: [], sky: [],
    tempC: null, dewC: null, altimeterInHg: null, altimeterHpa: null,
    remarks: null, unparsed: [], trends: [], isTaf: false, validity: null,
  };
  let i = 0;
  if (tokens[i] === 'METAR' || tokens[i] === 'SPECI' || tokens[i] === 'TAF') {
    d.type = tokens[i]; d.isTaf = tokens[i] === 'TAF'; i++;
  }
  if (tokens[i] === 'AMD' || tokens[i] === 'COR') { d.modifiers.push(tokens[i]); i++; }
  if (RE.station.test(tokens[i] || '')) { d.station = tokens[i]; i++; }
  if (RE.dayTime.test(tokens[i] || '')) {
    const m = RE.dayTime.exec(tokens[i]);
    d.time = { day: +m[1], hour: +m[2], minute: +m[3], text: `day ${+m[1]} at ${m[2]}:${m[3]}Z` };
    i++;
  }
  if (RE.tafValid.test(tokens[i] || '') && d.isTaf) {
    const m = RE.tafValid.exec(tokens[i]);
    d.validity = { fromDay: +m[1], fromHour: +m[2], toDay: +m[3], toHour: +m[4] };
    i++;
  }

  let remarksIdx = tokens.indexOf('RMK');
  const body = remarksIdx >= 0 ? tokens.slice(i, remarksIdx) : tokens.slice(i);
  if (remarksIdx >= 0) d.remarks = tokens.slice(remarksIdx + 1).join(' ');

  // TAF change groups split the body into segments.
  const segments = [];
  let current = [];
  for (const tok of body) {
    if (RE.tafFrom.test(tok) || tok === 'TEMPO' || tok === 'BECMG' || RE.prob.test(tok) || tok === 'INTER') {
      segments.push(current); current = [tok];
    } else current.push(tok);
  }
  segments.push(current);

  parseGroup(segments[0], d);
  for (const seg of segments.slice(1)) {
    if (!seg.length) continue;
    const sub = { header: seg[0], wind: null, visibility: null, weather: [], sky: [], unparsed: [] };
    const m = RE.tafFrom.exec(seg[0]);
    if (m) sub.label = `From day ${+m[1]} ${m[2]}:${m[3]}Z`;
    else if (seg[0] === 'TEMPO') sub.label = 'Temporarily';
    else if (seg[0] === 'BECMG') sub.label = 'Becoming';
    else if (RE.prob.exec(seg[0])) sub.label = `${RE.prob.exec(seg[0])[1]}% probability of`;
    parseGroup(seg.slice(1), sub);
    d.trends.push(sub);
  }

  d.flightCategory = flightCategory(d);
  d.lines = renderMetar(d);
  return d;
}

/** Merge a mixed-fraction visibility ("2 1/2SM") back into one token. */
function mergeFractionVisibility(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^\d$|^\d\d$/.test(tokens[i]) && /^\d+\/\d+SM$/.test(tokens[i + 1] || '')) {
      out.push(`${tokens[i]} ${tokens[i + 1]}`);
      i++;
    } else out.push(tokens[i]);
  }
  return out;
}

function parseGroup(rawTokens, d) {
  const tokens = mergeFractionVisibility(rawTokens);
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok === 'AUTO' || tok === 'COR' || tok === 'NOSIG') { (d.modifiers ||= []).push(tok); continue; }
    if (tok === 'CAVOK') {
      d.visibility = { sm: 6.21, meters: 10000, cavok: true, text: 'CAVOK — 10 km or more, no cloud below 5 000 ft, no significant weather' };
      continue;
    }
    if (tok === 'NSW') { d.weather.push({ code: tok, text: 'no significant weather' }); continue; }
    if (tok === 'TAF' || tok === 'AMD') continue;

    let m;
    if ((m = RE.wind.exec(tok))) {
      const unit = m[5];
      const toKt = unit === 'KT' ? 1 : unit === 'MPS' ? 1.9438444924 : 0.5399568;
      d.wind = {
        variable: m[1] === 'VRB',
        directionDeg: m[1] === 'VRB' ? null : +m[1],
        speedKt: +m[2] * toKt,
        gustKt: m[4] ? +m[4] * toKt : null,
        unit,
      };
      continue;
    }
    if (d.wind && (m = RE.windVar.exec(tok))) { d.wind.varyFromDeg = +m[1]; d.wind.varyToDeg = +m[2]; continue; }
    if ((m = RE.visSm.exec(tok))) {
      const v = parseFractionSm(m[1]);
      if (v) { d.visibility = { sm: v.sm, lessThan: v.lessThan, unit: 'SM' }; continue; }
    }
    if ((m = RE.rvr.exec(tok))) {
      d.rvr.push({
        runway: m[1], value: m[2], varyTo: m[4] || null,
        trend: { U: 'increasing', D: 'decreasing', N: 'no change' }[m[6]] || null,
      });
      continue;
    }
    if ((m = RE.sky.exec(tok))) {
      const cover = SKY_COVER[m[1]];
      d.sky.push({
        cover: m[1], coverText: cover.text, oktas: cover.oktas,
        heightFt: m[2] && m[2] !== '///' ? +m[2] * 100 : null,
        type: m[3] || null,
        isCeiling: CEILING_LAYERS.has(m[1]),
      });
      continue;
    }
    if ((m = RE.temp.exec(tok)) && d.tempC === null) {
      d.tempC = num(m[1]);
      d.dewC = m[2] ? num(m[2]) : null;
      continue;
    }
    if ((m = RE.altimeterA.exec(tok))) {
      d.altimeterInHg = +m[1] / 100;
      d.altimeterHpa = d.altimeterInHg * 33.8638866667;
      continue;
    }
    if ((m = RE.altimeterQ.exec(tok))) {
      d.altimeterHpa = +m[1];
      d.altimeterInHg = d.altimeterHpa / 33.8638866667;
      continue;
    }
    const wx = decodeWeather(tok);
    if (wx) { d.weather.push(wx); continue; }
    // A bare four-digit group is metric visibility in ICAO-format reports.
    if (!d.visibility && (m = RE.visMeters.exec(tok))) {
      const meters = +m[1];
      d.visibility = { meters, sm: meters / 1609.344, unit: 'm' };
      continue;
    }
    d.unparsed.push(tok);
  }
}

/** Lowest broken/overcast/vertical-visibility layer, in feet AGL. */
export function ceilingFt(d) {
  const layers = (d.sky || []).filter((l) => l.isCeiling && Number.isFinite(l.heightFt));
  if (!layers.length) return null;
  return Math.min(...layers.map((l) => l.heightFt));
}

/**
 * US flight category, per the National Weather Service / AIM definitions:
 *   LIFR  ceiling < 500 ft  or visibility < 1 SM
 *   IFR   ceiling 500-999   or visibility 1 to < 3 SM
 *   MVFR  ceiling 1000-3000 or visibility 3 to 5 SM
 *   VFR   ceiling > 3000    and visibility > 5 SM
 */
export function flightCategory(d) {
  const c = ceilingFt(d);
  const v = d.visibility?.sm ?? null;
  if (c === null && v === null) return null;
  const cc = c === null ? Infinity : c;
  const vv = v === null ? Infinity : v;
  if (cc < 500 || vv < 1) return 'LIFR';
  if (cc < 1000 || vv < 3) return 'IFR';
  if (cc <= 3000 || vv <= 5) return 'MVFR';
  return 'VFR';
}

const REMARK_DECODERS = [
  [/^AO1$/, () => 'Automated station without a precipitation discriminator'],
  [/^AO2$/, () => 'Automated station with a precipitation discriminator'],
  [/^SLP(\d{3})$/, (m) => {
    const v = +m[1];
    const slp = (v >= 500 ? 900 + v / 10 : 1000 + v / 10);
    return `Sea-level pressure ${slp.toFixed(1)} hPa`;
  }],
  [/^T(\d)(\d{3})(\d)(\d{3})$/, (m) => {
    const t = (m[1] === '1' ? -1 : 1) * +m[2] / 10;
    const dp = (m[3] === '1' ? -1 : 1) * +m[4] / 10;
    return `Precise temperature ${t.toFixed(1)}°C, dewpoint ${dp.toFixed(1)}°C`;
  }],
  [/^PK$/, () => null],
  [/^WND$/, () => null],
  [/^(\d{3})(\d{2,3})\/(\d{2,4})$/, (m) => `Peak wind ${m[1]}° at ${+m[2]} kt at ${m[3]}`],
  [/^WSHFT$/, () => 'Wind shift'],
  [/^LTG(.*)$/, (m) => `Lightning ${m[1] || ''}`.trim()],
  [/^P(\d{4})$/, (m) => `${(+m[1] / 100).toFixed(2)} in of precipitation in the past hour`],
  [/^6(\d{4})$/, (m) => `${(+m[1] / 100).toFixed(2)} in of precipitation in 3 or 6 hours`],
  [/^VIS(\d+)V(\d+)$/, (m) => `Variable visibility ${m[1]} to ${m[2]}`],
  [/^RAB(\d{2})E(\d{2})$/, (m) => `Rain began :${m[1]}, ended :${m[2]}`],
  [/^CIG(\d{3})V(\d{3})$/, (m) => `Variable ceiling ${+m[1] * 100} to ${+m[2] * 100} ft`],
  [/^\$$/, () => 'Station needs maintenance'],
];

export function decodeRemarks(remarks) {
  if (!remarks) return [];
  const out = [];
  for (const tok of remarks.split(/\s+/)) {
    let matched = false;
    for (const [re, fn] of REMARK_DECODERS) {
      const m = re.exec(tok);
      if (m) {
        const text = fn(m);
        if (text) out.push({ code: tok, text });
        matched = true;
        break;
      }
    }
    if (!matched) out.push({ code: tok, text: null });
  }
  return out;
}

function windText(w) {
  if (!w) return null;
  if (w.speedKt === 0) return 'Wind calm';
  const dir = w.variable ? 'variable in direction' : `from ${String(w.directionDeg).padStart(3, '0')}°`;
  let s = `Wind ${dir} at ${Math.round(w.speedKt)} kt`;
  if (w.gustKt) s += `, gusting ${Math.round(w.gustKt)} kt`;
  if (w.varyFromDeg != null) s += `, varying between ${w.varyFromDeg}° and ${w.varyToDeg}°`;
  return s;
}

function visText(v) {
  if (!v) return null;
  if (v.cavok) return v.text;
  if (v.unit === 'm') return `Visibility ${v.meters} m (${(v.sm).toFixed(1)} SM)`;
  const val = v.sm % 1 === 0 ? String(v.sm) : v.sm.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `Visibility ${v.lessThan ? 'less than ' : ''}${val} SM`;
}

function skyText(sky) {
  if (!sky.length) return null;
  return 'Sky: ' + sky.map((l) => {
    if (l.heightFt == null) return l.coverText;
    if (l.cover === 'VV') return `${l.coverText} ${l.heightFt} ft`;
    return `${l.coverText} at ${l.heightFt} ft AGL${l.type ? ` (${l.type === 'CB' ? 'cumulonimbus' : 'towering cumulus'})` : ''}`;
  }).join(', ');
}

function renderMetar(d) {
  const lines = [];
  if (d.station) lines.push(['Station', d.station]);
  if (d.time) lines.push(['Observed', d.time.text]);
  if (d.validity) lines.push(['Valid', `day ${d.validity.fromDay} ${String(d.validity.fromHour).padStart(2, '0')}00Z to day ${d.validity.toDay} ${String(d.validity.toHour).padStart(2, '0')}00Z`]);
  if (d.modifiers?.length) lines.push(['Modifiers', d.modifiers.join(', ')]);
  const w = windText(d.wind); if (w) lines.push(['Wind', w]);
  const v = visText(d.visibility); if (v) lines.push(['Visibility', v]);
  if (d.rvr?.length) lines.push(['RVR', d.rvr.map((r) => `runway ${r.runway}: ${r.value}${r.varyTo ? ` varying to ${r.varyTo}` : ''} ft${r.trend ? `, ${r.trend}` : ''}`).join('; ')]);
  if (d.weather?.length) lines.push(['Weather', d.weather.map((x) => x.text).join(', ')]);
  const s = skyText(d.sky); if (s) lines.push(['Clouds', s.replace(/^Sky: /, '')]);
  const c = ceilingFt(d);
  if (c !== null) lines.push(['Ceiling', `${c} ft AGL`]);
  if (d.tempC !== null) {
    let t = `${d.tempC}°C (${(d.tempC * 9 / 5 + 32).toFixed(0)}°F)`;
    if (d.dewC !== null) t += `, dewpoint ${d.dewC}°C (${(d.dewC * 9 / 5 + 32).toFixed(0)}°F), spread ${(d.tempC - d.dewC).toFixed(0)}°C`;
    lines.push(['Temperature', t]);
  }
  if (d.altimeterInHg) lines.push(['Altimeter', `${d.altimeterInHg.toFixed(2)} inHg (${d.altimeterHpa.toFixed(0)} hPa)`]);
  if (d.flightCategory) lines.push(['Category', d.flightCategory]);
  return lines;
}
