import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { registerUser } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PASSWORD_MIN_LENGTH, validateRegister } from '../auth/validation.js';
import AuthCard from '../components/AuthCard.jsx';
import FormField from '../components/FormField.jsx';
import { focusFirstInvalid } from './authRedirect.js';

const FIELDS = ['name', 'email', 'password', 'confirmPassword'];
const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists. Try logging in instead.';

// Maps an API error to per-field errors (details[].field) and a form-level message.
function registerErrors(error) {
  if (error.code === 'EMAIL_TAKEN') {
    return { fieldErrors: { email: EMAIL_TAKEN_MESSAGE }, formError: '' };
  }

  const fieldErrors = {};
  for (const detail of error.details ?? []) {
    if (FIELDS.includes(detail.field) && !fieldErrors[detail.field]) {
      fieldErrors[detail.field] = detail.message;
    }
  }

  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  return { fieldErrors, formError: hasFieldErrors ? '' : error.message };
}

function RegisterPage() {
  const { token, login } = useAuth();
  const [values, setValues] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Logged-in users (including right after registering) go to the ticket list.
  if (token) {
    return <Navigate to="/tickets" replace />;
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const errors = validateRegister(values);
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid('register', FIELDS, errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await registerUser({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      login(result.token, result.user);
    } catch (error) {
      const mapped = registerErrors(error);
      setFieldErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setSubmitting(false);
      focusFirstInvalid('register', FIELDS, mapped.fieldErrors);
    }
  }

  return (
    <AuthCard title="Create account" subtitle="Get support from your clinic team">
      <form
        className="form"
        aria-label="Create account"
        aria-describedby={formError ? 'register-form-error' : undefined}
        noValidate
        onSubmit={handleSubmit}
      >
        <FormField
          id="register-name"
          name="name"
          label="Name"
          autoComplete="name"
          required
          value={values.name}
          onChange={handleChange}
          error={fieldErrors.name}
        />
        <FormField
          id="register-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          value={values.email}
          onChange={handleChange}
          error={fieldErrors.email}
        />
        <FormField
          id="register-password"
          name="password"
          type="password"
          label="Password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          autoComplete="new-password"
          required
          value={values.password}
          onChange={handleChange}
          error={fieldErrors.password}
        />
        <FormField
          id="register-confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          required
          value={values.confirmPassword}
          onChange={handleChange}
          error={fieldErrors.confirmPassword}
        />
        {formError && (
          <p className="form-error" id="register-form-error" role="alert">
            {formError}
          </p>
        )}
        <button
          type="submit"
          className="button-primary"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <p className="auth-footer">
        Already have an account?{' '}
        <Link className="auth-link" to="/login">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}

export default RegisterPage;
