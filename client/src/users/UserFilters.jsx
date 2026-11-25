import FormField from '../components/FormField.jsx';
import SearchBox from '../components/SearchBox.jsx';
import { ACTIVE_OPTIONS, ROLE_OPTIONS, SEARCH_MAX_LENGTH } from './listParams.js';

// Toolbar above the user list. It reuses the ticket toolbar layout (.ticket-filters in
// tickets.css): one column on phones, two on tablets, one row on desktops.
function UserFilters({ state, active, onChange, onSearch, onClear }) {
  return (
    <div className="ticket-filters" role="search" aria-label="Filter users">
      <div className="ticket-filters-search">
        <SearchBox
          id="user-search"
          label="Search name or email"
          maxLength={SEARCH_MAX_LENGTH}
          value={state.q}
          onCommit={onSearch}
        />
      </div>
      <div className="ticket-filters-select">
        <FormField
          id="user-filter-role"
          as="select"
          label="Role"
          value={state.role}
          onChange={(event) => onChange({ role: event.target.value })}
        >
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FormField>
      </div>
      <div className="ticket-filters-select">
        <FormField
          id="user-filter-active"
          as="select"
          label="Status"
          value={state.active}
          onChange={(event) => onChange({ active: event.target.value })}
        >
          <option value="">All</option>
          {ACTIVE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FormField>
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

export default UserFilters;
