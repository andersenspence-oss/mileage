import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/core/nav.js';
import * as M from '../js/core/maneuver.js';
import * as F from '../js/core/fuel.js';
import { computeNavLog } from '../js/core/flightplan.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

test('time, speed and distance solve in every direction', () => {
  close(N.solveTSD({ speedKt: 120, timeMin: 45 }).distanceNm, 90, 1e-9);
  close(N.solveTSD({ speedKt: 120, distanceNm: 90 }).timeMin, 45, 1e-9);
  close(N.solveTSD({ timeMin: 45, distanceNm: 90 }).speedKt, 120, 1e-9);
  close(N.solveTSD({ speedKt: 95, distanceNm: 158 }).timeMin, 99.789, 0.001);
});

test('true to magnetic to compass, with the east-is-least rule falling out', () => {
  // 10 degrees EAST variation: magnetic is 10 less than true.
  close(N.trueToMagnetic(90, 10), 80, 1e-9);
  // 10 degrees WEST variation: magnetic is 10 more than true.
  close(N.trueToMagnetic(90, -10), 100, 1e-9);
  close(N.magneticToTrue(80, 10), 90, 1e-9);

  const chain = N.headingChain({ trueCourseDeg: 90, wcaDeg: 8, variationDeg: -5, deviationDeg: 2 });
  close(chain.trueHeadingDeg, 98, 1e-9);
  close(chain.magneticHeadingDeg, 103, 1e-9, 'west variation adds');
  close(chain.compassHeadingDeg, 101, 1e-9, 'east deviation subtracts');
  close(chain.magneticCourseDeg, 95, 1e-9);
});

test('headings wrap through north correctly', () => {
  close(N.trueToMagnetic(5, 10), 355, 1e-9);
  close(N.magneticToTrue(355, 10), 5, 1e-9);
});

test('off-course correction with the 1-in-60 rule', () => {
  // 6 NM off after 60 NM, with 60 NM to run: 6 degrees back on track,
  // 6 more to converge on the destination.
  const r = N.offCourseCorrection({ offCourseNm: 6, flownNm: 60, remainingNm: 60 });
  close(r.trackErrorDeg, 6, 1e-9);
  close(r.closingAngleDeg, 6, 1e-9);
  close(r.totalCorrectionDeg, 12, 1e-9);
  close(N.oneInSixty({ offsetNm: 2, distanceNm: 30 }), 4, 1e-9);
});

test('point of no return', () => {
  // 5 hours of fuel, 120 kt out into a headwind, 160 kt home.
  const r = N.pointOfNoReturn({ enduranceMin: 300, gsOutKt: 120, gsBackKt: 160 });
  close(r.timeToPnrMin, 171.43, 0.01);
  close(r.distanceToPnrNm, 342.86, 0.05);
  close(r.timeToPnrMin + r.timeBackMin, 300, 1e-9, 'the fuel is exactly used up');
  // Symmetric case: still air puts the PNR at half the endurance.
  const s = N.pointOfNoReturn({ enduranceMin: 240, gsOutKt: 100, gsBackKt: 100 });
  close(s.timeToPnrMin, 120, 1e-9);
});

test('equal time point', () => {
  const r = N.equalTimePoint({ distanceNm: 400, gsOnKt: 200, gsBackKt: 150 });
  close(r.distanceToEtpNm, 171.43, 0.01);
  close(r.timeOnFromEtpMin, r.timeBackFromEtpMin, 1e-9, 'by definition the times match');
  // No wind: the equal time point is the halfway point.
  const s = N.equalTimePoint({ distanceNm: 300, gsOnKt: 120, gsBackKt: 120 });
  close(s.distanceToEtpNm, 150, 1e-9);
});

test('radius of action from a fixed base equals the point of no return', () => {
  const roa = N.radiusOfAction({ enduranceMin: 300, gsOutKt: 120, gsBackKt: 160 });
  const pnr = N.pointOfNoReturn({ enduranceMin: 300, gsOutKt: 120, gsBackKt: 160 });
  close(roa.radiusNm, pnr.distanceToPnrNm, 1e-9);
});

