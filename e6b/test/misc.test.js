import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../js/core/holding.js';
import * as WB from '../js/core/wb.js';
import * as U from '../js/core/units.js';
import * as SUN from '../js/core/sun.js';
import { decodeMetar, ceilingFt, flightCategory, decodeRemarks } from '../js/core/metar.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

// ---------------------------------------------------------------------------
test('holding entries, standard right-hand pattern (AIM 5-3-8)', () => {
  const e = (heading, inbound = 360, turns = 'right') =>
    H.holdingEntry({ inboundCourseDeg: inbound, headingDeg: heading, turns }).entry;

  // Inbound course 360 means the pattern lies south-east of the fix.
  assert.equal(e(360), 'direct', 'arriving on the inbound course');
  assert.equal(e(30), 'direct');
  assert.equal(e(69), 'direct', 'just inside the direct sector');
  assert.equal(e(90), 'parallel');
  assert.equal(e(150), 'parallel');
  assert.equal(e(200), 'teardrop');
  assert.equal(e(240), 'teardrop');
  assert.equal(e(251), 'direct', 'just past the teardrop sector');
  assert.equal(e(300), 'direct');
});

test('holding entries, non-standard left-hand pattern', () => {
  const e = (heading) => H.holdingEntry({ inboundCourseDeg: 360, headingDeg: heading, turns: 'left' }).entry;
  assert.equal(e(360), 'direct');
  assert.equal(e(90), 'direct');
  assert.equal(e(160), 'teardrop');
  assert.equal(e(220), 'parallel');
  assert.equal(e(280), 'parallel');
  assert.equal(e(300), 'direct');
});

test('holding geometry: outbound and teardrop headings', () => {
  const r = H.holdingEntry({ inboundCourseDeg: 270, headingDeg: 270, turns: 'right' });
  close(r.outboundCourseDeg, 90, 1e-9);
  close(r.teardropHeadingDeg, 60, 1e-9, 'offset 30 degrees into the holding side');
  const l = H.holdingEntry({ inboundCourseDeg: 270, headingDeg: 270, turns: 'left' });
  close(l.teardropHeadingDeg, 120, 1e-9);
});

test('sector boundaries are flagged as either/or', () => {
  const r = H.holdingEntry({ inboundCourseDeg: 360, headingDeg: 72, turns: 'right' });
  assert.ok(r.boundaryNote, 'a heading 2 degrees inside the boundary is called out');
  const mid = H.holdingEntry({ inboundCourseDeg: 360, headingDeg: 20, turns: 'right' });
  assert.equal(mid.boundaryNote, null);
});

test('wind-corrected holding legs', () => {
  const r = H.holdWindCorrection({
    inboundCourseDeg: 90, tasKt: 100, windDirDeg: 180, windSpeedKt: 20, legTimeMin: 1,
  });
  close(r.inboundWcaDeg, 11.537, 0.01, 'crab right inbound');
  close(r.outboundWcaDeg, -34.61, 0.05, 'triple it outbound');
  // A pure crosswind means the outbound leg time is close to a minute.
  close(r.outboundTimeMin, 1, 0.15);

  const head = H.holdWindCorrection({
    inboundCourseDeg: 90, tasKt: 100, windDirDeg: 90, windSpeedKt: 30, legTimeMin: 1,
  });
  close(head.inboundGsKt, 70, 1e-9);
  close(head.outboundGsKt, 130, 1e-9);
  close(head.outboundTimeMin, 70 / 130, 1e-9, 'shorten the outbound leg into a headwind');
});

test('holding speed limits and leg times', () => {
  assert.equal(H.holdingSpeedLimit(4000).kias, 200);
  assert.equal(H.holdingSpeedLimit(10000).kias, 230);
  assert.equal(H.holdingSpeedLimit(20000).kias, 265);
  assert.equal(H.holdingLegTimeMin(14000), 1);
  assert.equal(H.holdingLegTimeMin(14001), 1.5);
});

