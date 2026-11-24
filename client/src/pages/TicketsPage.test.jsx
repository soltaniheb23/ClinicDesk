import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

const tickets = [
  {
    id: 't3',
    title: 'Printer in reception not working',
    status: 'open',
    priority: 'high',
    assignee: null,
    createdAt: '2026-12-01T09:15:00.000Z',
  },
  {
    id: 't2',
    title: 'Account locked',
    status: 'in_progress',
    priority: 'urgent',
    assignee: { id: 'a1', name: 'Lena' },
    createdAt: '2026-11-30T10:00:00.000Z',
  },
  {
    id: 't1',
    title: 'Room booking missing',
    status: 'waiting',
    priority: 'normal',
    assignee: { id: 'a1', name: 'Lena' },
    createdAt: '2026-11-29T10:00:00.000Z',
  },
];

function pageResponse({ items = tickets, page = 1, total = 23, totalPages = 3 } = {}) {
  return jsonResponse(200, { items, page, limit: 10, total, totalPages });
}

function requestedUrl(fetchMock, call) {
  return new URL(fetchMock.mock.calls[call][0], 'http://localhost');
}

beforeEach(() => {
  window.sessionStorage.clear();
  storeSession('jwt-token', { id: 'u1', name: 'Mara Jensen', role: 'customer' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TicketsPage', () => {
  it('renders rows with title links, badges, assignee and dd.mm.yyyy dates', async () => {
    const fetchMock = stubFetch(pageResponse());
    renderApp('/tickets');

    expect(screen.getByRole('status').textContent).toContain('Loading tickets...');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);

    const first = within(rows[0]);
    expect(first.getByRole('link', { name: tickets[0].title }).getAttribute('href')).toBe(
      '/tickets/t3',
    );
    expect(first.getByText('Open').className).toBe('badge badge-status-open');
    expect(first.getByText('High').className).toBe('badge badge-priority-high');
    expect(first.getByText('Unassigned')).toBeTruthy();
    expect(first.getByText('01.12.2026')).toBeTruthy();

    const second = within(rows[1]);
    expect(second.getByText('In progress').className).toBe('badge badge-status-in_progress');
    expect(second.getByText('Urgent').className).toBe('badge badge-priority-urgent');
    expect(second.getByText('Lena')).toBeTruthy();
    expect(second.getByText('30.11.2026')).toBeTruthy();

    expect(within(rows[2]).getByText('Waiting')).toBeTruthy();

    const url = requestedUrl(fetchMock, 0);
    expect(url.pathname).toBe('/api/v1/tickets');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('disables Previous on the first page and loads page 2 with Next', async () => {
    const fetchMock = stubFetch(pageResponse(), pageResponse({ page: 2 }));
    renderApp('/tickets');

    await screen.findByRole('table');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getByText('Page 1 of 3')).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Previous' }).disabled).toBe(true);
    expect(within(nav).getByRole('button', { name: 'Next' }).disabled).toBe(false);

    fireEvent.click(within(nav).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Page 2 of 3')).toBeTruthy();
    expect(requestedUrl(fetchMock, 1).searchParams.get('page')).toBe('2');
  });

  it('reads the page from ?page=, disables Next on the last page, and goes back with Previous', async () => {
    const fetchMock = stubFetch(pageResponse({ page: 3 }), pageResponse({ page: 2 }));
    renderApp('/tickets?page=3');

    expect(await screen.findByText('Page 3 of 3')).toBeTruthy();
    expect(requestedUrl(fetchMock, 0).searchParams.get('page')).toBe('3');
    expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(await screen.findByText('Page 2 of 3')).toBeTruthy();
    expect(requestedUrl(fetchMock, 1).searchParams.get('page')).toBe('2');
  });

  it('treats an invalid ?page= as page 1', async () => {
    const fetchMock = stubFetch(pageResponse());
    renderApp('/tickets?page=abc');

    await screen.findByRole('table');
    expect(requestedUrl(fetchMock, 0).searchParams.get('page')).toBe('1');
  });

  it('keeps the list page in the link to a ticket', async () => {
    stubFetch(
      pageResponse({ page: 2 }),
      jsonResponse(200, {
        ticket: { ...tickets[0], description: 'x', category: 'it', createdBy: null },
      }),
    );
    renderApp('/tickets?page=2');

    fireEvent.click(await screen.findByRole('link', { name: tickets[0].title }));

    const back = await screen.findByRole('link', { name: 'Back to tickets' });
    expect(back.getAttribute('href')).toBe('/tickets?page=2');
  });

  it('shows the empty state when there are no tickets', async () => {
    stubFetch(pageResponse({ items: [], total: 0, totalPages: 0 }));
    renderApp('/tickets');

    expect(await screen.findByRole('heading', { name: 'No tickets yet' })).toBeTruthy();
    expect(screen.getByText('Create your first ticket.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('offers page 1 when the page is past the end', async () => {
    stubFetch(pageResponse({ items: [], page: 9, total: 23, totalPages: 3 }), pageResponse());
    renderApp('/tickets?page=9');

    fireEvent.click(await screen.findByRole('button', { name: 'Go to page 1' }));

    expect(await screen.findByText('Page 1 of 3')).toBeTruthy();
  });

  it('shows an error with a working retry', async () => {
    stubFetch(new TypeError('Failed to fetch'), pageResponse());
    renderApp('/tickets');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('links to the new ticket form', async () => {
    stubFetch(pageResponse({ items: [], total: 0, totalPages: 0 }));
    renderApp('/tickets');

    await screen.findByRole('heading', { name: 'No tickets yet' });
    const links = screen.getAllByRole('link', { name: 'New ticket' });
    expect(links.every((link) => link.getAttribute('href') === '/tickets/new')).toBe(true);
  });
});
