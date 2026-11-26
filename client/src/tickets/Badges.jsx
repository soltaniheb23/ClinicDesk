import { formatLocaleDateTime } from './format.js';
import {
  PRIORITY_OPTIONS,
  SLA_KIND_LABELS,
  SLA_LABELS,
  STATUS_LABELS,
  labelFor,
} from './options.js';

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

// SLA state with its due time (CD-22, docs/sla.md), for agents and admins only. The label
// carries the meaning ("Due soon"), the tint only repeats it. Renders nothing for tickets
// without an SLA (created before CD-22) or when the API sent no sla object (customers).
export function SlaBadge({ sla, locale }) {
  if (!sla?.state) return null;

  const kind = SLA_KIND_LABELS[sla.kind] ?? sla.kind;
  const due = sla.dueAt ? formatLocaleDateTime(sla.dueAt, locale) : '';
  const dueText = `${kind} ${sla.state === 'breached' ? 'was due' : 'due'} ${due}`;

  return (
    <span className="sla">
      <span className={`badge badge-sla-${sla.state}`}>
        <span className="visually-hidden">SLA: </span>
        {SLA_LABELS[sla.state] ?? sla.state}
      </span>
      {due && (
        <span className="sla-due">
          <time dateTime={sla.dueAt}>{dueText}</time>
        </span>
      )}
    </span>
  );
}