test('great-circle distances match published figures', () => {
  // JFK to LAX, a standard textbook check: 2 144 NM.
  const d = N.gcDistanceNm(40.6398, -73.7789, 33.9425, -118.4081);
  close(d, 2144, 6);
  const brg = N.gcInitialBearing(40.6398, -73.7789, 33.9425, -118.4081);
  close(brg, 273.7, 1.5, 'initial course is slightly north of west');
  // One degree of latitude is 60 NM.
  close(N.gcDistanceNm(0, 0, 1, 0), 60, 0.2);
  close(N.gcDistanceNm(0, 0, 0, 1), 60, 0.2);
  // Longitude degrees shrink with the cosine of latitude.
  close(N.gcDistanceNm(60, 0, 60, 1), 30, 0.2);
});

test('destination and cross-track', () => {
  const p = N.gcDestination(40, -111, 90, 60);
  close(N.gcDistanceNm(40, -111, p.lat, p.lon), 60, 0.01);
  // A point 10 NM north of the midpoint of an east-west leg is ~10 NM off track.
  const off = N.crossTrackNm(40, -111, 40, -109, 40.167, -110);
  close(Math.abs(off), 10, 0.5);
});

test('lat/long parsing accepts the formats a pilot actually types', () => {
  close(N.parseLatLon('4030N'), 40.5, 1e-9);
  close(N.parseLatLon('11215W', true), -112.25, 1e-9);
  close(N.parseLatLon('40 30.5 N'), 40.508333, 1e-5);
  close(N.parseLatLon('-111.891'), -111.891, 1e-9);
  close(N.parseLatLon('40 45 30 N'), 40.758333, 1e-5);
  assert.equal(N.formatLatLon(40.5), "40°30.0'N");
  assert.equal(N.formatLatLon(-111.891, true), "111°53.5'W");
});

test('radio and visual horizon', () => {
  close(N.radioHorizonNm(10000), 123, 0.5, '1.23 sqrt(h)');
  close(N.visualHorizonNm(10000), 106.4, 1, 'geometric horizon is shorter');
  close(N.lineOfSightNm(5000, 100), 1.23 * (Math.sqrt(5000) + 10), 0.01);
});

test('DME slant range', () => {
  // Directly over a station at 6 076 ft, the DME reads 1.0 NM but the ground
  // distance is zero.
  close(N.dmeGroundDistanceNm(1, 6076.115), 0, 0.001);
  close(N.dmeGroundDistanceNm(10, 6076.115), 9.95, 0.01);
});

test('turn performance', () => {
  close(M.standardRateBank(100), 15.36, 0.02, 'about 15 degrees at 100 kt');
  close(M.standardRateBankRuleOfThumb(100), 17, 1e-9, 'the TAS/10 + 7 rule runs a bit high');
  close(M.rateOfTurn(15.36, 100), 3, 0.01);
  close(M.turnRadiusFt(M.standardRateBank(100), 100), 3223.6, 2, 'standard rate at 100 kt');
  // A standard-rate 360 takes two minutes; check the circumference agrees.
  const r = M.turnRadiusFt(M.standardRateBank(120), 120);
  const circumference = 2 * Math.PI * r;
  close(circumference / (120 * 6076.115 / 60), 2, 0.01, 'two minutes for a full circle');
  close(M.turnLoad(60).loadFactor, 2, 1e-9);
  close(M.pivotalAltitudeFt(100), 885.4, 1, 'GS squared over 11.3');
});

test('climb and descent gradients', () => {
  close(M.pctToFtPerNm(3.3), 200.5, 0.5, '3.3 percent is about 200 ft/NM');
  close(M.ftPerNmToPct(300), 4.937, 0.005);
  close(M.gradientAngleDeg(318.4), 3, 0.01, 'a 3 degree glidepath is 318 ft/NM');

  // 200 ft/NM at 120 kt groundspeed needs 400 fpm.
  close(M.climbRequirement({ gradientFtPerNm: 200, gsKt: 120 }).vsFpm, 400, 1e-9);
  close(M.climbAvailable({ vsFpm: 700, gsKt: 90 }).gradientFtPerNm, 466.67, 0.01);
});

test('required descent and the 3-degree cross-checks', () => {
  const r = M.requiredDescent({ altitudeFt: 3000, distanceNm: 10, gsKt: 120 });
  close(r.gradientFtPerNm, 300, 1e-9);
  close(r.vsFpm, 600, 1e-9);
  close(r.timeMin, 5, 1e-9);
  close(r.threeDegreeFpm, 600, 1e-9, 'groundspeed x 5 for a 3 degree path');
});