// ---------------------------------------------------------------------------
test('weight and balance: load sheet and CG', () => {
  const s = WB.loadSheet([
    { name: 'Empty', weight: 1500, arm: 38.5 },
    { name: 'Front seats', weight: 340, arm: 37.0 },
    { name: 'Rear seats', weight: 170, arm: 73.0 },
    { name: 'Fuel', weight: 228, arm: 48.0 },
    { name: 'Baggage', weight: 40, arm: 95.0 },
  ]);
  close(s.totalWeightLb, 2278, 1e-9);
  close(s.totalMomentLbIn, 1500 * 38.5 + 340 * 37 + 170 * 73 + 228 * 48 + 40 * 95, 1e-9);
  close(s.cgIn, 42.794, 0.001);
  const check = WB.checkLimits({
    totalWeightLb: s.totalWeightLb, cgIn: s.cgIn,
    maxGrossLb: 2300, forwardLimitIn: 35, aftLimitIn: 47.3,
  });
  assert.equal(check.ok, true);
  close(check.weightMarginLb, 22, 1e-9);
  close(check.marginAftIn, 47.3 - s.cgIn, 1e-9);
});

test('weight and balance: over gross and out of limits are both caught', () => {
  const bad = WB.checkLimits({ totalWeightLb: 2500, cgIn: 48.5, maxGrossLb: 2300, forwardLimitIn: 35, aftLimitIn: 47.3 });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.length, 2);
  const fwd = WB.checkLimits({ totalWeightLb: 2000, cgIn: 33, maxGrossLb: 2300, forwardLimitIn: 35, aftLimitIn: 47.3 });
  assert.match(fwd.problems[0], /forward/);
});

test('weight shift, addition and ballast', () => {
  // Move 50 lb from station 100 to station 30 in a 2 000 lb aeroplane.
  const s = WB.weightShift({ totalWeightLb: 2000, weightMovedLb: 50, distanceIn: -70, oldCgIn: 78 });
  close(s.cgShiftIn, -1.75, 1e-9);
  close(s.newCgIn, 76.25, 1e-9);
  close(WB.weightToShift({ totalWeightLb: 2000, cgShiftIn: -1.75, distanceIn: -70 }), 50, 1e-9);
  close(WB.distanceToShift({ totalWeightLb: 2000, cgShiftIn: -1.75, weightMovedLb: 50 }), -70, 1e-9);

  const a = WB.addWeight({ totalWeightLb: 2000, oldCgIn: 78, addedLb: 100, armIn: 120 });
  close(a.newWeightLb, 2100, 1e-9);
  close(a.newCgIn, 80, 1e-9);

  // Ballast at station 20 to bring a 2 000 lb aeroplane from CG 82 to CG 80.
  const b = WB.ballastRequired({ totalWeightLb: 2000, currentCgIn: 82, desiredCgIn: 80, ballastArmIn: 20 });
  close(b, 66.67, 0.01);
  const after = WB.addWeight({ totalWeightLb: 2000, oldCgIn: 82, addedLb: b, armIn: 20 });
  close(after.newCgIn, 80, 1e-9, 'the ballast really does land on the target CG');
});

test('fuel burn moves the CG', () => {
  const r = WB.afterFuelBurn({ totalWeightLb: 2278, cgIn: 43.29, fuelBurnedLb: 120, fuelArmIn: 48 });
  assert.ok(r.newCgIn < 43.29, 'burning aft-of-CG fuel moves the CG forward');
  close(r.newWeightLb, 2158, 1e-9);
});

test('percent MAC', () => {
  close(WB.percentMac({ cgIn: 100, lemacIn: 90, macIn: 50 }), 20, 1e-9);
  close(WB.cgFromPercentMac({ percent: 20, lemacIn: 90, macIn: 50 }), 100, 1e-9);
});

test('CG envelope containment and interpolated limits', () => {
  const env = [
    { weight: 1600, cg: 35 }, { weight: 1600, cg: 47.3 },
    { weight: 2300, cg: 47.3 }, { weight: 2300, cg: 40.5 },
  ];
  assert.equal(WB.inEnvelope({ cgIn: 43, weightLb: 2000 }, env), true);
  assert.equal(WB.inEnvelope({ cgIn: 36, weightLb: 2300 }, env), false, 'too far forward at gross');
  assert.equal(WB.inEnvelope({ cgIn: 43, weightLb: 2400 }, env), false, 'over gross');
  const lim = WB.cgLimitsAtWeight(1950, env);
  close(lim.forwardLimitIn, 37.75, 0.001, 'the forward limit slopes aft with weight');
  close(lim.aftLimitIn, 47.3, 1e-9);
});

