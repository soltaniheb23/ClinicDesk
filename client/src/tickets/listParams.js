// Filter, search and sort state of the ticket list, kept in the URL (docs/ticket-list.md).
// Values that the API would reject are ignored here, so a hand-edited or outdated link
// falls back to "All" instead of an error.
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS, STATUS_LABELS } from './options.js';

export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_DEBOUNCE_MS = 300;

export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const ASSIGNEE_OPTIONS = [
  { value: 'me', label: 'Me' },
  { value: 'unassigned', label: 'Unassigned' },
];

// The select filters, in toolbar order. `staffOnly` filters are hidden from customers and
// never sent for them (the API answers 403).
export const FILTERS = [
  { key: 'status', label: 'Status', options: STATUS_OPTIONS },
  { key: 'priority', label: 'Priority', options: PRIORITY_OPTIONS },
  { key: 'category', label: 'Category', options: CATEGORY_OPTIONS },
  { key: 'assignee', label: 'Assignee', options: ASSIGNEE_OPTIONS, staffOnly: true },
];

// Sortable columns and the order a first click uses: newest, most urgent, and the start
// of the workflow first.
export const SORT_FIELDS = {
  createdAt: { label: 'Created', firstOrder: 'desc' },
  updatedAt: { label: 'Updated', firstOrder: 'desc' },
  priority: { label: 'Priority', firstOrder: 'desc' },
  status: { label: 'Status', firstOrder: 'asc' },
};

export const DEFAULT_SORT = { sort: 'createdAt', order: 'desc' };

export const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'updatedAt:asc', label: 'Least recently updated' },
  { value: 'priority:desc', label: 'Priority: urgent first' },
  { value: 'priority:asc', label: 'Priority: low first' },
  { value: 'status:asc', label: 'Status: open first' },
  { value: 'status:desc', label: 'Status: closed first' },
];

const ALLOWED_VALUES = Object.fromEntries(
  FILTERS.map(({ key, options }) => [key, options.map((option) => option.value)]),
);

function isStaffRole(role) {
  return role === 'agent' || role === 'admin';
}

export function visibleFilters(role) {
  return FILTERS.filter((filter) => !filter.staffOnly || isStaffRole(role));
}

// Reads { status, priority, category, assignee, q, sort, order } from URLSearchParams;
// a missing or unknown value is '' (filters) or the default (sort).
export function listStateFromSearch(searchParams, role) {
  const state = { q: (searchParams.get('q') ?? '').slice(0, SEARCH_MAX_LENGTH) };

  for (const { key } of visibleFilters(role)) {
    const value = searchParams.get(key) ?? '';
    state[key] = ALLOWED_VALUES[key].includes(value) ? value : '';
  }

  const sort = searchParams.get('sort');
  const order = searchParams.get('order');
  state.sort = Object.hasOwn(SORT_FIELDS, sort) ? sort : DEFAULT_SORT.sort;
  state.order = order === 'asc' || order === 'desc' ? order : DEFAULT_SORT.order;

  return state;
}

// True when any filter or search narrows the list (sorting does not).
export function hasActiveFilters(state) {
  return state.q.trim() !== '' || FILTERS.some(({ key }) => Boolean(state[key]));
}

// Query values for getTickets: empty filters and the default sort are left out.
export function apiParamsFromState(state) {
  const params = {};
  for (const { key } of FILTERS) {
    if (state[key]) params[key] = state[key];
  }
  if (state.q.trim()) params.q = state.q.trim();
  if (state.sort !== DEFAULT_SORT.sort || state.order !== DEFAULT_SORT.order) {
    params.sort = state.sort;
    params.order = state.order;
  }
  return params;
}

// Returns new URLSearchParams with `changes` applied ('' or null removes a key). Any change
// other than the page itself goes back to page 1; the default sort is left out of the URL.
export function withChanges(searchParams, changes) {
  const next = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(changes)) {
    if (value === '' || value === null || value === undefined) next.delete(key);
    else next.set(key, String(value));
  }
  if (!Object.hasOwn(changes, 'page')) next.delete('page');
  if (next.get('sort') === DEFAULT_SORT.sort && next.get('order') === DEFAULT_SORT.order) {
    next.delete('sort');
    next.delete('order');
  }
  return next;
}

export function clearedFilters() {
  return Object.fromEntries([...FILTERS.map(({ key }) => [key, '']), ['q', '']]);
}

// The order a click on a column header asks for: the other direction on the current
// column, otherwise that column's first order.
export function nextSortFor(field, state) {
  if (state.sort === field) return { sort: field, order: state.order === 'asc' ? 'desc' : 'asc' };
  return { sort: field, order: SORT_FIELDS[field].firstOrder };
}

// "newest first", "priority: urgent first", ... (every sort and order pair has an option).
export function describeSort({ sort, order }) {
  return SORT_OPTIONS.find((item) => item.value === `${sort}:${order}`).label.toLowerCase();
}
