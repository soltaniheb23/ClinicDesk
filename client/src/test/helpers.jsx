/* eslint-disable react-refresh/only-export-components */
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import AppRoutes from '../router.jsx';

export const STORAGE_KEY = 'clinicdesk.auth';

export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

export function storeSession(token, user) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
}

export function storedSession() {
  return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
}

// Answers fetch calls with `responses` in order, then with an empty ticket list (the page
// most tests land on after logging in).
export function stubFetch(...responses) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [] }));
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

// Renders the real routes at `entry` (a path or { pathname, state }).
export function renderApp(entry = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </AuthProvider>,
  );
}
