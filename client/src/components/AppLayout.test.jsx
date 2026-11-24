import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

beforeEach(() => {
  window.sessionStorage.clear();
  stubFetch(); // The tickets page loads the user's tickets.
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppLayout', () => {
  it('shows the app name, user name and role', () => {
    storeSession('jwt-token', { name: 'Mara Jensen', role: 'agent' });
    renderApp('/tickets');

    expect(screen.getByRole('link', { name: 'ClinicDesk' })).toBeTruthy();
    expect(screen.getByText('Mara Jensen')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('logout clears the auth state and returns to /login', () => {
    storeSession('jwt-token', { name: 'Mara Jensen', role: 'customer' });
    renderApp('/tickets');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(screen.getByTestId('location').textContent).toBe('/login');
    expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy();
    expect(window.sessionStorage.getItem('clinicdesk.auth')).toBeNull();
    expect(screen.queryByText('Mara Jensen')).toBeNull();
  });
});
