import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

const tickets = [
  {
    id: 't2',
    title: 'Door badge reader offline',
    category: 'facility',
    priority: 'urgent',
    status: 'open',
    createdAt: '2026-12-02T08:00:00.000Z',
  },
  {
    id: 't1',
    title: 'Printer in reception not working',
    category: 'it',
    priority: 'normal',
    status: 'in_progress',
    createdAt: '2026-12-01T09:15:00.000Z',
  },
];

beforeEach(() => {
  window.sessionStorage.clear();
  storeSession('jwt-token', { id: 'u1', name: 'Mara Jensen', role: 'customer' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TicketsPage', () => {
  it('shows a loading state, then the empty state', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { items: [] }));
    renderApp('/tickets');

    expect(screen.getByRole('status').textContent).toContain('Loading tickets...');
    expect(await screen.findByRole('heading', { name: 'No tickets yet' })).toBeTruthy();
    expect(screen.getByText('Create your first ticket.')).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tickets/mine');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');
  });

  it('lists the loaded tickets in the order the API returns', async () => {
    stubFetch(jsonResponse(200, { items: tickets }));
    renderApp('/tickets');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Door badge reader offline')).toBeTruthy();
    expect(within(rows[0]).getByText('Facility')).toBeTruthy();
    expect(within(rows[0]).getByText('Urgent')).toBeTruthy();
    expect(within(rows[0]).getByText('Open')).toBeTruthy();
    expect(within(rows[1]).getByText('In progress')).toBeTruthy();
    expect(screen.queryByText('No tickets yet')).toBeNull();
  });

  it('shows an error with a retry button', async () => {
    stubFetch(new TypeError('Failed to fetch'), jsonResponse(200, { items: tickets }));
    renderApp('/tickets');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('links to the new ticket form', async () => {
    stubFetch(jsonResponse(200, { items: [] }));
    renderApp('/tickets');

    await screen.findByRole('heading', { name: 'No tickets yet' });
    const links = screen.getAllByRole('link', { name: 'New ticket' });
    expect(links.every((link) => link.getAttribute('href') === '/tickets/new')).toBe(true);

    fireEvent.click(links[0]);
    expect(screen.getByTestId('location').textContent).toBe('/tickets/new');
  });
});
