import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  jsonResponse,
  renderApp,
  storedSession,
  storeSession,
  stubFetch,
} from '../test/helpers.jsx';

const user = { id: 'u1', name: 'Mara Jensen', email: 'mara@example.com', role: 'customer' };

function fillForm({
  name = 'Mara Jensen',
  email = 'mara@example.com',
  password = 'a-long-password',
  confirmPassword = password,
} = {}) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: confirmPassword },
  });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RegisterPage', () => {
  it('shows the password rule next to the field', () => {
    renderApp('/register');

    const password = screen.getByLabelText('Password');
    const hint = screen.getByText('At least 8 characters');
    expect(password.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('logs the user in and redirects to /tickets on success', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { user, token: 'jwt-token' }));
    renderApp('/register');

    fillForm();
    submit();

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/tickets');
    expect(storedSession()).toEqual({ token: 'jwt-token', user });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'Mara Jensen',
      email: 'mara@example.com',
      password: 'a-long-password',
    });
  });

  it('shows backend validation details next to each field', async () => {
    stubFetch(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [
            { field: 'name', message: 'Name must be at most 80 characters' },
            { field: 'email', message: 'Email is too long' },
          ],
        },
      }),
    );
    renderApp('/register');

    fillForm();
    submit();

    const nameError = await screen.findByText('Name must be at most 80 characters');
    expect(nameError.getAttribute('role')).toBe('alert');
    expect(screen.getByLabelText('Name').getAttribute('aria-describedby')).toBe(nameError.id);
    const emailError = screen.getByText('Email is too long');
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe(emailError.id);
    expect(window.sessionStorage.getItem('clinicdesk.auth')).toBeNull();
  });

  it('shows a clear message when the email is already taken', async () => {
    stubFetch(
      jsonResponse(409, {
        error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' },
      }),
    );
    renderApp('/register');

    fillForm();
    submit();

    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe(
      'An account with this email already exists. Try logging in instead.',
    );
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe(error.id);
    expect(screen.getByTestId('location').textContent).toBe('/register');
  });

  it('validates password length and confirmation on the client', () => {
    const fetchMock = stubFetch();
    renderApp('/register');

    fillForm({ password: 'short', confirmPassword: 'different' });
    submit();

    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(screen.getByText('Passwords do not match')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects a logged-in user away from /register', () => {
    storeSession('jwt-token', user);
    renderApp('/register');

    expect(screen.getByTestId('location').textContent).toBe('/tickets');
  });
});
