// SLA badge and filter on the ticket list and detail (CD-22, docs/sla.md).
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubViewport } from '../test/helpers.jsx';

const BREACHED = { state: 'breached', kind: 'first_response', dueAt: '2026-12-01T10:00:00.000Z' };
const AT_RISK = { state: 'at_risk', kind: 'resolution', dueAt: '2026-12-03T09:00:00.000Z' };

const TICKETS = [
  {
    id: 't2',
    title: 'Printer in reception not working',
    status: 'open',
    priority: 'high',
    assignee: null,
    createdAt: '2026-12-01T09:15:00.000Z',
    sla: BREACHED,
  },
  {
    id: 't1',
    title: 'Account locked',
    status: 'in_progress',
    priority: 'urgent',
    assignee: { id: 'a1', name: 'Lena' },
    createdAt: '2026-11-30T10:00:00.000Z',
    sla: AT_RISK,
  },
  {
    id: 't0',
    title: 'Old ticket',
    status: 'open',
    priority: 'low',
    assignee: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    sla: { state: null, dueAt: null, kind: null },
  },
];

const DETAIL = {
  ...TICKETS[0],
  description: 'Error E-12.',
  category: 'it',
  createdBy: { id: 'u1', name: 'Mara Jensen' },
  updatedAt: '2026-12-01T09:15:00.000Z',
  allowedNextStatuses: [],
};

// Customers get no sla field from the API; the stub mirrors that.
function stubList(role) {
  const strip = (ticket) => {
    if (role !== 'customer') return ticket;
    const { sla: _sla, ...rest } = ticket;
    return rest;
  };
  const fetchMock = vi.fn((url) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/v1/tickets') {
      return Promise.resolve(
        jsonResponse(200, {
          items: TICKETS.map(strip),
          page: 1,
          limit: 10,
          total: 3,
          totalPages: 1,
        }),
      );
    }
    if (parsed.pathname === `/api/v1/tickets/${DETAIL.id}`) {
      return Promise.resolve(jsonResponse(200, { ticket: strip(DETAIL) }));
    }
    return Promise.resolve(jsonResponse(200, { items: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastListQuery(fetchMock) {
  const requests = fetchMock.mock.calls
    .map(([url]) => new URL(url, 'http://localhost'))
    .filter((url) => url.pathname === '/api/v1/tickets');
  return Object.fromEntries(requests[requests.length - 1].searchParams);
}

function urlSearch() {
  return new URLSearchParams(screen.getByTestId('location').dataset.search);
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

describe('SLA on the ticket list', () => {
  it.each(['agent', 'admin'])('shows an SLA column with text badges for an %s', async (role) => {
    login(role);
    stubList(role);
    renderApp('/tickets');
    const table = await screen.findByRole('table');

    expect(within(table).getByRole('columnheader', { name: 'SLA' })).toBeTruthy();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Breached')).toBeTruthy();
    expect(within(rows[0]).getByText(/^First response was due /)).toBeTruthy();
    expect(within(rows[1]).getByText('Due soon')).toBeTruthy();
    expect(within(rows[1]).getByText(/^Resolution due /)).toBeTruthy();
    // A ticket from before CD-22 has no SLA: an empty cell, no badge.
    expect(rows[2].querySelector('.sla')).toBeNull();
  });

  it('shows the SLA in the cards on a phone', async () => {
    stubViewport(360);
    login('agent');
    stubList('agent');
    renderApp('/tickets');

    const cards = await screen.findByRole('list', { name: /^Tickets/ });
    const items = within(cards).getAllByRole('listitem');
    expect(within(items[0]).getByText('SLA')).toBeTruthy();
    expect(within(items[0]).getByText('Breached')).toBeTruthy();
    expect(within(items[2]).queryByText('SLA')).toBeNull();
  });

  it('shows no SLA column, badge or filter to a customer', async () => {
    login('customer');
    stubList('customer');
    renderApp('/tickets');
    const table = await screen.findByRole('table');

    expect(within(table).queryByRole('columnheader', { name: 'SLA' })).toBeNull();
    expect(document.querySelector('.sla')).toBeNull();
    expect(screen.queryByLabelText('SLA')).toBeNull();
  });
});

describe('SLA filter', () => {
  it('offers All, Breached and Due soon next to the other filters', async () => {
    login('agent');
    stubList('agent');
    renderApp('/tickets');
    await screen.findByRole('table');

    const toolbar = screen.getByRole('search', { name: 'Filter tickets' });
    const options = within(within(toolbar).getByLabelText('SLA'))
      .getAllByRole('option')
      .map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ['', 'All'],
      ['breached', 'Breached'],
      ['at_risk', 'Due soon'],
    ]);
  });

  it('reads sla from the URL and sends it with the other filters', async () => {
    login('agent');
    const fetchMock = stubList('agent');
    renderApp('/tickets?sla=at_risk&status=open&page=2');
    await screen.findByRole('table');

    expect(screen.getByLabelText('SLA').value).toBe('at_risk');
    expect(lastListQuery(fetchMock)).toEqual({
      page: '2',
      limit: '10',
      status: 'open',
      sla: 'at_risk',
    });
  });

  it('writes the choice to the URL, resets the page and clears with the other filters', async () => {
    login('admin');
    const fetchMock = stubList('admin');
    renderApp('/tickets?status=open&page=2');
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('SLA'), { target: { value: 'breached' } });

    await waitFor(() => expect(lastListQuery(fetchMock).sla).toBe('breached'));
    expect(urlSearch().toString()).toBe('status=open&sla=breached');
    expect(lastListQuery(fetchMock).page).toBe('1');

    const toolbar = screen.getByRole('search', { name: 'Filter tickets' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(urlSearch().toString()).toBe(''));
    expect(lastListQuery(fetchMock).sla).toBeUndefined();
  });

  it('ignores an unknown sla value in the URL', async () => {
    login('agent');
    const fetchMock = stubList('agent');
    renderApp('/tickets?sla=late');
    await screen.findByRole('table');

    expect(screen.getByLabelText('SLA').value).toBe('');
    expect(lastListQuery(fetchMock)).toEqual({ page: '1', limit: '10' });
  });

  it('never sends sla for a customer, even from the URL', async () => {
    login('customer');
    const fetchMock = stubList('customer');
    renderApp('/tickets?sla=breached&priority=high');
    await screen.findByRole('table');

    expect(lastListQuery(fetchMock)).toEqual({ page: '1', limit: '10', priority: 'high' });
  });
});

describe('SLA on the ticket detail', () => {
  it('shows the badge and due time to an agent', async () => {
    login('agent');
    stubList('agent');
    renderApp(`/tickets/${DETAIL.id}`);
    await screen.findByRole('heading', { level: 1, name: DETAIL.title });

    const header = document.querySelector('.ticket-detail-header');
    expect(within(header).getByText('Breached').className).toBe('badge badge-sla-breached');
    expect(within(header).getByText(/^First response was due /)).toBeTruthy();
  });

  it('shows no SLA to a customer', async () => {
    login('customer');
    stubList('customer');
    renderApp(`/tickets/${DETAIL.id}`);
    await screen.findByRole('heading', { level: 1, name: DETAIL.title });

    expect(document.querySelector('.sla')).toBeNull();
    expect(screen.queryByText(/due/i)).toBeNull();
  });
});
