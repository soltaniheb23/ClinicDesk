import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { jsonResponse, storeSession, STORAGE_KEY, stubFetch } from '../test/helpers.jsx';
import { api, loginUser, registerUser } from './index.js';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

describe('shared API client', () => {
  it('sends the current session token after login', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { tickets: [] }));
    const { result } = renderAuth();

    act(() => result.current.login('fresh-token', { name: 'Mara' }));
    await api.get('/api/v1/tickets');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  it('logs the user out when a protected call returns 401', async () => {
    storeSession('expired', { name: 'Mara' });
    const fetchMock = stubFetch(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } }),
    );
    const { result } = renderAuth();
    expect(result.current.token).toBe('expired');

    await act(async () => {
      await api.get('/api/v1/tickets').catch(() => {});
    });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer expired');
    expect(result.current.token).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('registerUser and loginUser call the auth endpoints', async () => {
    const response = { user: { name: 'Mara' }, token: 't' };
    const fetchMock = stubFetch(jsonResponse(201, response), jsonResponse(200, response));
    renderAuth();

    await registerUser({ name: 'Mara', email: 'mara@example.com', password: 'a-long-password' });
    await loginUser({ email: 'mara@example.com', password: 'a-long-password' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/register');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'Mara',
      email: 'mara@example.com',
      password: 'a-long-password',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/login');
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
  });
});
