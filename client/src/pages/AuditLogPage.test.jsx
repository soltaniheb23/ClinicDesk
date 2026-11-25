// Audit log page (CD-20).
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAuditTime } from '../audit/entries.js';
import { auditApiParams } from '../audit/listParams.js';
import { jsonResponse, renderApp, storeSession, stubViewport } from '../test/helpers.jsx';

const ADMIN = { id: 'ad1', name: 'Anton Admin' };
const TICKET_ID = '6651b2a7c3d4e5f6a7b8c9d1';

const ENTRIES = [
  {
    id: 'e5',
    actor: null,
    action: 'auth.login_failed',
    entityType: 'user',
    entityId: null,
    entityLabel: null,
    metadata: { email: 'mara@example.com' },
    createdAt: '2026-11-25T10:05:00.000Z',
  },
  {
    id: 'e4',
    actor: ADMIN,
    action: 'ticket.status_changed',
    entityType: 'ticket',
    entityId: TICKET_ID,
    entityLabel: 'Printer in reception not working',
    metadata: { from: 'open', to: 'in_progress' },
    createdAt: '2026-11-25T10:04:00.000Z',
  },
  {
    id: 'e3',
    actor: ADMIN,
    action: 'ticket.assignee_changed',
    entityType: 'ticket',
    entityId: TICKET_ID,
    entityLabel: 'Printer in reception not working',
    metadata: { from: null, to: { id: 'a1', name: 'Lena Berg' } },
    createdAt: '2026-11-25T10:03:00.000Z',
  },
  {
    id: 'e2',
    actor: ADMIN,
    action: 'user.role_changed',
    entityType: 'user',
    entityId: 'u2',
    entityLabel: 'Lena Berg',
    metadata: { from: 'customer', to: 'agent' },
    createdAt: '2026-11-25T10:02:00.000Z',
  },
  {
    id: 'e1',
    actor: { id: 'gone', name: 'Old Admin' },
    action: 'user.active_changed',
    entityType: 'user',
    entityId: 'u3',
    entityLabel: null,
    metadata: { from: true, to: false },
    createdAt: '2026-11-25T10:01:00.000Z',
  },
];

function pageBody({ items = ENTRIES, page = 1, total = items.length, totalPages = 1 } = {}) {
  return { items, page, limit: 20, total, totalPages };
}

const EMPTY = pageBody({ items: [], total: 0, totalPages: 0 });

