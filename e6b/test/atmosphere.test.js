import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/core/atmosphere.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

test('ISA anchor points match the published standard atmosphere', () => {
  close(A.isaTempC(0), 15, 1e-9, 'sea level temp');
  close(A.isaTempC(5000), 5.094, 0.001, '5 000 ft');
  close(A.isaTempC(10000), -4.812, 0.001, '10 000 ft');
  close(A.isaTempC(36089.24), -56.5, 0.01, 'tropopause');
  close(A.isaTempC(45000), -56.5, 1e-9, 'stratosphere is isothermal');
});

test('standard pressure at altitude matches ICAO tables', () => {
  close(A.pressureInHg(0), 29.9213, 0.0005, 'sea level inHg');
  close(A.pressureHpa(0), 1013.25, 0.01, 'sea level hPa');
  // ICAO table values, hPa: 5 000 ft = 843.1, 10 000 ft = 696.8, 18 000 ft = 506.0
  close(A.pressureHpa(5000), 843.07, 0.3, '5 000 ft');
  close(A.pressureHpa(10000), 696.82, 0.3, '10 000 ft');
  close(A.pressureHpa(18000), 506.03, 0.5, '18 000 ft');
  close(A.pressureInHg(18000), 14.94, 0.02, '18 000 ft inHg (half of sea level)');
  close(A.pressureHpa(36089.24), 226.32, 0.5, 'tropopause');
});

test('pressure altitude round-trips through pressure', () => {
  for (const h of [0, 1000, 5000, 18000, 36089.24, 45000, 55000]) {
    close(A.pressureAltFromInHg(A.pressureInHg(h)), h, 0.5, `round trip at ${h}`);
  }
  close(A.pressureAltFromInHg(29.921258), 0, 0.1, 'standard pressure is zero PA');
});

test('pressure altitude from altimeter setting (FAA method used by the test bank)', () => {
  // The rule the FAA teaches: 1 000 ft per inch, applied to field elevation.
  close(A.pressureAltitude(5000, 29.92), 5000, 0.5);
  close(A.pressureAltitude(5000, 30.42), 4500, 0.5);
  close(A.pressureAltitude(5000, 29.42), 5500, 0.5);
  close(A.pressureAltitude(1200, 30.15), 970, 1);
  // The exact barometric answer is nearer 925 ft per inch.
  close(A.pressureAltitude(0, 28.92, 'exact'), 945, 15, 'exact method, 1 inch low');
});

test('density altitude matches the FAA density altitude chart', () => {
  close(A.densityAltitude(0, 15), 0, 0.5, 'standard day at sea level');
  close(A.densityAltitude(5000, 5.094), 5000, 1, 'standard day at 5 000 ft');
  close(A.densityAltitude(0, 30), 1724, 5, 'sea level, 30 C');
  close(A.densityAltitude(5000, 30), 7801, 10, '5 000 ft, 30 C');
  close(A.densityAltitude(8000, 25), 10898, 20, '8 000 ft, 25 C');
  // Cold day: density altitude drops below pressure altitude.
  assert.ok(A.densityAltitude(5000, -20) < 5000);
});

test('the 118.8 ft per degree rule stays close to the exact answer', () => {
  const exact = A.densityAltitude(5000, 30);
  const rule = A.densityAltitudeRuleOfThumb(5000, 30);
  close(rule - exact, 157, 25, 'rule of thumb runs slightly high');
});

test('density and temperature ratios', () => {
  close(A.densityRatio(0, 15), 1, 1e-9);
  close(A.temperatureRatio(15), 1, 1e-12);
  close(A.densityKgM3(0, 15), 1.225, 0.0005);
  close(A.densityRatio(10000, -4.812), 0.7386, 0.001, 'sigma at 10 000 ft standard');
});

test('speed of sound', () => {
  close(A.speedOfSoundKt(15), 661.48, 0.01, 'ISA sea level');
  close(A.speedOfSoundKt(-56.5), 573.57, 0.05, 'tropopause');
  close(A.speedOfSoundKt(0), 644.03, 0.05, '0 C (331.3 m/s)');
});

test('ISA deviation', () => {
  close(A.isaDeviationC(0, 15), 0, 1e-9);
  close(A.isaDeviationC(10000, 0), 4.812, 0.001);
  close(A.isaDeviationC(6000, -5), -8.1128, 0.001);
});

test('altimeter setting and station pressure invert each other', () => {
  const qnh = A.altimeterSettingFromStation(24.92, 5000);
  close(A.stationPressureFromAltimeter(qnh, 5000), 24.92, 1e-6);
  // A station 5 000 ft up reading 24.92 in reports roughly 29.9 in.
  close(qnh, 29.94, 0.15);
});

test('true altitude correction on a cold day', () => {
  // 4 ft per degree per 1 000 ft: a 10 degree cold column at 5 000 AGL
  // puts the aeroplane 200 ft lower than indicated.
  const ta = A.trueAltitude(10000, 5000, A.isaTempC(10000) - 10, 29.92);
  close(ta, 10000 - 200, 2);
});

test('moisture relations', () => {
  close(A.relativeHumidity(20, 20), 100, 1e-6, 'saturated');
  close(A.relativeHumidity(30, 10), 28.9, 0.3);
  close(A.dewpointFromRH(30, A.relativeHumidity(30, 10)), 10, 1e-6, 'round trip');
  close(A.cloudBaseAglFt(20, 10), 4000, 1e-9, 'spread of 10 C gives 4 000 ft');
  close(A.cloudBaseTempC(20, 10), 8, 1e-9);
});

test('humidity lowers air density (raises density altitude)', () => {
  const dry = A.densityAltitude(2000, 30);
  const humid = A.densityAltitudeHumid(2000, 30, 25);
  assert.ok(humid > dry, 'moist air is less dense');
  assert.ok(humid - dry < 800, 'but not by an absurd amount');
});

test('standard atmosphere table row', () => {
  const r = A.standardAtmosphereRow(20000);
  close(r.tempC, -24.624, 0.01);
  close(r.pressureHpa, 465.63, 0.5);
  close(r.densityRatio, 0.5328, 0.002);
  close(r.tasFactor, 1.3700, 0.005, 'TAS is about 37 percent above CAS at FL200');
});
