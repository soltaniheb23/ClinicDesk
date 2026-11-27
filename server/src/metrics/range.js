// Pure helpers for the metrics page (CD-23, docs/metrics.md): the range, and hours. Nothing
// here reads the clock: `now` is passed in, as in the SLA code.
const { HOUR_MS } = require('../sla/policy');

const DAY_MS = 24 * HOUR_MS;

// ?range= values and their length in days; "all" has no start.
const RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90, all: null });
const RANGES = Object.freeze(Object.keys(RANGE_DAYS));
const DEFAULT_RANGE = '30d';

// The first instant inside the range (inclusive), or null for "all". A range is a rolling
// window of whole 24-hour days ending at `now`, in calendar time (no business hours).
function rangeStart(range, now) {
  const days = RANGE_DAYS[range];
  if (days === undefined) throw new Error(`Unknown metrics range "${range}"`);
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}

// Milliseconds to hours, rounded to one decimal (half up). Non-finite input gives null.
function hoursFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return Math.round((ms / HOUR_MS) * 10) / 10;
}

// The average in hours of `count` durations summing to `totalMs`; null when there are none,
// so an empty range is never shown as 0 and never divides by zero.
function averageHours(totalMs, count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  return hoursFromMs(totalMs / count);
}

module.exports = {
  DAY_MS,
  DEFAULT_RANGE,
  RANGES,
  RANGE_DAYS,
  averageHours,
  hoursFromMs,
  rangeStart,
};
