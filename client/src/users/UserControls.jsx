import { useLayoutEffect, useRef, useState } from 'react';
import { updateUser } from '../api/index.js';
import { ROLE_OPTIONS } from './listParams.js';

// Shared save logic: sends the PATCH, reports the updated user, keeps the error local.
// Server refusals (LAST_ADMIN, CANNOT_CHANGE_SELF, USER_CONFLICT) carry a readable message.
function useUserUpdate(user, onUpdated) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(changes) {
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      const { user: updated } = await updateUser(user.id, changes);
      // The page re-mounts these controls for the updated user (see UsersPage).
      onUpdated(updated, changes);
      return true;
    } catch (requestError) {
      setError(requestError.details?.[0]?.message ?? requestError.message);
      setSaving(false);
      return false;
    }
  }

  return { save, saving, error };
}

// Moves focus to `ref` once when the control mounts with autoFocus (after a save re-mounts it).
// A layout effect, so focus moves in the same commit that replaces the old control: with a
// passive effect, focus sat on <body> for a moment after the saved row appeared (a
// screen-reader user could lose their place, and tests that checked focus flaked).
function useFocusOnMount(ref, autoFocus) {
  useLayoutEffect(() => {
    if (autoFocus) ref.current?.focus();
    // Only on mount: later renders must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Role select and its Save button. `hideLabel` is for the table, where the column header
// already says "Role"; the label always names the user for screen readers.
export function RoleControl({ user, onUpdated, hideLabel = false, autoFocus = false }) {
  const [role, setRole] = useState(user.role);
  const { save, saving, error } = useUserUpdate(user, onUpdated);
  const selectRef = useRef(null);
  useFocusOnMount(selectRef, autoFocus);
  const selectId = `user-role-${user.id}`;
  const errorId = `${selectId}-error`;

  function submit(event) {
    event.preventDefault();
    save({ role });
  }

  return (
    <form className="user-role-form" noValidate onSubmit={submit}>
      <div className="user-role-field">
        <label className={hideLabel ? 'visually-hidden' : 'field-label'} htmlFor={selectId}>
          Role<span className="visually-hidden"> for {user.name}</span>
        </label>
        <select
          ref={selectRef}
          id={selectId}
          className="field-input"
          value={role}
          disabled={saving}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setRole(event.target.value)}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="button-secondary"
        disabled={saving || role === user.role}
        aria-busy={saving}
        aria-label={`Save role for ${user.name}`}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      {error && (
        <p className="form-error user-control-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// Deactivate or reactivate, with a confirmation step. Focus moves to "Cancel" when the
// question opens (the safe choice) and back to the button when it closes.
export function ActiveControl({ user, onUpdated, autoFocus = false }) {
  const [confirming, setConfirming] = useState(false);
  const { save, saving, error } = useUserUpdate(user, onUpdated);
  const toggleRef = useRef(null);
  const cancelRef = useRef(null);
  const returnFocus = useRef(false);
  const questionId = `user-active-question-${user.id}`;
  useFocusOnMount(toggleRef, autoFocus);
  const deactivate = user.isActive;
  const verb = deactivate ? 'Deactivate' : 'Reactivate';

  // A layout effect, like useFocusOnMount: after a refused save, confirm() closes the question
  // following an await, not a click, so React would run a passive effect only some time after
  // the commit. Focus then sat on <body> while the error was already shown (CD-47).
  useLayoutEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (returnFocus.current) toggleRef.current?.focus();
    returnFocus.current = false;
  }, [confirming]);

  function cancel() {
    returnFocus.current = true;
    setConfirming(false);
  }

  async function confirm() {
    const saved = await save({ isActive: !deactivate });
    // On success the page re-mounts this control; on failure, go back to the button and
    // keep the error next to it.
    if (!saved) cancel();
  }

  const errorBlock = error && (
    <p className="form-error user-control-error" role="alert">
      {error}
    </p>
  );

  if (!confirming) {
    return (
      <div className="user-active-control">
        <button
          type="button"
          ref={toggleRef}
          className="button-secondary"
          aria-label={`${verb} ${user.name}`}
          onClick={() => setConfirming(true)}
        >
          {verb}
        </button>
        {errorBlock}
      </div>
    );
  }

  return (
    <div className="user-active-control user-confirm" role="group" aria-labelledby={questionId}>
      <p className="user-confirm-question" id={questionId}>
        {deactivate
          ? `Deactivate ${user.name}? They are signed out at once and cannot log in until reactivated.`
          : `Reactivate ${user.name}? They can log in again with their password.`}
      </p>
      <div className="user-confirm-actions">
        <button
          type="button"
          className={deactivate ? 'button-danger' : 'button-primary'}
          disabled={saving}
          aria-busy={saving}
          onClick={confirm}
        >
          {saving ? 'Saving...' : `Yes, ${verb.toLowerCase()}`}
        </button>
        <button
          type="button"
          ref={cancelRef}
          className="button-secondary"
          disabled={saving}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
