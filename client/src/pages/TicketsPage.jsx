import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getMyTickets } from '../api/index.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS, STATUS_LABELS, labelFor } from '../tickets/options.js';
import '../tickets/tickets.css';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function TicketTable({ tickets }) {
  return (
    <div className="ticket-table-wrapper">
      <table className="ticket-table">
        <caption className="visually-hidden">My tickets, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Category</th>
            <th scope="col">Priority</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>{ticket.title}</td>
              <td>{labelFor(CATEGORY_OPTIONS, ticket.category)}</td>
              <td>
                <span className={`badge badge-priority-${ticket.priority}`}>
                  {labelFor(PRIORITY_OPTIONS, ticket.priority)}
                </span>
              </td>
              <td>
                <span className={`badge badge-status-${ticket.status}`}>
                  {STATUS_LABELS[ticket.status] ?? ticket.status}
                </span>
              </td>
              <td>
                <time dateTime={ticket.createdAt}>
                  {dateFormat.format(new Date(ticket.createdAt))}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Minimal "my tickets" list for CD-10; filters, pagination and detail come in CD-11.
function TicketsPage() {
  const location = useLocation();
  const createdTitle = location.state?.createdTitle;
  const [state, setState] = useState({ status: 'loading', items: [], error: '' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    getMyTickets({ signal: controller.signal })
      .then((data) => setState({ status: 'ready', items: data?.items ?? [], error: '' }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState({ status: 'error', items: [], error: error.message });
        }
      });

    return () => controller.abort();
  }, [reloadKey]);

  function retry() {
    setState({ status: 'loading', items: [], error: '' });
    setReloadKey((key) => key + 1);
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

      {state.status === 'loading' && <Loading label="Loading tickets..." />}
      {state.status === 'error' && <ErrorMessage message={state.error} onRetry={retry} />}
      {state.status === 'ready' && state.items.length === 0 && (
        <EmptyState
          title="No tickets yet"
          message="Create your first ticket."
          action={
            <Link className="button-link button-link-primary" to="/tickets/new">
              New ticket
            </Link>
          }
        />
      )}
      {state.status === 'ready' && state.items.length > 0 && <TicketTable tickets={state.items} />}
    </section>
  );
}

export default TicketsPage;
