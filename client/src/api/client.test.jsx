import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { ApiError, createApiClient, NETWORK_ERROR_MESSAGE } from './client.js';
import { useApi } from './useApi.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

let fetchMock;

beforeEach(() => {
  window.sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('createApiClient', () => {
  it('sends JSON and the Authorization header when a token exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'abc123' });

    const data = await api.post('/api/v1/tickets', { title: 'Printer' });

    expect(data).toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/tickets');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer abc123');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ title: 'Printer' }));
  });

  it('does not send an Authorization header without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const api = createApiClient({ baseUrl: '' });

    await api.get('/api/v1/hello');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('turns an error response into an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [{ field: 'email', message: 'Enter a valid email address' }],
        },
      }),
    );
    const api = createApiClient({ baseUrl: '' });

    const error = await api.post('/api/v1/auth/login', {}).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Some fields are invalid');
    expect(error.details).toEqual([{ field: 'email', message: 'Enter a valid email address' }]);
  });

  it('calls onUnauthorized on a 401 for a request that carried a token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } }),
    );
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: '', getToken: () => 'old', onUnauthorized });

    await expect(api.get('/api/v1/tickets')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not call onUnauthorized on a 401 without a token (wrong login details)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      }),
    );
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: '', onUnauthorized });

    await expect(api.post('/api/v1/auth/login', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('turns a network failure into a friendly ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const api = createApiClient({ baseUrl: '' });

    await expect(api.get('/api/v1/hello')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'NETWORK_ERROR',
      message: NETWORK_ERROR_MESSAGE,
    });
  });
});

describe('useApi', () => {
  it('logs the user out when a protected call returns 401', async () => {
    window.sessionStorage.setItem(
      'clinicdesk.auth',
      JSON.stringify({ token: 'expired', user: { name: 'Mara' } }),
    );
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } }),
    );

    const { result } = renderHook(() => ({ api: useApi(), auth: useAuth() }), {
      wrapper: AuthProvider,
    });
    expect(result.current.auth.token).toBe('expired');

    await act(async () => {
      await result.current.api.get('/api/v1/tickets').catch(() => {});
    });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer expired');
    expect(result.current.auth.token).toBeNull();
    expect(window.sessionStorage.getItem('clinicdesk.auth')).toBeNull();
  });
});
