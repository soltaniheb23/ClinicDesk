import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMetrics } from '../api/index.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  formatHours,
  rangeFromSearch,
  rangeLabel,
} from '../metrics/format.js';
import { formatLocaleDateTime } from '../tickets/format.js';
import { STATUS_LABELS } from '../tickets/options.js';
import '../components/forms.css';
import '../tickets/tickets.css';
import '../metrics/metrics.css';

// "in the last 30 days" / "in all time", for sentences and the table header.
function rangePhrase(range) {
  return range === 'all' ? 'all time' : `the last ${rangeLabel(range)}`;
}

// A duration: the short form on screen ("3 d 4 h"), the spoken form for screen readers.
function Hours({ value }) {
  const formatted = formatHours(value);
  if (!formatted) return null;
  return (
    <>
      <span aria-hidden="true">{formatted.short}</span>
      <span className="visually-hidden">{formatted.long}</span>
    </>
  );
}

function SummaryCard({ label, value, note }) {
  return (
    <li className="metrics-card">
      <h2 className="metrics-card-label">{label}</h2>
      <p className="metrics-card-value">{value}</p>
      <p className="metrics-card-note">{note}</p>
    </li>
  );
}

function SummaryCards({ metrics }) {
  const { openTickets, resolution, sla, range } = metrics;
  const hasAverage = formatHours(resolution.averageHours) !== null;
  return (
    <ul className="metrics-cards" aria-label="Summary">
      <SummaryCard
        label="Open tickets"
        value={openTickets.total}
        note="Not resolved or closed, right now"
      />
      <SummaryCard
        label="Average resolution time"
        value={
          hasAverage ? (
            <Hours value={resolution.averageHours} />
          ) : (
            <span className="metrics-card-empty">No resolved tickets in this range</span>
          )
        }
        note={`${resolution.resolvedCount} ticket${resolution.resolvedCount === 1 ? '' : 's'} resolved in ${rangePhrase(range)}`}
      />
      <SummaryCard
        label="Breached"
        value={sla.breachedOpen}
        note="Open tickets past an SLA target"
      />
      <SummaryCard
        label="Due soon"
        value={sla.atRiskOpen}
        note="Open tickets with 75% of their SLA time used"
      />
    </ul>
  );
}

function OpenByStatus({ byStatus }) {
  return (
    <section className="metrics-section" aria-labelledby="metrics-status-heading">
      <h2 id="metrics-status-heading">Open tickets by status</h2>
      <dl className="metrics-status-list">
        {Object.entries(byStatus).map(([status, count]) => (
          <div key={status}>
            <dt>{STATUS_LABELS[status] ?? status}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function agentName(row) {
  const name = row.name ?? 'Deleted user';
  return row.inactive ? `${name} (inactive)` : name;
}

function AgentTable({ metrics }) {
  const phrase = rangePhrase(metrics.range);
  return (
    <section className="metrics-section" aria-labelledby="metrics-agents-heading">
      <h2 id="metrics-agents-heading">Tickets per agent</h2>
      <div className="ticket-table-wrapper">
        <table className="ticket-table metrics-table">
          <caption className="visually-hidden">
            Tickets per agent: open tickets assigned now, and tickets resolved in {phrase}. Sorted
            by open tickets, most first.
          </caption>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col" className="metrics-number">
                Open assigned
              </th>
              <th scope="col" className="metrics-number">
                Resolved in range
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.perAgent.map((row) => (
              <tr key={row.id}>
                <th scope="row">{agentName(row)}</th>
                <td className="metrics-number">{row.openAssigned}</td>
                <td className="metrics-number">{row.resolvedInRange}</td>
              </tr>
            ))}
            <tr className="metrics-unassigned">
              <th scope="row">Unassigned</th>
              <td className="metrics-number">{metrics.unassigned.open}</td>
              <td className="metrics-number">
                <span aria-hidden="true">–</span>
                <span className="visually-hidden">Not counted</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="metrics-footnote">
        Resolved in range: tickets resolved in {phrase}, counted for the agent they are assigned to
        now.
      </p>
    </section>
  );
}

// Team metrics (CD-23, docs/metrics.md), admin only. The range is in the URL (?range=7d), as
// the list filters are; 30 days is the default and is left out of the URL.
function MetricsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = rangeFromSearch(searchParams);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${range}:${reloadCount}`;
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    const controller = new AbortController();
    getMetrics({ range, signal: controller.signal })
      .then((metrics) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, metrics });
      })
      .catch((error) => {
        if (error.name === 'AbortError' || controller.signal.aborted) return;
        setResult({ key: requestKey, error: error.message });
      });
    return () => controller.abort();
  }, [range, requestKey]);

  function changeRange(next) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === DEFAULT_RANGE) params.delete('range');
      else params.set('range', next);
      return params;
    });
  }

  let content;
  if (result.key !== requestKey) {
    content = <Loading label="Loading metrics..." />;
  } else if (result.error) {
    content = (
      <ErrorMessage message={result.error} onRetry={() => setReloadCount((count) => count + 1)} />
    );
  } else {
    const { metrics } = result;
    const isEmpty = metrics.openTickets.total === 0 && metrics.resolution.resolvedCount === 0;
    content = (
      <>
        <p className="metrics-generated" aria-live="polite">
          Showing {rangePhrase(metrics.range)}
          {metrics.from ? ` (since ${formatLocaleDateTime(metrics.from)})` : ''}. Updated{' '}
          <time dateTime={metrics.generatedAt}>{formatLocaleDateTime(metrics.generatedAt)}</time>.
        </p>
        <SummaryCards metrics={metrics} />
        {isEmpty ? (
          <EmptyState
            title="No tickets to measure"
            message={`There are no open tickets, and none were resolved in ${rangePhrase(metrics.range)}.`}
            action={
              metrics.range !== 'all' && (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => changeRange('all')}
                >
                  Show all time
                </button>
              )
            }
          />
        ) : (
          <>
            <OpenByStatus byStatus={metrics.openTickets.byStatus} />
            <AgentTable metrics={metrics} />
          </>
        )}
      </>
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1 className="page-title">Metrics</h1>
      </div>
      <p className="metrics-intro">
        How the team is doing. Open tickets and SLA are counted right now; resolution times and
        resolved tickets cover the selected range.
      </p>
      <div className="ticket-filters metrics-filters">
        <div className="ticket-filters-select">
          <FormField
            id="metrics-range"
            as="select"
            label="Time range"
            value={range}
            onChange={(event) => changeRange(event.target.value)}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormField>
        </div>
      </div>
      {content}
    </section>
  );
}

export default MetricsPage;