// ---------------------------------------------------------------------------
test('unit conversions use the exact international factors', () => {
  close(U.convert(1, 'NM', 'SM', U.LENGTH), 1.15078, 1e-5);
  close(U.convert(1, 'NM', 'km', U.LENGTH), 1.852, 1e-12);
  close(U.convert(1, 'NM', 'ft', U.LENGTH), 6076.11549, 1e-5);
  close(U.convert(100, 'kt', 'mph', U.SPEED), 115.078, 0.001);
  close(U.convert(100, 'kt', 'km/h', U.SPEED), 185.2, 1e-9);
  close(U.convert(1, 'kt', 'ft/min', U.SPEED), 101.2686, 1e-4);
  close(U.convert(1, 'lb', 'kg', U.WEIGHT), 0.45359237, 1e-12);
  close(U.convert(1, 'gal', 'L', U.VOLUME), 3.785411784, 1e-12);
  close(U.convert(1, 'imp gal', 'gal', U.VOLUME), 1.20095, 1e-5);
  close(U.convert(29.92, 'inHg', 'hPa', U.PRESSURE), 1013.21, 0.01);
  close(U.convert(1013.25, 'hPa', 'inHg', U.PRESSURE), 29.9213, 1e-4);
  close(U.tempToC(98.6, 'F'), 37, 1e-9);
  close(U.tempFromC(-40, 'F'), -40, 1e-9);
  close(U.tempToC(0, 'K'), -273.15, 1e-9);
});

test('angle helpers', () => {
  assert.equal(U.norm360(-10), 350);
  assert.equal(U.norm360(370), 10);
  assert.equal(U.norm180(350), -10);
  assert.equal(U.norm180(190), -170);
  assert.equal(U.compassPoint(0), 'N');
  assert.equal(U.compassPoint(247), 'WSW');
  assert.equal(U.hms(90), '1:30:00');
  assert.equal(U.hms(0.5), '0:30');
  assert.equal(U.hms(1.5), '1:30');
  assert.equal(U.hhmm(95), '1+35');
});

// ---------------------------------------------------------------------------
test('METAR decoding', () => {
  const m = decodeMetar('METAR KSGU 171553Z 21015G25KT 180V240 10SM FEW070 SCT100 32/M01 A2998 RMK AO2 SLP098 T03171011');
  assert.equal(m.station, 'KSGU');
  assert.equal(m.time.hour, 15);
  assert.equal(m.wind.directionDeg, 210);
  close(m.wind.speedKt, 15, 1e-9);
  close(m.wind.gustKt, 25, 1e-9);
  assert.equal(m.wind.varyFromDeg, 180);
  close(m.visibility.sm, 10, 1e-9);
  assert.equal(m.sky.length, 2);
  assert.equal(m.sky[0].cover, 'FEW');
  close(m.sky[0].heightFt, 7000, 1e-9);
  close(m.tempC, 32, 1e-9);
  close(m.dewC, -1, 1e-9);
  close(m.altimeterInHg, 29.98, 1e-9);
  assert.equal(ceilingFt(m), null, 'few and scattered are not a ceiling');
  assert.equal(m.flightCategory, 'VFR');
  assert.deepEqual(m.unparsed, []);
});

test('METAR decoding: low IFR with weather', () => {
  const m = decodeMetar('KSLC 171753Z 34012KT 1/2SM R34R/2000FT -SN BR VV004 M02/M04 A3012');
  close(m.visibility.sm, 0.5, 1e-9);
  assert.equal(m.rvr[0].runway, '34R');
  assert.equal(m.weather.length, 2);
  assert.match(m.weather[0].text, /light snow/);
  assert.match(m.weather[1].text, /mist/);
  assert.equal(m.sky[0].cover, 'VV');
  close(ceilingFt(m), 400, 1e-9);
  assert.equal(m.flightCategory, 'LIFR');
  close(m.tempC, -2, 1e-9);
});

test('METAR decoding: fractional visibility and thunderstorms', () => {
  const m = decodeMetar('KDEN 172253Z 09008KT 2 1/2SM +TSRA BKN012 OVC025CB 18/16 A2985');
  close(m.visibility.sm, 2.5, 1e-9);
  assert.match(m.weather[0].text, /heavy thunderstorm rain/);
  close(ceilingFt(m), 1200, 1e-9);
  assert.equal(m.flightCategory, 'IFR');
  assert.equal(m.sky[1].type, 'CB');
});

