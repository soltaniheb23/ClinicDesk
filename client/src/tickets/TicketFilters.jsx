import { useEffect, useEffectEvent, useState } from 'react';
import FormField from '../components/FormField.jsx';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_LENGTH,
  SORT_OPTIONS,
  visibleFilters,
} from './listParams.js';

// Title search: typing updates the URL after a short pause (Enter applies it at once).
// The box follows the URL when it changes from outside (back button, "Clear filters").
function SearchBox({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const commit = useEffectEvent(onCommit);

  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return undefined;
    const timer = setTimeout(() => commit(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <FormField
      id="ticket-search"
      type="search"
      label="Search title"
      maxLength={SEARCH_MAX_LENGTH}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (draft !== value) onCommit(draft);
        }
      }}
    />
  );
}

// Toolbar above the ticket list (wireframe 02). Every control is labelled; the assignee
// filter and the sort select are for agents and admins only.
function TicketFilters({ state, role, isStaff, active, onChange, onSearch, onClear }) {
  return (
    <div className="ticket-filters" role="search" aria-label="Filter tickets">
      <div className="ticket-filters-search">
        <SearchBox value={state.q} onCommit={onSearch} />
      </div>

      {visibleFilters(role).map(({ key, label, options }) => (
        <div className="ticket-filters-select" key={key}>
          <FormField
            id={`filter-${key}`}
            as="select"
            label={label}
            value={state[key]}
            onChange={(event) => onChange({ [key]: event.target.value })}
          >
            <option value="">All</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormField>
        </div>
      ))}

      {isStaff && (
        <div className="ticket-filters-select">
          <FormField
            id="ticket-sort"
            as="select"
            label="Sort by"
            value={`${state.sort}:${state.order}`}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(':');
              onChange({ sort, order });
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormField>
        </div>
      )}

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

export default TicketFilters;
