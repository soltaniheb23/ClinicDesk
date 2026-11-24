import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import LoginPage from '../pages/LoginPage.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';

function LoginButton() {
  const { login } = useAuth();
  return (
    <button type="button" onClick={() => login('test-token', { name: 'Mara' })}>
      Fake login
    </button>
  );
}

function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <LoginButton />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/tickets"
            element={
              <ProtectedRoute>
                <p>Ticket list</p>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <p>Settings page</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ProtectedRoute', () => {
  it('redirects to /login when logged out', () => {
    renderAt('/tickets');

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();
    expect(screen.queryByText('Ticket list')).toBeNull();
  });

  it('renders the child when logged in', () => {
    window.sessionStorage.setItem(
      'clinicdesk.auth',
      JSON.stringify({ token: 'stored-token', user: null }),
    );

    renderAt('/tickets');

    expect(screen.getByText('Ticket list')).toBeTruthy();
  });

  it('returns the user to the remembered page after login', () => {
    renderAt('/settings');
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Fake login' }));

    expect(screen.getByText('Settings page')).toBeTruthy();
    expect(JSON.parse(window.sessionStorage.getItem('clinicdesk.auth')).token).toBe('test-token');
  });
});
