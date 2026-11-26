import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getTicket } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import { PriorityBadge, SlaBadge, StatusBadge } from '../tickets/Badges.jsx';
import { formatDate } from '../tickets/format.js';
import { CATEGORY_OPTIONS, STATUS_LABELS, labelFor } from '../tickets/options.js';
import AssignControl from '../tickets/AssignControl.jsx';
import CommentThread from '../tickets/CommentThread.jsx';
import StatusControl from '../tickets/StatusControl.jsx';
import '../tickets/tickets.css';

// Ticket detail (wireframe 03) with the status and assignment controls and the comment
// thread. Attachments come in a later ticket.
function TicketDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  // SLA is staff-only (CD-22); the API sends no sla object to customers either.
  const isStaff = user?.role === 'agent' || user?.role === 'admin';
  const backTo = `/tickets${location.state?.listSearch ?? ''}`;
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${id}:${reloadCount}`;
  const [result, setResult] = useState({ key: null });
  const [notice, setNotice] = useState('');

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

  function handleStatusUpdated(updated) {
    setResult((previous) => ({ ...previous, ticket: updated }));
    setNotice(`Status changed to ${STATUS_LABELS[updated.status] ?? updated.status}.`);
  }

  function handleAssigneeUpdated(updated) {
    setResult((previous) => ({ ...previous, ticket: updated }));
    setNotice(updated.assignee ? `Assigned to ${updated.assignee.name}.` : 'Ticket unassigned.');
  }

  return (
    <article>
      {backLink}
      <header className="ticket-detail-header">
        <h1 className="page-title">{ticket.title}</h1>
        <div className="ticket-badges">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          {isStaff && <SlaBadge sla={ticket.sla} />}
        </div>
      </header>
      <StatusControl key={ticket.status} ticket={ticket} onUpdated={handleStatusUpdated} />
      <section className="assignment" aria-label="Assignment">
        <p className="assignee-line">
          {ticket.assignee ? `Assigned to ${ticket.assignee.name}` : 'Unassigned'}
        </p>
        <AssignControl
          key={ticket.assignee?.id ?? 'unassigned'}
          ticket={ticket}
          onUpdated={handleAssigneeUpdated}
        />
      </section>
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
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
      <CommentThread key={ticket.id} ticket={ticket} />
    </article>
  );
}

export default TicketDetailPage;
