export const NETWORK_ERROR_MESSAGE = 'Could not reach the ClinicDesk API.';
const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export class ApiError extends Error {
  constructor({ status, code, message, details = [] }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readBody(response) {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Creates a small fetch wrapper.
// - getToken: returns the current token (or null); it is sent as "Authorization: Bearer".
// - onUnauthorized: called when a request that carried a token gets a 401 (expired or
//   revoked session). A 401 without a token, such as wrong login details, is just an error.
export function createApiClient({
  baseUrl = import.meta.env.VITE_API_URL || '',
  getToken = () => null,
  onUnauthorized = () => {},
} = {}) {
  async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    const token = getToken();
    const requestHeaders = { Accept: 'application/json', ...headers };

    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    if (token) requestHeaders.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
    }

    const data = await readBody(response);

    if (!response.ok) {
      if (response.status === 401 && token) onUnauthorized();

      const error = data?.error ?? {};
      throw new ApiError({
        status: response.status,
        code: error.code ?? 'HTTP_ERROR',
        message: error.message ?? FALLBACK_ERROR_MESSAGE,
        details: Array.isArray(error.details) ? error.details : [],
      });
    }

    return data;
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}
