import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { loginUser } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { validateLogin } from '../auth/validation.js';
import AuthCard from '../components/AuthCard.jsx';
import FormField from '../components/FormField.jsx';
import { focusFirstInvalid, redirectTarget } from './authRedirect.js';

const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const FIELDS = ['email', 'password'];

function loginErrorMessage(error) {
  if (error.code === 'NETWORK_ERROR') return error.message;
  // The API sends the same message for a wrong password, unknown email or inactive account.
  if (error.status === 401) return error.message || GENERIC_LOGIN_ERROR;
  if (error.status === 400) return GENERIC_LOGIN_ERROR;
  return error.message;
}

function LoginPage() {
  const { token, login } = useAuth();
  const location = useLocation();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Logged-in users (including right after a successful login) go to the remembered page.
  if (token) {
    return <Navigate to={redirectTarget(location)} replace />;
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const errors = validateLogin(values);
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid('login', FIELDS, errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await loginUser({ email: values.email.trim(), password: values.password });
      login(result.token, result.user);
    } catch (error) {
      setFormError(loginErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="ClinicDesk" subtitle="Support for your clinic team">
      <form
        className="form"
        aria-label="Log in"
        aria-describedby={formError ? 'login-form-error' : undefined}
        noValidate
        onSubmit={handleSubmit}
      >
        <FormField
          id="login-email"
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
          id="login-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          value={values.password}
          onChange={handleChange}
          error={fieldErrors.password}
        />
        {formError && (
          <p className="form-error" id="login-form-error" role="alert">
            {formError}
          </p>
        )}
        <button
          type="submit"
          className="button-primary"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? 'Logging in...' : 'Log in'}
        </button>
      </form>
      <p className="auth-footer">
        <Link className="auth-link" to="/register">
          Create account
        </Link>
      </p>
    </AuthCard>
  );
}

export default LoginPage;
