import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getTickets } from '../api/index.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import { PriorityBadge, StatusBadge } from '../tickets/Badges.jsx';
import { formatDate, pageFromSearch } from '../tickets/format.js';
import '../tickets/tickets.css';

const PAGE_SIZE = 10;

function TicketTable({ tickets, listSearch }) {
  return (
    <div className="ticket-table-wrapper">
      <table className="ticket-table">
        <caption className="visually-hidden">Tickets, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assignee</th>
            <th scope="col">Created</th>
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

function Pagination({ page, totalPages, onChange }) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="button-secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="button-secondary"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

// Ticket list (wireframe 02): newest first, 10 per page, page kept in ?page=.
// Filters and search come in CD-17.
function TicketsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFromSearch(searchParams);
  const createdTitle = location.state?.createdTitle;
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${page}:${reloadCount}`;
  // The result remembers which request it answers; any other key means "loading".
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    const controller = new AbortController();

    getTickets({ page, limit: PAGE_SIZE, signal: controller.signal })
      .then((data) => setResult({ key: requestKey, data }))
      .catch((error) => {
        if (error.name !== 'AbortError') setResult({ key: requestKey, error: error.message });
      });

    return () => controller.abort();
  }, [page, requestKey]);

  function goToPage(nextPage) {
    setSearchParams(nextPage > 1 ? { page: String(nextPage) } : {});
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
        <TicketTable tickets={items} listSearch={location.search} />
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

      {content}
    </section>
  );
}

export default TicketsPage;
