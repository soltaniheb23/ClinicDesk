import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAuditLogs } from '../api/index.js';
import AuditFilters from '../audit/AuditFilters.jsx';
import { ACTION_LABELS, actorName, describeDetails, formatAuditTime } from '../audit/entries.js';
import {
  CLEARED_AUDIT_FILTERS,
  auditApiParams,
  auditStateFromSearch,
  hasActiveAuditFilters,
  isRangeReversed,
} from '../audit/listParams.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import Pagination from '../components/Pagination.jsx';
import { MEDIA } from '../layout/breakpoints.js';
import { useMediaQuery } from '../layout/useMediaQuery.js';
import '../components/forms.css';
import { pageFromSearch } from '../tickets/format.js';
import { withChanges } from '../tickets/listParams.js';
import '../tickets/tickets.css';
import '../audit/audit.css';

const PAGE_SIZE = 20;
const RANGE_ERROR = 'The end date must be on or after the start date';

function Time({ value }) {
  return <time dateTime={value}>{formatAuditTime(value)}</time>;
}

// The user or ticket the entry is about. Tickets link to their page; a failed login has no
// target (the attempted email is in the details).
function Target({ entry }) {
  if (!entry.entityId) return <span className="audit-muted">None</span>;
  if (entry.entityType === 'ticket') {
    return (
      <Link className="ticket-title-link" to={`/tickets/${entry.entityId}`}>
        {entry.entityLabel ?? 'Deleted ticket'}
      </Link>
    );
  }
  return <span>{entry.entityLabel ?? 'Deleted user'}</span>;
}

function AuditTable({ entries }) {
  return (
    <div className="ticket-table-wrapper">
      <table className="ticket-table audit-table">
        <caption className="visually-hidden">Audit log, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <Time value={entry.createdAt} />
              </td>
              <td>{actorName(entry)}</td>
              <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
              <td>
                <Target entry={entry} />
              </td>
              <td className="audit-details">{describeDetails(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Phones: one card per entry. Only one of table and cards is rendered.
function AuditCards({ entries }) {
  return (
    <ul className="ticket-cards" aria-label="Audit log, newest first">
      {entries.map((entry) => (
        <li className="ticket-card" key={entry.id}>
          <h2 className="ticket-card-title audit-card-title">
            {ACTION_LABELS[entry.action] ?? entry.action}
          </h2>
          <dl className="ticket-card-meta">
            <div>
              <dt>Time</dt>
              <dd>
                <Time value={entry.createdAt} />
              </dd>
            </div>
            <div>
              <dt>Who</dt>
              <dd>{actorName(entry)}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>
                <Target entry={entry} />
              </dd>
            </div>
            {describeDetails(entry) && (
              <div>
                <dt>Details</dt>
                <dd>{describeDetails(entry)}</dd>
              </div>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

// Audit log (CD-20, docs/audit-log.md): read only, newest first, filters and page in the
// URL. The API checks the admin role again on every request.
function AuditLogPage() {
  const isWide = useMediaQuery(MEDIA.tablet);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFromSearch(searchParams);
  const filters = auditStateFromSearch(searchParams);
  const rangeReversed = isRangeReversed(filters);
  const filtersActive = hasActiveAuditFilters(filters);
  const [reloadCount, setReloadCount] = useState(0);
  // A reversed range is not sent: the key is null and the page shows the field error.
  const requestKey = rangeReversed
    ? null
    : JSON.stringify({ page, ...auditApiParams(filters), reloadCount });
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    if (requestKey === null) return undefined;
    const controller = new AbortController();
    const { reloadCount: _reload, ...params } = JSON.parse(requestKey);

    getAuditLogs({ ...params, limit: PAGE_SIZE, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        if (error.name === 'AbortError' || controller.signal.aborted) return;
        setResult({ key: requestKey, error: error.message });
      });

    return () => controller.abort();
  }, [requestKey]);

  function update(changes) {
    setSearchParams((current) => withChanges(current, changes));
  }

  function goToPage(nextPage) {
    update({ page: nextPage > 1 ? nextPage : '' });
  }

  function clearFilters() {
    update(CLEARED_AUDIT_FILTERS);
  }

  const items = result.data?.items ?? [];
  const total = result.data?.total ?? items.length;
  const totalPages = result.data?.totalPages ?? (items.length > 0 ? 1 : 0);

  let content;
  if (rangeReversed) {
    content = null;
  } else if (result.key !== requestKey) {
    content = <Loading label="Loading audit log..." />;
  } else if (result.error) {
    content = (
      <ErrorMessage message={result.error} onRetry={() => setReloadCount((count) => count + 1)} />
    );
  } else if (total === 0 && filtersActive) {
    content = (
      <EmptyState
        title="No entries match your filters"
        message="Try another action or a wider date range."
        action={
          <button type="button" className="button-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    );
  } else if (total === 0) {
    content = (
      <EmptyState
        title="No audit entries yet"
        message="Logins, status and assignment changes and user changes appear here."
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        title="No entries on this page"
        message={`There are only ${totalPages} page${totalPages === 1 ? '' : 's'} of entries.`}
        action={
          <button type="button" className="button-secondary" onClick={() => goToPage(1)}>
            Go to page 1
          </button>
        }
      />
    );
  } else {
    content = (
      <>
        <p className="ticket-count" aria-live="polite">
          {total} entr{total === 1 ? 'y' : 'ies'}
          {filtersActive ? ' match your filters' : ''}
        </p>
        {isWide ? <AuditTable entries={items} /> : <AuditCards entries={items} />}
        <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
      </>
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1 className="page-title">Audit log</h1>
      </div>
      <p className="audit-intro">
        Who did what and when. Entries are permanent: nobody can edit or delete them.
      </p>

      <AuditFilters
        state={filters}
        active={filtersActive}
        rangeError={rangeReversed ? RANGE_ERROR : undefined}
        onChange={update}
        onClear={clearFilters}
      />

      {content}
    </section>
  );
}

export default AuditLogPage;
