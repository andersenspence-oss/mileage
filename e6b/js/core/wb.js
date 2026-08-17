// wb.js — weight and balance.
//
// Everything here works in pounds and inches, the units the FAA W&B handbook
// and every light-aircraft POH use. Moment index divisors are supported because
// most POH loading graphs are drawn in moment/1000.

/** Sum a list of {weight, arm} stations into weight, moment and CG. */
export function loadSheet(stations, { momentDivisor = 1 } = {}) {
  let weight = 0, moment = 0;
  const rows = stations.map((s) => {
    const w = Number(s.weight) || 0;
    const a = Number(s.arm);
    const m = w * (Number.isFinite(a) ? a : 0);
    weight += w;
    moment += m;
    return { ...s, weight: w, arm: a, moment: m, momentIndex: m / momentDivisor };
  });
  return {
    rows,
    totalWeightLb: weight,
    totalMomentLbIn: moment,
    momentIndex: moment / momentDivisor,
    cgIn: weight !== 0 ? moment / weight : NaN,
  };
}

/** Center of gravity as a percentage of the mean aerodynamic chord. */
export function percentMac({ cgIn, lemacIn, macIn }) {
  return ((cgIn - lemacIn) / macIn) * 100;
}

/** The inverse: the CG station for a given %MAC. */
export function cgFromPercentMac({ percent, lemacIn, macIn }) {
  return lemacIn + (percent / 100) * macIn;
}

/**
 * Moving weight that is already aboard.
 *   CG shift = (weight moved x distance moved) / total weight
 */
export function weightShift({ totalWeightLb, weightMovedLb, distanceIn, oldCgIn }) {
  const shift = (weightMovedLb * distanceIn) / totalWeightLb;
  return { cgShiftIn: shift, newCgIn: Number.isFinite(oldCgIn) ? oldCgIn + shift : NaN };
}

/** How much weight to move a known distance to achieve a desired CG change. */
export function weightToShift({ totalWeightLb, cgShiftIn, distanceIn }) {
  return (totalWeightLb * cgShiftIn) / distanceIn;
}

/** How far to move a known weight to achieve a desired CG change. */
export function distanceToShift({ totalWeightLb, cgShiftIn, weightMovedLb }) {
  return (totalWeightLb * cgShiftIn) / weightMovedLb;
}

/** Adding (positive) or removing (negative) weight at a station. */
export function addWeight({ totalWeightLb, oldCgIn, addedLb, armIn }) {
  const newW = totalWeightLb + addedLb;
  const newM = totalWeightLb * oldCgIn + addedLb * armIn;
  return { newWeightLb: newW, newCgIn: newM / newW, cgShiftIn: newM / newW - oldCgIn };
}

/**
 * Ballast required at a known arm to bring the CG to a target.
 *   ballast = W (CG_target - CG_now) / (arm_ballast - CG_target)
 */
export function ballastRequired({ totalWeightLb, currentCgIn, desiredCgIn, ballastArmIn }) {
  const denom = ballastArmIn - desiredCgIn;
  if (Math.abs(denom) < 1e-9) return NaN;
  return (totalWeightLb * (desiredCgIn - currentCgIn)) / denom;
}

/** CG after burning fuel from a tank at a known arm. */
export function afterFuelBurn({ totalWeightLb, cgIn, fuelBurnedLb, fuelArmIn }) {
  return addWeight({ totalWeightLb, oldCgIn: cgIn, addedLb: -fuelBurnedLb, armIn: fuelArmIn });
}

/**
 * Envelope check. `envelope` is a list of {weight, cg} vertices in order around
 * the CG envelope (either direction). Returns whether the point is inside and,
 * if limits are simple, how much margin is left.
 */
export function inEnvelope(point, envelope) {
  if (!Array.isArray(envelope) || envelope.length < 3) return null;
  const x = point.cgIn, y = point.weightLb;
  let inside = false;
  for (let i = 0, j = envelope.length - 1; i < envelope.length; j = i++) {
    const xi = envelope[i].cg, yi = envelope[i].weight;
    const xj = envelope[j].cg, yj = envelope[j].weight;
    // On-edge counts as inside; loading exactly on a limit is legal.
    const onEdge = Math.abs((xj - xi) * (y - yi) - (x - xi) * (yj - yi)) < 1e-9 &&
      x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9 &&
      y >= Math.min(yi, yj) - 1e-9 && y <= Math.max(yi, yj) + 1e-9;
    if (onEdge) return true;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** CG limits interpolated from an envelope at a given weight. */
export function cgLimitsAtWeight(weightLb, envelope) {
  let fwd = Infinity, aft = -Infinity, found = false;
  for (let i = 0, j = envelope.length - 1; i < envelope.length; j = i++) {
    const a = envelope[j], b = envelope[i];
    const lo = Math.min(a.weight, b.weight), hi = Math.max(a.weight, b.weight);
    if (weightLb < lo - 1e-9 || weightLb > hi + 1e-9) continue;
    const t = Math.abs(b.weight - a.weight) < 1e-9 ? 0 : (weightLb - a.weight) / (b.weight - a.weight);
    const cg = a.cg + t * (b.cg - a.cg);
    fwd = Math.min(fwd, cg); aft = Math.max(aft, cg); found = true;
  }
  return found ? { forwardLimitIn: fwd, aftLimitIn: aft } : null;
}

/**
 * Full check against simple limits: max gross weight and a fore/aft CG range
 * (or an envelope). Returns a list of human-readable problems.
 */
export function checkLimits({ totalWeightLb, cgIn, maxGrossLb, forwardLimitIn, aftLimitIn, envelope }) {
  const problems = [];
  if (Number.isFinite(maxGrossLb) && totalWeightLb > maxGrossLb + 1e-9) {
    problems.push(`Over gross by ${(totalWeightLb - maxGrossLb).toFixed(1)} lb`);
  }
  let limits = null;
  if (envelope && envelope.length >= 3) {
    limits = cgLimitsAtWeight(totalWeightLb, envelope);
    if (inEnvelope({ cgIn, weightLb: totalWeightLb }, envelope) === false) {
      problems.push('CG outside the published envelope');
    }
  } else if (Number.isFinite(forwardLimitIn) && Number.isFinite(aftLimitIn)) {
    limits = { forwardLimitIn, aftLimitIn };
    if (cgIn < forwardLimitIn - 1e-9) problems.push(`CG ${(forwardLimitIn - cgIn).toFixed(2)} in forward of the limit`);
    if (cgIn > aftLimitIn + 1e-9) problems.push(`CG ${(cgIn - aftLimitIn).toFixed(2)} in aft of the limit`);
  }
  return {
    ok: problems.length === 0,
    problems,
    limits,
    marginFwdIn: limits ? cgIn - limits.forwardLimitIn : NaN,
    marginAftIn: limits ? limits.aftLimitIn - cgIn : NaN,
    weightMarginLb: Number.isFinite(maxGrossLb) ? maxGrossLb - totalWeightLb : NaN,
  };
}
