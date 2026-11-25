import { cleanup, fireEvent, screen, within } from '@testing-library/react';
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

  it('shows the "Users" link to admins and opens the user list', async () => {
    storeSession('jwt-token', { id: 'ad1', name: 'Anton Admin', role: 'admin' });
    renderApp('/tickets');

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    const link = within(nav).getByRole('link', { name: 'Users' });
    expect(link.getAttribute('href')).toBe('/admin/users');
    expect(link.getAttribute('aria-current')).toBeNull();

    fireEvent.click(link);

    expect(screen.getByTestId('location').textContent).toBe('/admin/users');
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBe('page');
  });

  it.each(['customer', 'agent'])('hides the "Users" link from a %s', (role) => {
    storeSession('jwt-token', { id: 'u1', name: 'Mara Jensen', role });
    renderApp('/tickets');

    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull();
  });

  it.each(['customer', 'agent'])('sends a %s who opens /admin/users to /tickets', (role) => {
    storeSession('jwt-token', { id: 'u1', name: 'Mara Jensen', role });
    renderApp('/admin/users');

    expect(screen.getByTestId('location').textContent).toBe('/tickets');
    expect(screen.queryByRole('heading', { name: 'Users' })).toBeNull();
  });
});
