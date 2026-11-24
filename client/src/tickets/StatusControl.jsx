import { useState } from 'react';
import { updateTicketStatus } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import FormField from '../components/FormField.jsx';
import { STATUS_LABELS } from './options.js';

// Built only from ticket.allowedNextStatuses (sent by the API), so the workflow rules live
// in one place on the server. Agents and admins pick from a select; customers get a single
// "Close ticket" button when closing is allowed.
function StatusControl({ ticket, onUpdated }) {
  const { user } = useAuth();
  const allowed = ticket.allowedNextStatuses ?? [];
  const [selected, setSelected] = useState(allowed[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (allowed.length === 0) return null;

  const isStaff = user?.role === 'agent' || user?.role === 'admin';
  if (!isStaff && !allowed.includes('closed')) return null;

  const nextStatus = isStaff ? selected : 'closed';

  async function save(event) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError('');
    try {
      const { ticket: updated } = await updateTicketStatus(ticket.id, nextStatus);
      // The page re-mounts this control for the new status (key={ticket.status}).
      onUpdated(updated);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const errorBlock = error && (
    <p className="form-error" id="status-error" role="alert">
      {error}
    </p>
  );

  if (!isStaff) {
    return (
      <form className="status-panel" aria-label="Ticket status" onSubmit={save}>
        {errorBlock}
        <button
          type="submit"
          className="button-secondary"
          disabled={saving}
          aria-busy={saving}
          aria-describedby={error ? 'status-error' : undefined}
        >
          {saving ? 'Closing...' : 'Close ticket'}
        </button>
      </form>
    );
  }

  return (
    <form className="status-panel" aria-label="Ticket status" onSubmit={save}>
      <FormField
        id="ticket-next-status"
        as="select"
        label="Status"
        value={nextStatus}
        onChange={(event) => setSelected(event.target.value)}
        disabled={saving}
      >
        {allowed.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status] ?? status}
          </option>
        ))}
      </FormField>
      {errorBlock}
      <button
        type="submit"
        className="button-primary"
        disabled={saving}
        aria-busy={saving}
        aria-describedby={error ? 'status-error' : undefined}
      >
        {saving ? 'Saving...' : 'Change status'}
      </button>
    </form>
  );
}

export default StatusControl;
