// Pure installment math for the customer-facing payment plan.
//
// A plan is always MONTHLY: installment #0 is charged today, then the same day-of-month
// each following month. The office sets a max count + an end date; the customer picks any
// count from 1..max. The last installment's date must never fall after the end date.
//
// The dates produced here are sent verbatim (as `Dates`) to the webhook installment engine
// (lecapp-webhooks → createFutureInvoices), so we don't rely on two systems independently
// deriving the same monthly dates — we compute them once, here, and hand them over.
//
// All dates are computed in America/New_York (the school's billing timezone), matching the
// engine. We avoid a tz library by formatting "now" into NY Y/M/D via Intl, then doing plain
// calendar arithmetic on those numbers and materialising each installment date at NY noon.

const BILLING_TZ = 'America/New_York';

export interface Installment {
  index: number; // 0-based; #0 is charged today
  amount: number; // cents
  date: number; // unix seconds — when this installment is charged/finalized
}

interface YMD {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Break a unix-seconds instant into the calendar Y/M/D as seen in America/New_York. */
function toBillingYMD(unixSec: number): YMD {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BILLING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(unixSec * 1000));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Days in a given calendar month (month is 1-12). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month === last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The NY-noon instant (unix seconds) for a Y/M/D, clamping the day to the month's length
 * (so "the 31st" becomes the 28th/30th in shorter months). Noon avoids any DST edge landing
 * the charge on the wrong calendar day.
 *
 * NY is UTC-5 (EST) or UTC-4 (EDT); noon local is 16:00 or 17:00 UTC. We don't need the exact
 * offset for correctness here — the engine re-derives finalize time from the date — but we
 * approximate NY noon as 16:00Z so the unix value lands squarely inside the intended NY day.
 */
function billingNoonUnix(year: number, month: number, day: number): number {
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return Math.floor(Date.UTC(year, month - 1, clampedDay, 16, 0, 0) / 1000);
}

/** Add `n` whole months to a Y/M/D, keeping the anchor day (clamped later at materialisation). */
function addMonths(base: YMD, n: number): YMD {
  const zeroIndexed = base.month - 1 + n;
  const year = base.year + Math.floor(zeroIndexed / 12);
  const month = (zeroIndexed % 12 + 12) % 12 + 1;
  return { year, month, day: base.day };
}

/** True when a <= b at day granularity. */
function ymdLTE(a: YMD, b: YMD): boolean {
  if (a.year !== b.year) return a.year < b.year;
  if (a.month !== b.month) return a.month < b.month;
  return a.day <= b.day;
}

/**
 * Maximum number of MONTHLY installments (incl. the one charged today) that fit between
 * `now` and `endDate` inclusive, anchored on today's day-of-month. e.g. today Sep 1 and
 * endDate Dec 1 => 4 (Sep, Oct, Nov, Dec). Minimum 1.
 */
export function maxMonthlyInstallments(nowSec: number, endDateSec: number): number {
  const start = toBillingYMD(nowSec);
  const end = toBillingYMD(endDateSec);
  let count = 0;
  // Advance month-by-month from the start anchor while the installment date is still <= end.
  for (let i = 0; i < 240; i++) {
    const candidate = addMonths(start, i);
    // Compare the MATERIALISED date (anchor day clamped to the month's length) so a "31st"
    // anchor doesn't spuriously overshoot a shorter end month (e.g. Apr 31 -> Apr 30).
    const clampedDay = Math.min(start.day, daysInMonth(candidate.year, candidate.month));
    if (ymdLTE({ year: candidate.year, month: candidate.month, day: clampedDay }, end)) count = i + 1;
    else break;
  }
  return Math.max(1, count);
}

/**
 * Build `count` monthly installments starting today. Splits `totalCents` as evenly as
 * possible with the remainder cents added to installment #0 (charged today), so the customer
 * is never surprised by a larger LAST charge. `count` is clamped to
 * [1, maxMonthlyInstallments]. Guarantees the last installment date <= endDate.
 */
export function buildPlan(
  totalCents: number,
  count: number,
  nowSec: number,
  endDateSec: number
): Installment[] {
  const max = maxMonthlyInstallments(nowSec, endDateSec);
  const n = Math.max(1, Math.min(Math.floor(count), max));

  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;

  const start = toBillingYMD(nowSec);

  return Array.from({ length: n }, (_, i) => {
    const ymd = addMonths(start, i);
    return {
      index: i,
      amount: base + (i === 0 ? remainder : 0),
      date: billingNoonUnix(ymd.year, ymd.month, ymd.day),
    };
  });
}
