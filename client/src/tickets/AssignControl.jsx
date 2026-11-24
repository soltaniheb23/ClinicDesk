import { useEffect, useState } from 'react';
import { getAgents, updateTicketAssignee } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';

// The server's 400 for a bad assignee carries the useful text in details[0].
function messageFor(error) {
  return error.details?.[0]?.message ?? error.message;
}

// Shared save logic: sends the PATCH, reports the updated ticket, keeps errors local.
function useAssigneeSave(ticket, onUpdated) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(assignee) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const { ticket: updated } = await updateTicketAssignee(ticket.id, assignee);
      // The page re-mounts this control for the new assignee (see TicketDetailPage).
      onUpdated(updated);
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSaving(false);
    }
  }

  const errorBlock = error && (
    <p className="form-error" id="assign-error" role="alert">
      {error}
    </p>
  );

  return { save, saving, error, errorBlock };
}

// Agents: claim the ticket ("Assign to me") or release their own assignment.
function AgentAssign({ ticket, userId, onUpdated }) {
  const { save, saving, error, errorBlock } = useAssigneeSave(ticket, onUpdated);
  const isMine = ticket.assignee?.id === userId;

  function submit(event) {
    event.preventDefault();
    save(isMine ? null : userId);
  }

  let label = isMine ? 'Unassign me' : 'Assign to me';
  if (saving) label = 'Saving...';

  return (
    <form className="assign-panel" aria-label="Ticket assignment" onSubmit={submit}>
      {errorBlock}
      <button
        type="submit"
        className="button-secondary"
        disabled={saving}
        aria-busy={saving}
        aria-describedby={error ? 'assign-error' : undefined}
      >
        {label}
      </button>
    </form>
  );
}

// Admins: pick any active agent or admin, or "Unassigned".
function AdminAssign({ ticket, onUpdated }) {
  const { save, saving, error, errorBlock } = useAssigneeSave(ticket, onUpdated);
  const currentId = ticket.assignee?.id ?? '';
  const [selected, setSelected] = useState(currentId);
  const [reloadCount, setReloadCount] = useState(0);
  const [agents, setAgents] = useState({ key: null });

  useEffect(() => {
    const controller = new AbortController();
    getAgents({ signal: controller.signal })
      .then((data) => setAgents({ key: reloadCount, items: data.items }))
      .catch((loadError) => {
        if (loadError.name === 'AbortError') return;
        setAgents({ key: reloadCount, error: loadError.message });
      });
    return () => controller.abort();
  }, [reloadCount]);

  if (agents.key !== reloadCount) {
    return (
      <div className="assign-panel">
        <Loading label="Loading agents..." />
      </div>
    );
  }

  if (agents.error) {
    return (
      <div className="assign-panel">
        <ErrorMessage message={agents.error} onRetry={() => setReloadCount((count) => count + 1)} />
      </div>
    );
  }

  // Keep the current assignee selectable even if they are no longer in the list
  // (for example after being deactivated).
  const options = [...agents.items];
  if (ticket.assignee && !options.some((agent) => agent.id === ticket.assignee.id)) {
    options.push(ticket.assignee);
  }

  function submit(event) {
    event.preventDefault();
    save(selected === '' ? null : selected);
  }

  return (
    <form className="assign-panel" aria-label="Ticket assignment" onSubmit={submit}>
      <FormField
        id="ticket-assignee"
        as="select"
        label="Assign to"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        disabled={saving}
      >
        <option value="">Unassigned</option>
        {options.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </FormField>
      {errorBlock}
      <button
        type="submit"
        className="button-primary"
        disabled={saving || selected === currentId}
        aria-busy={saving}
        aria-describedby={error ? 'assign-error' : undefined}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

// Assignment controls for staff; customers and closed tickets get none. The server checks
// every rule again (docs/assignment.md).
function AssignControl({ ticket, onUpdated }) {
  const { user } = useAuth();

  if (ticket.status === 'closed') return null;
  if (user?.role === 'admin') return <AdminAssign ticket={ticket} onUpdated={onUpdated} />;
  if (user?.role === 'agent') {
    return <AgentAssign ticket={ticket} userId={user.id} onUpdated={onUpdated} />;
  }
  return null;
}

export default AssignControl;
