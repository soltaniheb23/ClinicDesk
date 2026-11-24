import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getTicket } from '../api/index.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import { PriorityBadge, StatusBadge } from '../tickets/Badges.jsx';
import { formatDate } from '../tickets/format.js';
import { CATEGORY_OPTIONS, labelFor } from '../tickets/options.js';
import '../tickets/tickets.css';

// Ticket detail (wireframe 03), read-only. Comments (CD-12), status changes (CD-13) and
// assignment (CD-14) come later.
function TicketDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const backTo = `/tickets${location.state?.listSearch ?? ''}`;
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${id}:${reloadCount}`;
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    const controller = new AbortController();

    getTicket(id, { signal: controller.signal })
      .then((data) => setResult({ key: requestKey, ticket: data.ticket }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setResult({ key: requestKey, notFound: error.status === 404, error: error.message });
      });

    return () => controller.abort();
  }, [id, requestKey]);

  const backLink = (
    <Link className="back-link" to={backTo}>
      Back to tickets
    </Link>
  );

  if (result.key !== requestKey) {
    return (
      <section>
        {backLink}
        <Loading label="Loading ticket..." />
      </section>
    );
  }

  if (result.notFound) {
    return (
      <section>
        {backLink}
        <EmptyState
          title="Ticket not found"
          message="This ticket does not exist or you do not have access to it."
        />
      </section>
    );
  }

  if (result.error) {
    return (
      <section>
        {backLink}
        <ErrorMessage message={result.error} onRetry={() => setReloadCount((count) => count + 1)} />
      </section>
    );
  }

  const { ticket } = result;

  return (
    <article>
      {backLink}
      <header className="ticket-detail-header">
        <h1 className="page-title">{ticket.title}</h1>
        <div className="ticket-badges">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
        </div>
      </header>
      <dl className="ticket-meta">
        <div>
          <dt>Category</dt>
          <dd>{labelFor(CATEGORY_OPTIONS, ticket.category)}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{ticket.createdBy?.name ?? 'Deleted user'}</dd>
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
      <section className="ticket-description" aria-labelledby="ticket-description-heading">
        <h2 id="ticket-description-heading">Description</h2>
        <p>{ticket.description}</p>
      </section>
    </article>
  );
}

export default TicketDetailPage;
