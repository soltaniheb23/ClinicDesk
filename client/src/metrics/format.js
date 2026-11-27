// Metrics page formatting and URL state (CD-23, docs/metrics.md).

export const RANGE_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];
export const DEFAULT_RANGE = '30d';

// ?range= from the URL; a missing or unknown value is the default, so an old or hand-edited
// link shows 30 days instead of an error.
export function rangeFromSearch(searchParams) {
  const value = searchParams.get('range');
  return RANGE_OPTIONS.some((option) => option.value === value) ? value : DEFAULT_RANGE;
}

export function rangeLabel(range) {
  return RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Hours for display. Up to 48 hours: "5.5 h". Above 48 hours: days and whole hours, "3 d 4 h"
// (or "3 d"). `long` is the spoken form for screen readers ("3 days 4 hours"). null (nothing
// resolved) and anything that is not a finite number give null: never NaN or 0.
export function formatHours(hours) {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return null;

  if (hours <= 48) {
    const rounded = Math.round(hours * 10) / 10;
    return { short: `${rounded} h`, long: `${rounded} ${rounded === 1 ? 'hour' : 'hours'}` };
  }

  let days = Math.floor(hours / 24);
  let rest = Math.round(hours - days * 24);
  if (rest === 24) {
    days += 1;
    rest = 0;
  }
  if (rest === 0) return { short: `${days} d`, long: plural(days, 'day') };
  return { short: `${days} d ${rest} h`, long: `${plural(days, 'day')} ${plural(rest, 'hour')}` };
}
