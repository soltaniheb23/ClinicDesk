import { getSessionToken, saveSession, EMPTY_SESSION } from '../auth/session.js';
import { createApiClient } from './client.js';

// Until AuthProvider registers logout(), a 401 still clears the stored session.
const clearSession = () => saveSession(EMPTY_SESSION);
let unauthorizedHandler = clearSession;

// Called by AuthProvider; returns a cleanup that restores the default handler.
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = clearSession;
  };
}

// The one API client the app uses: it sends the current session token and logs out on a
// 401 for a call that carried that token.
export const api = createApiClient({
  getToken: getSessionToken,
  onUnauthorized: () => unauthorizedHandler(),
});

// Both endpoints return { user, token }.
export function registerUser({ name, email, password }) {
  return api.post('/api/v1/auth/register', { name, email, password });
}

export function loginUser({ email, password }) {
  return api.post('/api/v1/auth/login', { email, password });
}

// Returns { ticket }. The server sets createdBy, status and assignee.
export function createTicket({ title, description, category, priority }) {
  return api.post('/api/v1/tickets', { title, description, category, priority });
}

// Returns { items }: the logged-in user's tickets, newest first (at most 50).
export function getMyTickets({ signal } = {}) {
  return api.get('/api/v1/tickets/mine', { signal });
}
