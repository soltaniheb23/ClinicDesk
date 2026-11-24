import { PRIORITY_OPTIONS, STATUS_LABELS, labelFor } from './options.js';

// Badges always show a text label, so color is never the only signal.
export function StatusBadge({ status }) {
  return <span className={`badge badge-status-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function PriorityBadge({ priority }) {
  return (
    <span className={`badge badge-priority-${priority}`}>
      {labelFor(PRIORITY_OPTIONS, priority)}
    </span>
  );
}
