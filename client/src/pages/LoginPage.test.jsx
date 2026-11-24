import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  jsonResponse,
  renderApp,
  storedSession,
  storeSession,
  stubFetch,
} from '../test/helpers.jsx';

const user = { id: 'u1', name: 'Mara Jensen', email: 'mara@example.com', role: 'customer' };

function fillAndSubmit(email, password) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('renders labelled fields, a submit button and a register link', () => {
    renderApp('/login');

    expect(screen.getByRole('heading', { name: 'ClinicDesk' })).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Log in' }).getAttribute('type')).toBe('submit');
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe(
      '/register',
    );
  });

  it('stores the auth state and redirects to /tickets on success', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { token: 'jwt-token', user }));
    renderApp('/login');

    fillAndSubmit(' mara@example.com ', 'a-long-password');

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/tickets');
    expect(storedSession()).toEqual({ token: 'jwt-token', user });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'mara@example.com',
      password: 'a-long-password',
    });
  });

  it('returns to the page remembered by ProtectedRoute', async () => {
    stubFetch(jsonResponse(200, { token: 'jwt-token', user }));
    renderApp({ pathname: '/login', state: { from: { pathname: '/health-check' } } });

    fillAndSubmit('mara@example.com', 'a-long-password');

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/health-check');
    });
  });

  it('shows the generic message on a failed login and stores no token', async () => {
    stubFetch(
      jsonResponse(401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      }),
    );
    renderApp('/login');

    fillAndSubmit('mara@example.com', 'wrong-password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Invalid email or password');
    expect(screen.getByRole('form', { name: 'Log in' }).getAttribute('aria-describedby')).toBe(
      alert.id,
    );
    expect(window.sessionStorage.getItem('clinicdesk.auth')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/login');
    expect(screen.getByRole('button', { name: 'Log in' }).disabled).toBe(false);
  });

  it('shows a friendly message on a network error', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    renderApp('/login');

    fillAndSubmit('mara@example.com', 'a-long-password');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not reach the ClinicDesk API.',
    );
  });

  it('blocks an invalid email on the client and links the error to the field', () => {
    const fetchMock = stubFetch();
    renderApp('/login');

    fillAndSubmit('not-an-email', 'a-long-password');

    const emailInput = screen.getByLabelText('Email');
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Enter a valid email address');
    expect(emailInput.getAttribute('aria-invalid')).toBe('true');
    expect(emailInput.getAttribute('aria-describedby')).toBe(error.id);
    expect(document.activeElement).toBe(emailInput);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a password', () => {
    const fetchMock = stubFetch();
    renderApp('/login');

    fillAndSubmit('mara@example.com', '');

    expect(screen.getByRole('alert').textContent).toBe('Enter your password');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables the button and shows progress while logging in', async () => {
    let resolve;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((done) => (resolve = done))),
    );
    renderApp('/login');

    fillAndSubmit('mara@example.com', 'a-long-password');

    const button = screen.getByRole('button', { name: 'Logging in...' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    resolve(jsonResponse(200, { token: 'jwt-token', user }));
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeTruthy();
  });

  it('submits with the keyboard (Enter in a field submits the form)', async () => {
    stubFetch(jsonResponse(200, { token: 'jwt-token', user }));
    renderApp('/login');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mara@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw-123456' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeTruthy();
  });

  it('redirects a logged-in user away from /login', () => {
    storeSession('jwt-token', user);
    renderApp('/login');

    expect(screen.getByTestId('location').textContent).toBe('/tickets');
    expect(screen.queryByRole('form', { name: 'Log in' })).toBeNull();
  });
});
