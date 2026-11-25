import FormField from '../components/FormField.jsx';
import { ACTION_OPTIONS } from './entries.js';

// Toolbar above the audit log. It reuses the ticket toolbar layout (.ticket-filters in
// tickets.css). A reversed date range is shown on the "To" field and is not sent.
function AuditFilters({ state, active, rangeError, onChange, onClear }) {
  return (
    <div className="ticket-filters" role="search" aria-label="Filter audit log">
      <div className="ticket-filters-select">
        <FormField
          id="audit-filter-action"
          as="select"
          label="Action"
          value={state.action}
          onChange={(event) => onChange({ action: event.target.value })}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FormField>
      </div>
      <div className="ticket-filters-select">
        <FormField
          id="audit-filter-from"
          type="date"
          label="From"
          value={state.from}
          max={state.to || undefined}
          onChange={(event) => onChange({ from: event.target.value })}
        />
      </div>
      <div className="ticket-filters-select">
        <FormField
          id="audit-filter-to"
          type="date"
          label="To"
          value={state.to}
          min={state.from || undefined}
          error={rangeError}
          onChange={(event) => onChange({ to: event.target.value })}
        />
      </div>
      {active && (
        <div className="ticket-filters-clear">
          <button type="button" className="button-secondary" onClick={onClear}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

export default AuditFilters;