// Answers GET /api/v1/audit-logs with respond(searchParams); returns the fetch mock.
function stubAudit(respond = () => jsonResponse(200, pageBody())) {
  const fetchMock = vi.fn((url) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/v1/audit-logs') {
      const response = respond(parsed.searchParams);
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }
    return Promise.resolve(jsonResponse(200, { items: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function auditQueries(fetchMock) {
  return fetchMock.mock.calls
    .map(([url]) => new URL(url, 'http://localhost'))
    .filter((url) => url.pathname === '/api/v1/audit-logs')
    .map((url) => Object.fromEntries(url.searchParams));
}

function urlSearch() {
  return screen.getByTestId('location').dataset.search;
}

function login(role) {
  storeSession('jwt-token', { id: `${role}-1`, name: 'Test User', role });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('access', () => {
  it('shows the "Audit log" link to admins and opens the page', async () => {
    login('admin');
    stubAudit();
    renderApp('/tickets');

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Audit log' }));

    expect(screen.getByTestId('location').textContent).toBe('/audit-log');
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit log' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Audit log' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it.each(['customer', 'agent'])('hides the link from a %s and redirects them', (role) => {
    login(role);
    const fetchMock = stubAudit();
    renderApp('/audit-log');

    expect(screen.getByTestId('location').textContent).toBe('/tickets');
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
    expect(auditQueries(fetchMock)).toEqual([]);
  });

  it('sends a logged-out visitor to /login', () => {
    stubAudit();
    renderApp('/audit-log');

    expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy();
  });
});

describe('entries', () => {
  it('shows loading, then a table of entries newest first', async () => {
    login('admin');
    const fetchMock = stubAudit();
    renderApp('/audit-log');

    expect(screen.getByText('Loading audit log...')).toBeTruthy();
    const table = await screen.findByRole('table');

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Time', 'Who', 'Action', 'Target', 'Details']);
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(1)
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ['Not logged in', 'Failed login', 'None', 'Email: mara@example.com'],
      [
        'Anton Admin',
        'Ticket status changed',
        'Printer in reception not working',
        'Open → In progress',
      ],
      [
        'Anton Admin',
        'Ticket assignment changed',
        'Printer in reception not working',
        'Unassigned → Lena Berg',
      ],
      ['Anton Admin', 'User role changed', 'Lena Berg', 'Customer → Agent'],
      ['Old Admin', 'User access changed', 'Deleted user', 'Active → Deactivated'],
    ]);
    expect(screen.getByText('5 entries')).toBeTruthy();
    expect(auditQueries(fetchMock)).toEqual([{ page: '1', limit: '20' }]);
  });

  it('shows the time in the local format with a machine-readable datetime', async () => {
    login('admin');
    stubAudit();
    renderApp('/audit-log');
    await screen.findByRole('table');

    const time = screen.getByText(formatAuditTime(ENTRIES[0].createdAt));
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe(ENTRIES[0].createdAt);
    expect(time.textContent).toBe(
      new Date(ENTRIES[0].createdAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    );
  });

  it('links ticket targets to the ticket', async () => {
    login('admin');
    stubAudit();
    renderApp('/audit-log');
    await screen.findByRole('table');

    const links = screen.getAllByRole('link', { name: 'Printer in reception not working' });
    expect(links[0].getAttribute('href')).toBe(`/tickets/${TICKET_ID}`);
  });

  it('shows cards on narrow screens and the table from the tablet breakpoint', async () => {
    login('admin');
    const viewport = stubViewport(360);
    stubAudit();
    renderApp('/audit-log');

    const list = await screen.findByRole('list', { name: 'Audit log, newest first' });
    expect(screen.queryByRole('table')).toBeNull();
    const first = within(within(list).getAllByRole('listitem')[0]);
    expect(first.getByRole('heading', { level: 2, name: 'Failed login' })).toBeTruthy();
    expect(first.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Time',
      'Who',
      'Target',
      'Details',
    ]);

    act(() => viewport.setWidth(768));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows an empty state when nothing has been recorded', async () => {
    login('admin');
    stubAudit(() => jsonResponse(200, EMPTY));
    renderApp('/audit-log');

    expect(await screen.findByRole('region', { name: 'No audit entries yet' })).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    login('admin');
    let calls = 0;
    stubAudit(() => {
      calls += 1;
      return calls === 1 ? new TypeError('Failed to fetch') : jsonResponse(200, pageBody());
    });
    renderApp('/audit-log');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('shows the server message when the API refuses', async () => {
    login('admin');
    stubAudit(() =>
      jsonResponse(403, {
        error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
      }),
    );
    renderApp('/audit-log');

    expect((await screen.findByRole('alert')).textContent).toContain(
      'You do not have permission to do this',
    );
  });

  it('pages through the entries', async () => {
    login('admin');
    const fetchMock = stubAudit((params) =>
      jsonResponse(200, pageBody({ page: Number(params.get('page')), total: 45, totalPages: 3 })),
    );
    renderApp('/audit-log');
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(auditQueries(fetchMock).at(-1).page).toBe('2'));
    expect(urlSearch()).toBe('?page=2');
  });
});

describe('filters', () => {
  it('puts the action and the date range in the URL and sends whole local days', async () => {
    login('admin');
    const fetchMock = stubAudit();
    renderApp('/audit-log?page=2');
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'auth.login_failed' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-25' } });

    expect(urlSearch()).toBe('?action=auth.login_failed&from=2026-11-20&to=2026-11-25');
    await waitFor(() =>
      expect(auditQueries(fetchMock).at(-1)).toEqual({
        page: '1',
        limit: '20',
        action: 'auth.login_failed',
        from: new Date(2026, 10, 20, 0, 0, 0, 0).toISOString(),
        to: new Date(2026, 10, 25, 23, 59, 59, 999).toISOString(),
      }),
    );
  });

  it('reads the filters from the URL and ignores invalid values', async () => {
    login('admin');
    const fetchMock = stubAudit();
    renderApp('/audit-log?action=ticket.deleted&from=2026-02-30&to=2026-11-25');
    await screen.findByRole('table');

    expect(screen.getByLabelText('Action').value).toBe('');
    expect(screen.getByLabelText('From').value).toBe('');
    expect(screen.getByLabelText('To').value).toBe('2026-11-25');
    expect(auditQueries(fetchMock)).toEqual([
      { page: '1', limit: '20', to: new Date(2026, 10, 25, 23, 59, 59, 999).toISOString() },
    ]);
  });

  it('does not send a reversed date range and says why', async () => {
    login('admin');
    const fetchMock = stubAudit();
    renderApp('/audit-log?from=2026-11-25&to=2026-11-20');

    const to = screen.getByLabelText('To');
    expect(to.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(
      'The end date must be on or after the start date',
    );
    expect(auditQueries(fetchMock)).toEqual([]);
    expect(screen.queryByText('Loading audit log...')).toBeNull();
  });

  it('shows a no-match state with a button that clears the filters', async () => {
    login('admin');
    const fetchMock = stubAudit((params) =>
      jsonResponse(200, params.has('action') ? EMPTY : pageBody()),
    );
    renderApp('/audit-log?action=user.created&from=2026-11-01');

    const empty = await screen.findByRole('region', { name: 'No entries match your filters' });
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(urlSearch()).toBe('');
    expect(auditQueries(fetchMock).at(-1)).toEqual({ page: '1', limit: '20' });
  });
});

describe('auditApiParams', () => {
  it('leaves out empty filters', () => {
    expect(auditApiParams({ action: '', from: '', to: '' })).toEqual({});
  });
});
