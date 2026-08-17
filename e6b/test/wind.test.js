import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/core/wind.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

test('direct headwind and tailwind do not change the heading', () => {
  const head = W.windTriangle({ courseDeg: 90, tasKt: 100, windDirDeg: 90, windSpeedKt: 20 });
  close(head.wcaDeg, 0, 1e-9);
  close(head.groundspeedKt, 80, 1e-9);
  close(head.headwindKt, 20, 1e-9);

  const tail = W.windTriangle({ courseDeg: 90, tasKt: 100, windDirDeg: 270, windSpeedKt: 20 });
  close(tail.wcaDeg, 0, 1e-9);
  close(tail.groundspeedKt, 120, 1e-9);
  close(tail.headwindKt, -20, 1e-9);
});

test('direct crosswind: crab into it and lose a little groundspeed', () => {
  const r = W.windTriangle({ courseDeg: 90, tasKt: 100, windDirDeg: 180, windSpeedKt: 20 });
  close(r.wcaDeg, 11.537, 0.001, 'crab right into a wind from the south on an east course');
  close(r.headingDeg, 101.537, 0.001);
  close(r.groundspeedKt, 97.98, 0.01);
  close(r.crosswindKt, 20, 1e-9);
  close(r.headwindKt, 0, 1e-9);
});

test('worked cross-country leg', () => {
  // TC 340, TAS 105 kt, wind 020 at 15 kt.
  const r = W.windTriangle({ courseDeg: 340, tasKt: 105, windDirDeg: 20, windSpeedKt: 15 });
  close(r.wcaDeg, 5.27, 0.02, 'about 5 degrees right');
  close(r.headingDeg, 345.27, 0.02);
  close(r.groundspeedKt, 93.06, 0.05);
});

test('wind correction is to the left for a wind from the left', () => {
  const r = W.windTriangle({ courseDeg: 360, tasKt: 120, windDirDeg: 270, windSpeedKt: 30 });
  assert.ok(r.wcaDeg < 0, 'crab left');
  close(r.wcaDeg, -14.478, 0.01);
  close(r.crosswindKt, -30, 1e-9, 'crosswind from the left is negative');
});

test('an unflyable course is reported rather than silently wrong', () => {
  const r = W.windTriangle({ courseDeg: 90, tasKt: 20, windDirDeg: 180, windSpeedKt: 60 });
  assert.equal(r.impossible, true);
});

test('the wind triangle and its inverse agree', () => {
  const cases = [
    { courseDeg: 45, tasKt: 110, windDirDeg: 300, windSpeedKt: 25 },
    { courseDeg: 200, tasKt: 90, windDirDeg: 130, windSpeedKt: 12 },
    { courseDeg: 355, tasKt: 450, windDirDeg: 250, windSpeedKt: 95 },
  ];
  for (const c of cases) {
    const f = W.windTriangle(c);
    const back = W.windFromTrack({
      headingDeg: f.headingDeg, tasKt: c.tasKt,
      trackDeg: c.courseDeg, groundspeedKt: f.groundspeedKt,
    });
    close(back.windDirDeg, c.windDirDeg, 0.001, 'recovered wind direction');
    close(back.windSpeedKt, c.windSpeedKt, 0.001, 'recovered wind speed');
    close(back.wcaDeg, f.wcaDeg, 0.001, 'recovered wind correction angle');
  }
});

test('flying a heading without correcting produces drift', () => {
  const r = W.trackFromHeading({ headingDeg: 90, tasKt: 100, windDirDeg: 180, windSpeedKt: 20 });
  close(r.trackDeg, 78.69, 0.01, 'drift to the left of the heading');
  close(r.groundspeedKt, 101.98, 0.01);
});

test('runway wind components', () => {
  // Runway 27, wind 300 at 20: 30 degrees off the nose.
  const r = W.windComponents({ runwayHeadingDeg: 270, windDirDeg: 300, windSpeedKt: 20 });
  close(r.headwindKt, 17.32, 0.01);
  close(r.crosswindKt, 10.0, 0.01, 'half the wind speed at 30 degrees');
  assert.equal(r.crossFrom, 'right');
  assert.equal(r.isTailwind, false);

  // 90 degrees off: all crosswind.
  const c90 = W.windComponents({ runwayHeadingDeg: 360, windDirDeg: 270, windSpeedKt: 15 });
  close(c90.crosswindKt, -15, 1e-9);
  close(c90.headwindKt, 0, 1e-9);
  assert.equal(c90.crossFrom, 'left');

  // Landing downwind.
  const tail = W.windComponents({ runwayHeadingDeg: 90, windDirDeg: 270, windSpeedKt: 12 });
  assert.equal(tail.isTailwind, true);
  close(tail.tailwindKt, 12, 1e-9);
});

test('the clock-face rule tracks the trigonometry', () => {
  for (const angle of [15, 30, 45, 60]) {
    const r = W.windComponents({ runwayHeadingDeg: 0, windDirDeg: angle, windSpeedKt: 20 });
    assert.ok(Math.abs(r.clockRuleCrosswindKt - r.crosswindKt) < 3,
      `clock rule within 3 kt of the trig answer at ${angle} degrees`);
  }
});

test('runway analysis picks the best runway', () => {
  const rws = W.runwayAnalysis({ runwayNumbers: [9, 27, 18, 36], windDirDeg: 250, windSpeedKt: 15 });
  assert.equal(rws[0].runway, '27', 'runway 27 has the most headwind');
  close(rws[0].headwindKt, 14.10, 0.01, '15 kt at 20 degrees off');
  close(Math.abs(rws[0].crosswindKt), 5.13, 0.01);
});

test('METAR winds are true, tower winds are magnetic', () => {
  // Wind 250 true with 12 degrees east variation is 238 magnetic.
  const [best] = W.runwayAnalysis({
    runwayNumbers: [24], windDirDeg: 250, windSpeedKt: 20,
    variationDeg: 12, windIsTrue: true,
  });
  close(best.angleOffDeg, -2, 0.001, 'nearly straight down runway 24 magnetic');
});

test('maximum wind for a demonstrated crosswind', () => {
  close(W.maxWindForCrosswind(17, 90), 17, 1e-9);
  close(W.maxWindForCrosswind(17, 30), 34, 1e-9);
  assert.equal(W.maxWindForCrosswind(17, 0), Infinity);
});

test('winds aloft interpolation is a vector average, not an arithmetic one', () => {
  const r = W.interpolateWindsAloft({
    lowerAltFt: 6000, lowerDirDeg: 340, lowerSpeedKt: 20, lowerTempC: 2,
    upperAltFt: 9000, upperDirDeg: 20, upperSpeedKt: 30, upperTempC: -4,
    targetAltFt: 7500,
  });
  close(r.tempC, -1, 1e-9, 'temperature interpolates linearly');
  assert.ok(r.windDirDeg > 355 || r.windDirDeg < 10, 'direction lands near north, not near 180');
  close(r.windSpeedKt, 23.55, 0.05, 'vector mean, below the 25 kt arithmetic mean');
});

test('vector averaging two opposing winds nearly cancels', () => {
  const r = W.averageWind([
    { windDirDeg: 360, windSpeedKt: 20 },
    { windDirDeg: 180, windSpeedKt: 20 },
  ]);
  close(r.windSpeedKt, 0, 1e-9);
});
