import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getUsers } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import Pagination from '../components/Pagination.jsx';
import { MEDIA } from '../layout/breakpoints.js';
import { useMediaQuery } from '../layout/useMediaQuery.js';
import '../components/forms.css';
import { formatDate, pageFromSearch } from '../tickets/format.js';
import { withChanges } from '../tickets/listParams.js';
import '../tickets/tickets.css';
import CreateUserForm from '../users/CreateUserForm.jsx';
import { ActiveControl, RoleControl } from '../users/UserControls.jsx';
import UserFilters from '../users/UserFilters.jsx';
import {
  CLEARED_USER_FILTERS,
  hasActiveUserFilters,
  roleLabel,
  userApiParams,
  userListStateFromSearch,
} from '../users/listParams.js';
import '../users/users.css';

const PAGE_SIZE = 20;
const CREATE_PANEL_ID = 'create-user-panel';

function ActiveBadge({ isActive }) {
  return (
    <span className={`badge ${isActive ? 'badge-user-active' : 'badge-user-inactive'}`}>
      {isActive ? 'Active' : 'Deactivated'}
    </span>
  );
}

function SelfMarker() {
  return <span className="user-self">You</span>;
}

// Controls re-mount when the user's role or state changes, so they start from the saved
// values (and a confirmation step closes) after every successful update.
function controlKey(user) {
  return `${user.id}:${user.role}:${user.isActive}`;
}