test('top of descent', () => {
  // FL350 down to 3 000 ft at 1 800 fpm and 450 kt groundspeed.
  const r = M.topOfDescent({ cruiseAltFt: 35000, targetAltFt: 3000, vsFpm: 1800, gsKt: 450 });
  close(r.altitudeToLoseFt, 32000, 1e-9);
  close(r.descentTimeMin, 17.78, 0.01);
  close(r.descentDistanceNm, 133.3, 0.1);
  close(r.ruleOfThumbNm, 96, 1e-9, 'the 3-times rule is for slower aeroplanes');
});

test('glide', () => {
  // 10:1 glide from 5 000 ft AGL is 8.23 NM.
  const g = M.glide({ heightAglFt: 5000, glideRatio: 10, gsKt: 65 });
  close(g.distanceNm, 8.23, 0.01);
  close(g.timeMin, 7.6, 0.05);
  // Derive the ratio from a rate of descent instead.
  const g2 = M.glide({ heightAglFt: 3000, gsKt: 68, sinkFpm: 700 });
  close(g2.glideRatio, 9.84, 0.02);
});

test('visual descent point', () => {
  const v = M.visualDescentPoint({ mdaFt: 1200, tdzeFt: 400 });
  close(v.heightAboveTdzeFt, 800, 1e-9);
  close(v.vdpDistanceNm, 2.51, 0.01, 'roughly HAT over 300');
});

test('fuel arithmetic', () => {
  close(F.solveFuel({ rateGph: 9.5, timeMin: 90 }).quantityGal, 14.25, 1e-9);
  close(F.solveFuel({ rateGph: 9.5, quantityGal: 38 }).timeMin, 240, 1e-9);
  close(F.solveFuel({ timeMin: 120, quantityGal: 20 }).rateGph, 10, 1e-9);
  close(F.fuelWeightLb(40, 'Avgas 100LL'), 240, 1e-9);
  close(F.fuelWeightLb(100, 'Jet A'), 670, 1e-9);
  close(F.fuelGallons(240), 40, 1e-9);
});

test('trip fuel with reserves', () => {
  const r = F.tripFuel({
    distanceNm: 240, gsKt: 120, burnGph: 10,
    taxiRunupGal: 1.2, reserveMin: 45, usableGal: 38,
  });
  close(r.enrouteTimeMin, 120, 1e-9);
  close(r.enrouteGal, 20, 1e-9);
  close(r.reserveGal, 7.5, 1e-9);
  close(r.totalRequiredGal, 28.7, 1e-9);
  close(r.marginGal, 9.3, 1e-9);
  assert.equal(r.legal, true);

  const tight = F.tripFuel({ distanceNm: 400, gsKt: 100, burnGph: 10, reserveMin: 45, usableGal: 38 });
  assert.equal(tight.legal, false, 'four hours of flying does not fit in 3.8 hours of fuel');
});

test('specific range and endurance', () => {
  close(F.specificRange({ gsKt: 120, burnGph: 10 }).nmPerGal, 12, 1e-9);
  close(F.endurance({ usableGal: 48, burnGph: 12, gsKt: 110 }).enduranceMin, 240, 1e-9);
  close(F.fuelRemaining({ onboardGal: 30, burnGph: 9, timeMin: 100 }).remainingGal, 15, 1e-9);
});

test('nav log ties the wind triangle, the clock and the fuel together', () => {
  const log = computeNavLog({
    legs: [
      { name: 'KSGU-KCDC', trueCourseDeg: 30, distanceNm: 50 },
      { name: 'KCDC-KPVU', trueCourseDeg: 20, distanceNm: 150 },
    ],
    defaults: { tasKt: 110, windDirDeg: 250, windSpeedKt: 20, variationDeg: 11, burnGph: 8.5 },
    startFuelGal: 40, departMinUtc: 15 * 60, taxiFuelGal: 1,
  });
  assert.equal(log.rows.length, 2);
  close(log.totalDistanceNm, 200, 1e-9);
  // A quartering tailwind must speed both legs up.
  assert.ok(log.rows[0].groundspeedKt > 110);
  close(log.rows[0].cumTimeMin + log.rows[1].legTimeMin, log.totalTimeMin, 1e-9);
  close(log.totalFuelGal, 1 + 8.5 * (log.totalTimeMin / 60), 1e-9);
  close(log.fuelRemainingGal, 40 - log.totalFuelGal, 1e-9);
  close(log.etaMinUtc, 900 + log.totalTimeMin, 1e-9);
  // East variation of 11 degrees means the magnetic heading is 11 degrees less.
  close(log.rows[0].magneticHeadingDeg, log.rows[0].trueHeadingDeg - 11, 1e-9);
});
