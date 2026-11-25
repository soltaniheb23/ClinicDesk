import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getTickets } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import Pagination from '../components/Pagination.jsx';
import { MEDIA } from '../layout/breakpoints.js';
import { useMediaQuery } from '../layout/useMediaQuery.js';
import '../components/forms.css';
import { PriorityBadge, StatusBadge } from '../tickets/Badges.jsx';
import TicketFilters from '../tickets/TicketFilters.jsx';
import { formatDate, pageFromSearch } from '../tickets/format.js';
import {
  apiParamsFromState,
  clearedFilters,
  describeSort,
  hasActiveFilters,
  listStateFromSearch,
  nextSortFor,
  withChanges,
} from '../tickets/listParams.js';
import '../tickets/tickets.css';

const PAGE_SIZE = 10;

// A sortable column header: a real button, with aria-sort on the active column only.
function SortableHeader({ field, label, sortState, onSort }) {
  const active = sortState.sort === field;
  const direction = sortState.order === 'asc' ? 'ascending' : 'descending';
  const next = nextSortFor(field, sortState);

  return (
    <th scope="col" aria-sort={active ? direction : undefined}>
      <button
        type="button"
        className="sort-button"
        onClick={() => onSort(next)}
        aria-label={`Sort by ${label.toLowerCase()}, ${next.order === 'asc' ? 'ascending' : 'descending'}`}
      >
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active ? (sortState.order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function TicketTable({ tickets, listSearch, sortState, onSort }) {
  return (
    <div className="ticket-table-wrapper">
      <table className="ticket-table">
        <caption className="visually-hidden">Tickets, {describeSort(sortState)}</caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <SortableHeader field="status" label="Status" sortState={sortState} onSort={onSort} />
            <SortableHeader
              field="priority"
              label="Priority"
              sortState={sortState}
              onSort={onSort}
            />
            <th scope="col">Assignee</th>
            <SortableHeader
              field="createdAt"
              label="Created"
              sortState={sortState}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <Link
                  className="ticket-title-link"
                  to={`/tickets/${ticket.id}`}
                  state={{ listSearch }}
                >
                  {ticket.title}
                </Link>
              </td>
              <td>
                <StatusBadge status={ticket.status} />
              </td>
              <td>
                <PriorityBadge priority={ticket.priority} />
              </td>
              <td>{ticket.assignee?.name ?? 'Unassigned'}</td>
              <td>
                <time dateTime={ticket.createdAt}>{formatDate(ticket.createdAt)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Below the tablet breakpoint (CD-36): one card per ticket instead of the table. Only one of
// the two is rendered, so screen readers get either a real table or a list of cards with a
// heading and labelled values, never both.
function TicketCards({ tickets, listSearch, sortState }) {
  return (
    <ul className="ticket-cards" aria-label={`Tickets, ${describeSort(sortState)}`}>
      {tickets.map((ticket) => (
        <li className="ticket-card" key={ticket.id}>
          <h2 className="ticket-card-title">
            <Link className="ticket-title-link" to={`/tickets/${ticket.id}`} state={{ listSearch }}>
              {ticket.title}
            </Link>
          </h2>
          <dl className="ticket-card-meta">
            <div className="ticket-card-badges">
              <dt className="visually-hidden">Status</dt>
              <dd>
                <StatusBadge status={ticket.status} />
              </dd>
              <dt className="visually-hidden">Priority</dt>
              <dd>
                <PriorityBadge priority={ticket.priority} />
              </dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>{ticket.assignee?.name ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time dateTime={ticket.createdAt}>{formatDate(ticket.createdAt)}</time>
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

// Ticket list (wireframe 02) with filters, title search and sorting (CD-17). Page, filters
// and sort live in the URL (docs/ticket-list.md), so refresh, the back button, shared links
// and "Back to tickets" on the detail page keep them.
function TicketsPage() {
  const location = useLocation();
  const { user } = useAuth();
  const role = user?.role;
  const isStaff = role === 'agent' || role === 'admin';
  // Phones get cards, where the column headers that sort are gone, so the sort select is
  // shown to every role there.
  const isWide = useMediaQuery(MEDIA.tablet);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFromSearch(searchParams);
  const listState = listStateFromSearch(searchParams, role);
  const apiParams = apiParamsFromState(listState);
  const filtersActive = hasActiveFilters(listState);
  const createdTitle = location.state?.createdTitle;
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = JSON.stringify({ page, ...apiParams, reloadCount });
  // The result remembers which request it answers; any other key means "loading". A newer
  // request aborts the older one, so a slow, stale response is never shown.
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    const controller = new AbortController();
    const { reloadCount: _reload, ...params } = JSON.parse(requestKey);

    getTickets({ ...params, limit: PAGE_SIZE, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        if (error.name === 'AbortError' || controller.signal.aborted) return;
        setResult({ key: requestKey, error: error.message });
      });

    return () => controller.abort();
  }, [requestKey]);

  function update(changes, options) {
    setSearchParams((current) => withChanges(current, changes), options);
  }

  function goToPage(nextPage) {
    update({ page: nextPage > 1 ? nextPage : '' });
  }

  // Each pause while typing replaces the history entry instead of adding one per word.
  function search(q) {
    update({ q }, { replace: true });
  }

  function clearFilters() {
    update(clearedFilters());
  }

  const loading = result.key !== requestKey;
  const items = result.data?.items ?? [];
  const total = result.data?.total ?? items.length;
  const totalPages = result.data?.totalPages ?? (items.length > 0 ? 1 : 0);

  let content;
  if (loading) {
    content = <Loading label="Loading tickets..." />;
  } else if (result.error) {
    content = (
      <ErrorMessage message={result.error} onRetry={() => setReloadCount((count) => count + 1)} />
    );
  } else if (total === 0 && filtersActive) {
    content = (
      <EmptyState
        title="No tickets match your filters"
        message="Try a different search or fewer filters."
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
        title="No tickets yet"
        message="Create your first ticket."
        action={
          <Link className="button-link button-link-primary" to="/tickets/new">
            New ticket
          </Link>
        }
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        title="No tickets on this page"
        message={`There are only ${totalPages} page${totalPages === 1 ? '' : 's'} of tickets.`}
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
          {total} ticket{total === 1 ? '' : 's'}
          {filtersActive ? ' match your filters' : ''}
        </p>
        {isWide ? (
          <TicketTable
            tickets={items}
            listSearch={location.search}
            sortState={listState}
            onSort={update}
          />
        ) : (
          <TicketCards tickets={items} listSearch={location.search} sortState={listState} />
        )}
        <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
      </>
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1 className="page-title">Tickets</h1>
        <Link className="button-link button-link-primary" to="/tickets/new">
          New ticket
        </Link>
      </div>

      {createdTitle && (
        <p className="form-success" role="status">
          Ticket created: {createdTitle}
        </p>
      )}

      <TicketFilters
        state={listState}
        role={role}
        showSort={isStaff || !isWide}
        active={filtersActive}
        onChange={update}
        onSearch={search}
        onClear={clearFilters}
      />

      {content}
    </section>
  );
}

export default TicketsPage;
