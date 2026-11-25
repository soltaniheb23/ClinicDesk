// Filters of the audit log page, kept in the URL: action, from and to (local dates,
// YYYY-MM-DD, as a date input gives them). Values the API would reject fall back to "All".
import { ACTION_LABELS } from './entries.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// A local calendar date, or null for anything that is not a real date (2026-02-30).
function parseLocalDate(value, endOfDay) {
  const match = DATE_PATTERN.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function auditStateFromSearch(searchParams) {
  const action = searchParams.get('action') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  return {
    action: Object.hasOwn(ACTION_LABELS, action) ? action : '',
    from: parseLocalDate(from, false) ? from : '',
    to: parseLocalDate(to, true) ? to : '',
  };
}

export function hasActiveAuditFilters(state) {
  return Boolean(state.action || state.from || state.to);
}

// True when both dates are set and "to" is before "from".
export function isRangeReversed(state) {
  return Boolean(state.from && state.to && state.from > state.to);
}

// Query values for getAuditLogs. The dates are whole local days: "from" starts at local
// midnight and "to" ends at 23:59:59.999 local time, sent as UTC ISO date-times.
export function auditApiParams(state) {
  const params = {};
  if (state.action) params.action = state.action;
  if (state.from) params.from = parseLocalDate(state.from, false).toISOString();
  if (state.to) params.to = parseLocalDate(state.to, true).toISOString();
  return params;
}

export const CLEARED_AUDIT_FILTERS = Object.freeze({ action: '', from: '', to: '' });
