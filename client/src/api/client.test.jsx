import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, NETWORK_ERROR_MESSAGE } from './client.js';

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

describe('createApiClient: attachments (CD-18)', () => {
  it('sends FormData as is, without a JSON Content-Type, with the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { items: [] }));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'abc123' });
    const form = new FormData();
    form.append('files', new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' }));

    await api.post('/api/v1/tickets/t1/attachments', form);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.headers.Authorization).toBe('Bearer abc123');
  });

  it('returns a Blob for responseType "blob" and reads errors as the uniform shape', async () => {
    const blob = new Blob(['bytes'], { type: 'application/pdf' });
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, blob: () => Promise.resolve(blob) })
      .mockResolvedValueOnce(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Attachment not found' } }),
      );
    const api = createApiClient({ baseUrl: '', getToken: () => 'abc123' });

    await expect(api.get('/file', { responseType: 'blob' })).resolves.toBe(blob);
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('*/*');
    await expect(api.get('/file', { responseType: 'blob' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Attachment not found',
    });
  });
});
