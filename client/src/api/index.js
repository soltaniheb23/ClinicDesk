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

const TICKET_LIST_PARAMS = [
  'status',
  'priority',
  'category',
  'assignee',
  'sla',
  'q',
  'sort',
  'order',
];

// Returns { items, page, limit, total, totalPages }. Customers get their own tickets;
// agents and admins get all. Optional filters (docs/ticket-list.md): status, priority,
// category, assignee and sla (staff only), q (title search), sort and order; empty values are not
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

// Attachments (CD-18, docs/attachments.md). Same access as the ticket.

const attachmentsPath = (ticketId) => `/api/v1/tickets/${encodeURIComponent(ticketId)}/attachments`;

// Returns { items: [{ id, name, type, size, createdAt, uploadedBy }] }, oldest first.
export function getAttachments(ticketId, { signal } = {}) {
  return api.get(attachmentsPath(ticketId), { signal });
}

// Returns { items } with the new attachments. `files` is an array of File objects, sent as
// multipart/form-data in the field "files". The server decides the type from the content.
export function uploadAttachments(ticketId, files) {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return api.post(attachmentsPath(ticketId), form);
}

// Resolves with the file as a Blob. The token is in memory, so a plain link cannot carry it:
// the download goes through the API client with the Authorization header.
export function downloadAttachment(ticketId, attachmentId) {
  return api.get(`${attachmentsPath(ticketId)}/${encodeURIComponent(attachmentId)}`, {
    responseType: 'blob',
  });
}

// Resolves with null (204). Uploader or admin only.
export function deleteAttachment(ticketId, attachmentId) {
  return api.delete(`${attachmentsPath(ticketId)}/${encodeURIComponent(attachmentId)}`);
}

// Admin user management (docs/user-management.md). All three are admin only.

const USER_LIST_PARAMS = ['role', 'isActive', 'q'];

// Returns { items, page, limit, total, totalPages }; items are { id, name, email, role,
// isActive, createdAt }, sorted by name. Optional filters: role, isActive (true or false)
// and q (name or email); empty values are not sent.
export function getUsers({ page = 1, limit = 10, signal, ...filters } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const key of USER_LIST_PARAMS) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return api.get(`/api/v1/users?${query}`, { signal });
}

// Returns { user }. A 409 EMAIL_TAKEN ApiError when the email is already used.
export function createUser({ name, email, password, role }) {
  return api.post('/api/v1/users', { name, email, password, role });
}

// Returns { user }. `changes` holds role and/or isActive. 409 CANNOT_CHANGE_SELF or
// LAST_ADMIN when a safeguard refuses the change.
export function updateUser(id, changes) {
  return api.patch(`/api/v1/users/${encodeURIComponent(id)}`, changes);
}

const AUDIT_LOG_PARAMS = ['action', 'actor', 'entityType', 'from', 'to'];

// Returns { items, page, limit, total, totalPages }, newest first (admin only,
// docs/audit-log.md). `from` and `to` are ISO date-times; empty values are not sent.
export function getAuditLogs({ page = 1, limit = 20, signal, ...filters } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const key of AUDIT_LOG_PARAMS) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return api.get(`/api/v1/audit-logs?${query}`, { signal });
}
