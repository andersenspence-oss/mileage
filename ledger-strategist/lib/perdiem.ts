// Per-diem (M&IE) math for overnight business travel. Pure and unit-tested.
//
// Method modeled: the high-low substantiation method for Meals & Incidental
// Expenses. Lodging per diem is deliberately NOT modeled — self-employed
// owners may only use per diem for M&IE; lodging needs actual receipts.
// Travel days (first and last) count at 75%. Meals are then subject to the
// 50% deduction limit. Every rate is year-sensitive: VERIFY with CPA.

export type PerDiemTripLite = {
  description: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  highCost: boolean;
  travelers: number;
};

export type PerDiemCalc = {
  nights: number;
  fullDays: number;
  travelDays: number; // always 2 for an overnight trip (first + last)
  dailyRate: number;
  mie: number; // gross M&IE per diem for the trip (all travelers)
  deductible: number; // after the 50% meals limit
  valid: boolean;
  reason?: string;
};

const DAY = 86400000;

export function calcTrip(
  trip: PerDiemTripLite,
  rates: { standard: number; highCost: number }
): PerDiemCalc {
  const nights = Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / DAY);
  const dailyRate = trip.highCost ? rates.highCost : rates.standard;
  if (nights < 1) {
    return { nights, fullDays: 0, travelDays: 0, dailyRate, mie: 0, deductible: 0, valid: false, reason: "Per diem requires overnight travel — same-day trips don't qualify." };
  }
  const travelers = Math.max(1, trip.travelers);
  const totalDays = nights + 1;
  const travelDays = 2; // first and last day at 75%
  const fullDays = Math.max(0, totalDays - travelDays);
  const mie = (fullDays * dailyRate + travelDays * dailyRate * 0.75) * travelers;
  const deductible = mie * 0.5; // 50% meals limit
  return { nights, fullDays, travelDays, dailyRate, mie: round2(mie), deductible: round2(deductible), valid: true };
}

export type PerDiemSummary = {
  tripCount: number;
  nights: number;
  totalMie: number;
  totalDeductible: number;
  invalidCount: number;
};

export function summarizePerDiem(
  trips: PerDiemTripLite[],
  rates: { standard: number; highCost: number },
  from: Date,
  to: Date
): PerDiemSummary {
  let nights = 0, totalMie = 0, totalDeductible = 0, tripCount = 0, invalidCount = 0;
  for (const t of trips) {
    if (t.startDate < from || t.startDate > to) continue;
    const c = calcTrip(t, rates);
    if (!c.valid) { invalidCount++; continue; }
    tripCount++;
    nights += c.nights;
    totalMie += c.mie;
    totalDeductible += c.deductible;
  }
  return { tripCount, nights, totalMie: round2(totalMie), totalDeductible: round2(totalDeductible), invalidCount };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
