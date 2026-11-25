// How audit entries read on the page (docs/audit-log.md).
import { STATUS_LABELS } from '../tickets/options.js';
import { roleLabel } from '../users/listParams.js';

export const ACTION_LABELS = {
  'auth.login': 'Logged in',
  'auth.login_failed': 'Failed login',
  'ticket.status_changed': 'Ticket status changed',
  'ticket.assignee_changed': 'Ticket assignment changed',
  'user.created': 'User created',
  'user.role_changed': 'User role changed',
  'user.active_changed': 'User access changed',
};

export const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function activeLabel(value) {
  return value ? 'Active' : 'Deactivated';
}

function assigneeLabel(value) {
  return value?.name ?? 'Unassigned';
}

const ARROW = ' → ';

// One line of details per action, from the entry's metadata.
export function describeDetails({ action, metadata = {} }) {
  switch (action) {
    case 'auth.login_failed':
      return `Email: ${metadata.email ?? ''}`;
    case 'ticket.status_changed':
      return [metadata.from, metadata.to]
        .map((status) => STATUS_LABELS[status] ?? status)
        .join(ARROW);
    case 'ticket.assignee_changed':
      return [metadata.from, metadata.to].map(assigneeLabel).join(ARROW);
    case 'user.created':
      return `Role: ${roleLabel(metadata.role)}`;
    case 'user.role_changed':
      return [metadata.from, metadata.to].map(roleLabel).join(ARROW);
    case 'user.active_changed':
      return [metadata.from, metadata.to].map(activeLabel).join(ARROW);
    default:
      return '';
  }
}

export function actorName(entry) {
  if (entry.actor) return entry.actor.name;
  return entry.action === 'auth.login_failed' ? 'Not logged in' : 'Deleted user';
}

// The local date and time, in the viewer's own format (for example "25 Nov 2026, 14:03:12").
export function formatAuditTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}
