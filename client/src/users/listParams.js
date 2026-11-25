// Filter state of the admin user list, kept in the URL like the ticket list
// (docs/user-management.md). Values the API would reject fall back to "All".
import { ROLE_LABELS } from '../tickets/options.js';

export const ROLES = ['customer', 'agent', 'admin'];
export const SEARCH_MAX_LENGTH = 100;

export const ROLE_OPTIONS = ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }));

// URL value "active" -> API isActive.
export const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Deactivated' },
];

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

// Reads { q, role, active } from URLSearchParams; unknown values become ''.
export function userListStateFromSearch(searchParams) {
  const role = searchParams.get('role') ?? '';
  const active = searchParams.get('active') ?? '';
  return {
    q: (searchParams.get('q') ?? '').slice(0, SEARCH_MAX_LENGTH),
    role: ROLES.includes(role) ? role : '',
    active: ACTIVE_OPTIONS.some((option) => option.value === active) ? active : '',
  };
}

export function hasActiveUserFilters(state) {
  return state.q.trim() !== '' || state.role !== '' || state.active !== '';
}

// Query values for getUsers; empty filters are left out.
export function userApiParams(state) {
  const params = {};
  if (state.q.trim()) params.q = state.q.trim();
  if (state.role) params.role = state.role;
  if (state.active) params.isActive = state.active;
  return params;
}

export const CLEARED_USER_FILTERS = Object.freeze({ q: '', role: '', active: '' });