// Desktop: one row per user. Your own row shows no controls.
function UserTable({ users, currentUserId, focusTarget, onUpdated }) {
  return (
    <div className="ticket-table-wrapper">
      <table className="ticket-table user-table">
        <caption className="visually-hidden">Users, sorted by name</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">Access</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const focus = focusTarget?.id === user.id ? focusTarget.control : null;
            return (
              <tr key={user.id}>
                <td>
                  <span className="user-name">{user.name}</span> {isSelf && <SelfMarker />}
                </td>
                <td className="user-email">{user.email}</td>
                <td>
                  {isSelf ? (
                    roleLabel(user.role)
                  ) : (
                    <RoleControl
                      key={controlKey(user)}
                      user={user}
                      onUpdated={onUpdated}
                      autoFocus={focus === 'role'}
                      hideLabel
                    />
                  )}
                </td>
                <td>
                  <ActiveBadge isActive={user.isActive} />
                </td>
                <td>
                  <time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time>
                </td>
                <td>
                  {isSelf ? (
                    <span className="user-self-note">Your account</span>
                  ) : (
                    <ActiveControl
                      key={controlKey(user)}
                      user={user}
                      onUpdated={onUpdated}
                      autoFocus={focus === 'active'}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Below the desktop breakpoint: one card per user. Only one of table and cards is
// rendered, so screen readers never get both.
function UserCards({ users, currentUserId, focusTarget, onUpdated }) {
  return (
    <ul className="ticket-cards user-cards" aria-label="Users, sorted by name">
      {users.map((user) => {
        const isSelf = user.id === currentUserId;
        const focus = focusTarget?.id === user.id ? focusTarget.control : null;
        return (
          <li className="ticket-card user-card" key={user.id}>
            <h2 className="ticket-card-title user-card-title">
              <span className="user-name">{user.name}</span> {isSelf && <SelfMarker />}
            </h2>
            <dl className="ticket-card-meta">
              <div>
                <dt>Email</dt>
                <dd className="user-email">{user.email}</dd>
              </div>
              {isSelf && (
                <div>
                  <dt>Role</dt>
                  <dd>{roleLabel(user.role)}</dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd>
                  <ActiveBadge isActive={user.isActive} />
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  <time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time>
                </dd>
              </div>
            </dl>
            {!isSelf && (
              <div className="user-card-controls">
                <RoleControl
                  key={controlKey(user)}
                  user={user}
                  onUpdated={onUpdated}
                  autoFocus={focus === 'role'}
                />
                <ActiveControl
                  key={`active-${controlKey(user)}`}
                  user={user}
                  onUpdated={onUpdated}
                  autoFocus={focus === 'active'}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function updateNotice(user, changes) {
  if (changes.isActive === false) return `${user.name} was deactivated.`;
  if (changes.isActive === true) return `${user.name} was reactivated.`;
  const role = roleLabel(user.role).toLowerCase();
  return `${user.name} is now ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}.`;
}

// Admin user management (CD-19, docs/user-management.md): list, filter, create, change
// roles, deactivate and reactivate. Filters and page live in the URL like the ticket list.
// The API checks every rule again; this page only hides what an admin cannot do.
function UsersPage() {
  const { user: currentUser } = useAuth();
  const isWide = useMediaQuery(MEDIA.desktop);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFromSearch(searchParams);
  const listState = userListStateFromSearch(searchParams);
  const apiParams = userApiParams(listState);
  const filtersActive = hasActiveUserFilters(listState);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = JSON.stringify({ page, ...apiParams, reloadCount });
  // The result remembers which request it answers; any other key means "loading".
  const [result, setResult] = useState({ key: null });
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const createButtonRef = useRef(null);
  // After a save the row's controls re-mount; this puts focus back on the one that was used.
  const [focusTarget, setFocusTarget] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const { reloadCount: _reload, ...params } = JSON.parse(requestKey);

    getUsers({ ...params, limit: PAGE_SIZE, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        if (error.name === 'AbortError' || controller.signal.aborted) return;
        setResult({ key: requestKey, error: error.message });
      });

    return () => controller.abort();
  }, [requestKey]);

  // A reload re-mounts every row, which must not move focus.
  function reload() {
    setFocusTarget(null);
    setReloadCount((count) => count + 1);
  }

  function update(changes, options) {
    setFocusTarget(null);
    setSearchParams((current) => withChanges(current, changes), options);
  }

  function goToPage(nextPage) {
    update({ page: nextPage > 1 ? nextPage : '' });
  }

  function clearFilters() {
    update(CLEARED_USER_FILTERS);
  }

  function closeCreate() {
    setShowCreate(false);
    createButtonRef.current?.focus();
  }

  function handleCreated(user) {
    setNotice(`User created: ${user.name} (${roleLabel(user.role)}).`);
    closeCreate();
    reload();
  }

  // The row keeps its place until the next reload, even if it no longer matches a filter.
  function handleUpdated(updated, changes) {
    setNotice(updateNotice(updated, changes));
    setFocusTarget({ id: updated.id, control: 'isActive' in changes ? 'active' : 'role' });
    setResult((current) => ({
      ...current,
      data: {
        ...current.data,
        items: current.data.items.map((item) => (item.id === updated.id ? updated : item)),
      },
    }));
  }

  const loading = result.key !== requestKey;
  const items = result.data?.items ?? [];
  const total = result.data?.total ?? items.length;
  const totalPages = result.data?.totalPages ?? (items.length > 0 ? 1 : 0);

  let content;
  if (loading) {
    content = <Loading label="Loading users..." />;
  } else if (result.error) {
    content = <ErrorMessage message={result.error} onRetry={reload} />;
  } else if (total === 0 && filtersActive) {
    content = (
      <EmptyState
        title="No users match your filters"
        message="Try a different search or fewer filters."
        action={
          <button type="button" className="button-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    );
  } else if (total === 0) {
    content = <EmptyState title="No users yet" message="Create the first user account." />;
  } else if (items.length === 0) {
    content = (
      <EmptyState
        title="No users on this page"
        message={`There are only ${totalPages} page${totalPages === 1 ? '' : 's'} of users.`}
        action={
          <button type="button" className="button-secondary" onClick={() => goToPage(1)}>
            Go to page 1
          </button>
        }
      />
    );
  } else {
    const List = isWide ? UserTable : UserCards;
    content = (
      <>
        <p className="ticket-count" aria-live="polite">
          {total} user{total === 1 ? '' : 's'}
          {filtersActive ? ' match your filters' : ''}
        </p>
        <List
          users={items}
          currentUserId={currentUser?.id}
          focusTarget={focusTarget}
          onUpdated={handleUpdated}
        />
        <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
      </>
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1 className="page-title">Users</h1>
        <button
          type="button"
          ref={createButtonRef}
          className="button-link button-link-primary user-create-toggle"
          aria-controls={CREATE_PANEL_ID}
          aria-expanded={showCreate}
          onClick={() => {
            if (showCreate) return closeCreate();
            setNotice('');
            return setShowCreate(true);
          }}
        >
          New user
        </button>
      </div>

      {/* Always in the page, so screen readers announce each new message. */}
      <div role="status" aria-live="polite">
        {notice && <p className="form-success">{notice}</p>}
      </div>

      {showCreate && (
        <CreateUserForm id={CREATE_PANEL_ID} onCreated={handleCreated} onCancel={closeCreate} />
      )}

      <UserFilters
        state={listState}
        active={filtersActive}
        onChange={update}
        onSearch={(q) => update({ q }, { replace: true })}
        onClear={clearFilters}
      />

      {content}
    </section>
  );
}

export default UsersPage;
