import { useEffect, useRef, useState } from 'react';
import { createUser } from '../api/index.js';
import { NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewUser } from '../auth/validation.js';
import FormField from '../components/FormField.jsx';
import { focusFirstInvalid } from '../pages/authRedirect.js';
import { ROLE_OPTIONS, ROLES } from './listParams.js';

const FIELDS = ['name', 'email', 'password', 'role'];
const EMPTY = { name: '', email: '', password: '', role: 'customer' };

// Maps an API error to field errors (details[].field) and a form-level message (for
// example EMAIL_TAKEN), which is shown in a role="alert" box.
function serverErrors(error) {
  const fieldErrors = {};
  for (const detail of error.details ?? []) {
    if (FIELDS.includes(detail.field) && !fieldErrors[detail.field]) {
      fieldErrors[detail.field] = detail.message;
    }
  }
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  return { fieldErrors, formError: hasFieldErrors ? '' : error.message };
}

// "Create user" panel. The new account is active at once and logs in with the temporary
// password; nothing is sent by email.
function CreateUserForm({ id, onCreated, onCancel }) {
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef(null);

  // Opening the panel moves focus to its first field.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const errors = validateNewUser(values, ROLES);
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid('new-user', FIELDS, errors);
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await createUser({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
        role: values.role,
      });
      onCreated(user);
    } catch (error) {
      const mapped = serverErrors(error);
      setFieldErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setSubmitting(false);
      focusFirstInvalid('new-user', FIELDS, mapped.fieldErrors);
    }
  }

  return (
    <section className="user-create" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="user-create-title" id={`${id}-title`}>
        Create user
      </h2>
      <form
        className="form"
        aria-label="Create user"
        aria-describedby={formError ? 'new-user-form-error' : undefined}
        noValidate
        onSubmit={handleSubmit}
      >
        <div className="field-row">
          <FormField
            id="new-user-name"
            ref={nameRef}
            name="name"
            label="Name"
            autoComplete="off"
            required
            maxLength={NAME_MAX_LENGTH}
            value={values.name}
            onChange={handleChange}
            error={fieldErrors.name}
          />
          <FormField
            id="new-user-email"
            name="email"
            type="email"
            label="Email"
            autoComplete="off"
            required
            value={values.email}
            onChange={handleChange}
            error={fieldErrors.email}
          />
        </div>
        <div className="field-row">
          <FormField
            id="new-user-password"
            name="password"
            type="password"
            label="Temporary password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Give it to the person directly, not by email.`}
            autoComplete="new-password"
            required
            value={values.password}
            onChange={handleChange}
            error={fieldErrors.password}
          />
          <FormField
            id="new-user-role"
            name="role"
            as="select"
            label="Role"
            value={values.role}
            onChange={handleChange}
            error={fieldErrors.role}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormField>
        </div>
        {formError && (
          <p className="form-error" id="new-user-form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            className="button-primary"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? 'Creating...' : 'Create user'}
          </button>
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

export default CreateUserForm;
