// Ticket list below the tablet breakpoint (CD-36): cards instead of the table.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubViewport } from '../test/helpers.jsx';

const TICKETS = [
  {
    id: 't2',
    title: 'Printer in reception not working',
    status: 'open',
    priority: 'high',
    assignee: null,
    createdAt: '2026-12-01T09:15:00.000Z',
  },
  {
    id: 't1',
    title: 'Account locked',
    status: 'in_progress',
    priority: 'urgent',
    assignee: { id: 'a1', name: 'Lena' },
    createdAt: '2026-11-30T10:00:00.000Z',
  },
];

function stubList() {
  const fetchMock = vi.fn((url) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/v1/tickets') {
      return Promise.resolve(
        jsonResponse(200, { items: TICKETS, page: 1, limit: 10, total: 12, totalPages: 2 }),
      );
    }
    return Promise.resolve(
      jsonResponse(200, { ticket: { ...TICKETS[0], description: 'x', category: 'it' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastListQuery(fetchMock) {
  const urls = fetchMock.mock.calls
    .map(([url]) => new URL(url, 'http://localhost'))
    .filter((url) => url.pathname === '/api/v1/tickets');
  return Object.fromEntries(urls[urls.length - 1].searchParams);
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

describe('ticket list on a phone', () => {
  it('shows one card per ticket instead of the table', async () => {
    stubViewport(360);
    login('customer');
    stubList();
    renderApp('/tickets');

    const list = await screen.findByRole('list', { name: 'Tickets, newest first' });
    expect(screen.queryByRole('table')).toBeNull();

    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);

    const first = within(cards[0]);
    const heading = first.getByRole('heading', { level: 2, name: TICKETS[0].title });
    expect(within(heading).getByRole('link').getAttribute('href')).toBe('/tickets/t2');
    expect(first.getByText('Open').className).toBe('badge badge-status-open');
    expect(first.getByText('High').className).toBe('badge badge-priority-high');

    // Every value has a label, so a screen reader hears "Status Open", "Assignee Unassigned".
    const terms = first.getAllByRole('term').map((term) => term.textContent);
    const values = first.getAllByRole('definition').map((value) => value.textContent);
    expect(terms).toEqual(['Status', 'Priority', 'Assignee', 'Created']);
    expect(values).toEqual(['Open', 'High', 'Unassigned', '01.12.2026']);

    expect(within(cards[1]).getByText('Lena')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  });

  it('offers the sort select to every role, since the sortable headers are gone', async () => {
    stubViewport(360);
    login('customer');
    const fetchMock = stubList();
    renderApp('/tickets?page=2');
    await screen.findByRole('list', { name: 'Tickets, newest first' });

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'priority:desc' } });

    await waitFor(() =>
      expect(lastListQuery(fetchMock)).toMatchObject({
        sort: 'priority',
        order: 'desc',
        page: '1',
      }),
    );
    expect(
      await screen.findByRole('list', { name: 'Tickets, priority: urgent first' }),
    ).toBeTruthy();
  });

  it('keeps the filters in "Back to tickets" from a card', async () => {
    stubViewport(360);
    login('agent');
    stubList();
    renderApp('/tickets?status=open&page=2');

    fireEvent.click(await screen.findByRole('link', { name: TICKETS[0].title }));

    const back = await screen.findByRole('link', { name: 'Back to tickets' });
    expect(back.getAttribute('href')).toBe('/tickets?status=open&page=2');
  });

  it('switches between cards and table when the width crosses the breakpoint', async () => {
    const viewport = stubViewport(1280);
    login('customer');
    stubList();
    renderApp('/tickets');

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByLabelText('Sort by')).toBeNull();

    act(() => viewport.setWidth(600));
    expect(screen.getByRole('list', { name: 'Tickets, newest first' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByLabelText('Sort by')).toBeTruthy();

    act(() => viewport.setWidth(768));
    expect(screen.getByRole('table')).toBeTruthy();
  });
});
