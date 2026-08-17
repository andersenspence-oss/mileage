import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/core/airspeed.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

test('at ISA sea level, CAS = EAS = TAS', () => {
  close(S.tasFromCas(120, 0, 15), 120, 0.001);
  close(S.easFromTas(120, 0, 15), 120, 0.001);
  close(S.machFromCas(120, 0), 120 / 661.4788, 1e-6);
});

test('TAS at altitude — compressible and slide-rule answers agree at light-aircraft speeds', () => {
  const compressible = S.tasFromCas(100, 10000, -5);
  const slideRule = S.tasFromCasIncompressible(100, 10000, -5);
  close(compressible, 116.2, 0.3, 'compressible TAS');
  close(slideRule, 116.3, 0.3, 'slide-rule TAS');
  assert.ok(Math.abs(compressible - slideRule) < 0.5, 'they must not diverge down low');
});

test('TAS gain with altitude, and how far the 2 percent rule drifts', () => {
  const tas = S.tasFromCas(120, 8000, 0.594);   // ISA at 8 000 ft
  close(tas / 120, 1.1293, 0.002, 'true ratio at 8 000 ft standard');
  // The cockpit "2 percent per 1 000 ft" rule reads high; the app shows both.
  close(1 + 0.02 * 8, 1.16, 1e-9);
  assert.ok(1.16 - tas / 120 > 0.02, 'the rule of thumb over-estimates by 3 kt here');
});

test('compressibility matters at jet speeds', () => {
  const compressible = S.tasFromCas(280, 35000, -54);
  const slideRule = S.tasFromCasIncompressible(280, 35000, -54);
  assert.ok(slideRule - compressible > 15, 'the slide rule over-reads badly up high');
  close(compressible, 471, 4, 'FL350, 280 KCAS is roughly 470 KTAS');
});

test('CAS and TAS invert each other', () => {
  for (const [cas, pa, oat] of [[80, 0, 15], [140, 6500, 5], [250, 24000, -30], [300, 41000, -56.5]]) {
    const tas = S.tasFromCas(cas, pa, oat);
    close(S.casFromTas(tas, pa, oat), cas, 1e-6, `round trip ${cas}/${pa}`);
  }
});

test('Mach conversions', () => {
  close(S.tasFromMach(0.8, -50), 465.69, 0.05, 'M0.80 at -50 C');
  close(S.machFromTas(465.69, -50), 0.8, 0.001);
  // Mach 1 at ISA sea level is 661.5 kt.
  close(S.tasFromMach(1, 15), 661.4788, 0.01);
  const m = S.machFromCas(250, 30000);
  close(S.casFromMach(m, 30000), 250, 1e-6, 'CAS/Mach round trip');
});

test('equivalent airspeed sits between CAS and TAS', () => {
  const cas = 300, pa = 30000, oat = -44;
  const tas = S.tasFromCas(cas, pa, oat);
  const eas = S.easFromTas(tas, pa, oat);
  assert.ok(eas < cas && eas < tas, 'EAS is below CAS at altitude');
  close(S.tasFromEas(eas, pa, oat), tas, 1e-9, 'EAS/TAS round trip');
});

test('total air temperature rise', () => {
  // A M0.80 probe reads roughly 33 C above static.
  close(S.totalAirTempC(-50, 0.8), -21.4, 0.5);
  close(S.staticAirTempC(S.totalAirTempC(-50, 0.8), 0.8), -50, 1e-9);
});

test('load factor and stall speed in a turn', () => {
  close(S.loadFactor(0), 1, 1e-12);
  close(S.loadFactor(30), 1.155, 0.001);
  close(S.loadFactor(45), 1.414, 0.001);
  close(S.loadFactor(60), 2.0, 1e-9, '60 degrees of bank doubles the load');
  close(S.stallSpeedInTurn(50, 60), 50 * Math.SQRT2, 0.01, 'stall speed goes up 41 percent');
  close(S.bankForLoadFactor(2), 60, 1e-9);
});

test('speeds scale with the square root of weight', () => {
  // Va at gross 2 400 lb is 100 kt; at 1 800 lb it drops.
  close(S.maneuveringSpeed(100, 2400, 1800), 86.6, 0.1);
  close(S.speedAtWeight(50, 2400, 2000), 45.6, 0.1);
});

test('airspeedSolution reports every derived quantity consistently', () => {
  const r = S.airspeedSolution({ casKt: 150, paFt: 12000, oatC: -10 });
  close(r.tasKt, S.tasFromCas(150, 12000, -10), 1e-12);
  close(r.easKt / r.tasKt, r.sqrtSigma, 1e-12);
  close(r.mach, r.tasKt / r.speedOfSoundKt, 1e-12);
  assert.ok(r.tasKt > 150, 'TAS exceeds CAS at 12 000 ft');
});
