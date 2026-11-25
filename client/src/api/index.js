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

const TICKET_LIST_PARAMS = ['status', 'priority', 'category', 'assignee', 'q', 'sort', 'order'];

// Returns { items, page, limit, total, totalPages }. Customers get their own tickets;
// agents and admins get all. Optional filters (docs/ticket-list.md): status, priority,
// category, assignee (staff only), q (title search), sort and order; empty values are not
// sent. Pass `signal` so a newer request can abort this one.
export function getTickets({ page = 1, limit = 10, signal, ...filters } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const key of TICKET_LIST_PARAMS) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return api.get(`/api/v1/tickets?${query}`, { signal });
}

// Returns { ticket }; a 404 ApiError for unknown, invalid or foreign ids.
export function getTicket(id, { signal } = {}) {
  return api.get(`/api/v1/tickets/${encodeURIComponent(id)}`, { signal });
}

// Returns { ticket } with the new status and allowedNextStatuses.
export function updateTicketStatus(id, status) {
  return api.patch(`/api/v1/tickets/${encodeURIComponent(id)}/status`, { status });
}

// Returns { ticket }. `assignee` is a user id, or null to unassign. Agents may only pass
// their own id (claim) or null for a ticket assigned to them (release).
export function updateTicketAssignee(id, assignee) {
  return api.patch(`/api/v1/tickets/${encodeURIComponent(id)}/assignee`, { assignee });
}

// Returns { items: [{ id, name }] }: active agents and admins (agent and admin only).
export function getAgents({ signal } = {}) {
  return api.get('/api/v1/users/agents', { signal });
}

// Returns { items }, oldest first. Customers never receive internal notes.
export function getComments(ticketId, { signal } = {}) {
  return api.get(`/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`, { signal });
}

// Returns { comment }. `internal` is only allowed for agents and admins.
export function addComment(ticketId, { body, internal = false }) {
  return api.post(`/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`, { body, internal });
}