test('flight category boundaries follow the NWS definitions', () => {
  const cat = (ceil, vis) => flightCategory({ sky: [{ cover: 'OVC', heightFt: ceil, isCeiling: true }], visibility: { sm: vis } });
  assert.equal(cat(3500, 10), 'VFR');
  assert.equal(cat(3000, 10), 'MVFR');
  assert.equal(cat(1000, 4), 'MVFR');
  assert.equal(cat(900, 10), 'IFR');
  assert.equal(cat(3000, 2), 'IFR');
  assert.equal(cat(400, 10), 'LIFR');
  assert.equal(cat(3000, 0.5), 'LIFR');
});

test('TAF change groups are split out', () => {
  const t = decodeMetar('TAF KSGU 171130Z 1712/1812 20010KT P6SM SKC FM172200 24015G25KT P6SM FEW080 TEMPO 1800/1804 3SM TSRA BKN040CB');
  assert.equal(t.isTaf, true);
  assert.equal(t.validity.fromHour, 12);
  assert.equal(t.trends.length, 2);
  assert.match(t.trends[0].label, /^From day 17 22:00Z/);
  assert.equal(t.trends[0].wind.speedKt, 15);
  assert.equal(t.trends[1].label, 'Temporarily');
  close(t.trends[1].visibility.sm, 3, 1e-9);
});

test('remarks decoding', () => {
  const r = decodeRemarks('AO2 SLP098 T02171011');
  assert.match(r[0].text, /precipitation discriminator/);
  assert.match(r[1].text, /1009.8 hPa/);
  assert.match(r[2].text, /21.7/);
});

test('metric-format (ICAO) METAR', () => {
  const m = decodeMetar('EGLL 171550Z 25012KT 9999 SCT035 12/06 Q1015');
  close(m.visibility.meters, 9999, 1e-9);
  close(m.altimeterHpa, 1015, 1e-9);
  close(m.altimeterInHg, 29.97, 0.01);
});

// ---------------------------------------------------------------------------
test('sunrise and sunset at the equator on the equinox', () => {
  const t = SUN.sunTimes({ year: 2026, month: 3, day: 20, latDeg: 0, lonDeg: 0 });
  // Solar noon is not 12:00 UTC: the equation of time runs about 7 minutes
  // fast in late March, so both events shift together.
  close(t.solarNoonMinUtc, 12 * 60 + 7.4, 2, 'solar noon');
  close(t.sunriseMinUtc, t.solarNoonMinUtc - 363.5, 3, 'sunrise');
  close(t.sunsetMinUtc, t.solarNoonMinUtc + 363.5, 3, 'sunset');
  close(t.dayLengthMin, 12 * 60 + 7, 6, 'refraction makes the day slightly over 12 hours');
});

test('long summer day at 45 north', () => {
  const t = SUN.sunTimes({ year: 2026, month: 6, day: 21, latDeg: 45, lonDeg: 0 });
  close(t.dayLengthMin / 60, 15.6, 0.2);
  assert.ok(t.civilDuskMinUtc > t.sunsetMinUtc, 'civil twilight ends after sunset');
  assert.ok(t.civilDawnMinUtc < t.sunriseMinUtc);
});

test('polar day is reported rather than returning nonsense', () => {
  const t = SUN.sunTimes({ year: 2026, month: 6, day: 21, latDeg: 80, lonDeg: 0 });
  assert.equal(t.state, 'never below');
  assert.equal(t.sunriseMinUtc, null);
});

test('the three regulatory nights', () => {
  const t = SUN.sunTimes({ year: 2026, month: 9, day: 15, latDeg: 37.09, lonDeg: -113.59 });
  const n = SUN.nightWindows(t);
  close(n.currency.start - t.sunsetMinUtc, 60, 1e-9, 'currency starts an hour after sunset');
  close(t.sunriseMinUtc - n.currency.end, 60, 1e-9);
  assert.ok(n.loggableNight.start > n.positionLights.start, 'civil twilight ends after sunset');
  assert.ok(n.loggableNight.start < n.currency.start, 'and before the currency window opens');
});

test('clock formatting handles UTC offsets and day rollover', () => {
  assert.equal(SUN.formatClock(13 * 60 + 5, 0), '13:05');
  assert.equal(SUN.formatClock(13 * 60 + 5, -6), '07:05');
  assert.equal(SUN.formatClock(2 * 60, -6), '20:00 (−1 day)');
  assert.equal(SUN.formatClock(null), '—');
});
