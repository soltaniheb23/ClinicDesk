/* eslint-disable react-refresh/only-export-components */
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { MEDIA } from '../layout/breakpoints.js';
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

// Answers fetch by "METHOD /path" (for example 'PATCH /api/v1/tickets/1/status'), so a
// test does not depend on the order in which a page's components send their requests.
// A route takes a response, an Error (network failure), a function returning a promise, or
// an array of those used in order (the last one repeats). Requests without a route get
// 200 { items: [] }.
export function stubApi(routes = {}) {
  const queues = new Map(
    Object.entries(routes).map(([route, value]) => [
      route,
      Array.isArray(value) ? [...value] : [value],
    ]),
  );
  const fetchMock = vi.fn((url, init = {}) => {
    const queue = queues.get(`${init.method ?? 'GET'} ${url}`);
    if (!queue) return Promise.resolve(jsonResponse(200, { items: [] }));
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === 'function') return next();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// The requests a stubApi/stubFetch mock received for one "METHOD /path", with parsed bodies.
export function requestsTo(fetchMock, route) {
  return fetchMock.mock.calls
    .filter(([url, init = {}]) => `${init.method ?? 'GET'} ${url}` === route)
    .map(([url, init = {}]) => ({
      url,
      init,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    }));
}

// A controllable matchMedia: `setWidth` answers the min-width queries from breakpoints.js
// and notifies listeners, like a browser does on resize or zoom.
export function stubViewport(initialWidth) {
  let width = initialWidth;
  const lists = new Map();
  const minWidthPx = { [MEDIA.tablet]: 640, [MEDIA.desktop]: 1024 };

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => {
      if (!lists.has(query)) {
        const listeners = new Set();
        lists.set(query, {
          listeners,
          list: {
            get matches() {
              return width >= minWidthPx[query];
            },
            media: query,
            addEventListener: (_type, listener) => listeners.add(listener),
            removeEventListener: (_type, listener) => listeners.delete(listener),
          },
        });
      }
      return lists.get(query).list;
    }),
  );

  return {
    setWidth(next) {
      width = next;
      for (const { listeners } of lists.values()) listeners.forEach((listener) => listener());
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location" data-search={location.search}>
      {location.pathname}
    </div>
  );
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
