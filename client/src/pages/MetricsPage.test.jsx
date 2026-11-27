// Metrics page (CD-23, docs/metrics.md).
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubApi } from '../test/helpers.jsx';

const ADMIN = { id: 'ad1', name: 'Anton Weber', role: 'admin' };

function metrics(fields = {}) {
  return {
    range: '30d',
    from: '2026-11-15T12:00:00.000Z',
    generatedAt: '2026-12-15T12:00:00.000Z',
    openTickets: { total: 7, byStatus: { open: 3, in_progress: 2, waiting: 2 } },
    resolution: { averageHours: 76.4, resolvedCount: 12 },
    perAgent: [
      { id: 'a1', name: 'Lena Berg', openAssigned: 4, resolvedInRange: 9, inactive: false },
      { id: 'a2', name: 'Former Agent', openAssigned: 1, resolvedInRange: 0, inactive: true },
      { id: 'ad1', name: 'Anton Weber', openAssigned: 0, resolvedInRange: 3, inactive: false },
    ],
    unassigned: { open: 2 },
    sla: { breachedOpen: 1, atRiskOpen: 3 },
    ...fields,
  };
}

const url = (range) => `GET /api/v1/metrics?range=${range}`;

function metricsCalls(fetchMock) {
  return fetchMock.mock.calls
    .map(([requestUrl]) => requestUrl)
    .filter((requestUrl) => requestUrl.startsWith('/api/v1/metrics'));
}

function card(label) {
  return screen.getByRole('heading', { level: 2, name: label }).closest('li');
}

function rangeSelect() {
  return screen.getByRole('combobox', { name: 'Time range' });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MetricsPage', () => {
  it('shows the summary cards, the open-by-status list and the agent table', async () => {
    storeSession('jwt-token', ADMIN);
    const fetchMock = stubApi({ [url('30d')]: jsonResponse(200, metrics()) });
    renderApp('/metrics');

    expect(await screen.findByRole('heading', { level: 1, name: 'Metrics' })).toBeTruthy();
    await screen.findByRole('table');

    expect(within(card('Open tickets')).getByText('7')).toBeTruthy();
    const average = card('Average resolution time');
    expect(average.textContent).toContain('3 d 4 h');
    expect(average.textContent).toContain('3 days 4 hours');
    expect(average.textContent).toContain('12 tickets resolved in the last 30 days');
    expect(within(card('Breached')).getByText('1')).toBeTruthy();
    expect(within(card('Due soon')).getByText('3')).toBeTruthy();

    const status = screen.getByRole('region', { name: 'Open tickets by status' });
    const terms = within(status)
      .getAllByRole('term')
      .map((term) => term.textContent);
    const values = within(status)
      .getAllByRole('definition')
      .map((value) => value.textContent);
    expect(terms).toEqual(['Open', 'In progress', 'Waiting']);
    expect(values).toEqual(['3', '2', '2']);

    const table = screen.getByRole('table');
    expect(table.querySelector('caption').textContent).toContain('Tickets per agent');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Agent', 'Open assigned', 'Resolved in range']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Lena Berg',
      'Former Agent (inactive)',
      'Anton Weber',
      'Unassigned',
    ]);
    expect(
      within(rows[0])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['4', '9']);
    expect(within(rows[3]).getAllByRole('cell')[0].textContent).toBe('2');
    expect(within(rows[3]).getAllByRole('cell')[1].textContent).toContain('Not counted');

    expect(metricsCalls(fetchMock)).toEqual(['/api/v1/metrics?range=30d']);
    expect(screen.getByRole('link', { name: 'Metrics' }).getAttribute('href')).toBe('/metrics');
  });

  it('says so instead of a number when nothing was resolved in the range', async () => {
    storeSession('jwt-token', ADMIN);
    stubApi({
      [url('30d')]: jsonResponse(
        200,
        metrics({ resolution: { averageHours: null, resolvedCount: 0 } }),
      ),
    });
    renderApp('/metrics');

    await screen.findByRole('table');
    const average = card('Average resolution time');
    expect(average.textContent).toContain('No resolved tickets in this range');
    expect(average.textContent).toContain('0 tickets resolved in the last 30 days');
    expect(average.textContent).not.toMatch(/NaN|null|0 h/);
  });

  it('shows an empty state without open or resolved tickets, with a way to all time', async () => {
    storeSession('jwt-token', ADMIN);
    const empty = metrics({
      range: '7d',
      openTickets: { total: 0, byStatus: { open: 0, in_progress: 0, waiting: 0 } },
      resolution: { averageHours: null, resolvedCount: 0 },
      perAgent: [
        { id: 'ad1', name: 'Anton Weber', openAssigned: 0, resolvedInRange: 0, inactive: false },
      ],
      unassigned: { open: 0 },
      sla: { breachedOpen: 0, atRiskOpen: 0 },
    });
    const fetchMock = stubApi({
      [url('7d')]: jsonResponse(200, empty),
      [url('all')]: jsonResponse(200, metrics({ range: 'all', from: null })),
    });
    renderApp('/metrics?range=7d');

    const state = await screen.findByRole('region', { name: 'No tickets to measure' });
    expect(state.textContent).toContain('none were resolved in the last 7 days');
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(within(state).getByRole('button', { name: 'Show all time' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByTestId('location').dataset.search).toBe('?range=all');
    expect(screen.getByText(/Showing all time\./)).toBeTruthy();
    expect(metricsCalls(fetchMock)).toEqual([
      '/api/v1/metrics?range=7d',
      '/api/v1/metrics?range=all',
    ]);
  });

  it('stores the range in the URL and fetches again when it changes', async () => {
    storeSession('jwt-token', ADMIN);
    const fetchMock = stubApi({
      [url('90d')]: jsonResponse(200, metrics({ range: '90d' })),
      [url('7d')]: jsonResponse(
        200,
        metrics({ range: '7d', resolution: { averageHours: 5.5, resolvedCount: 2 } }),
      ),
      [url('30d')]: jsonResponse(200, metrics()),
    });
    renderApp('/metrics?range=90d');

    await screen.findByRole('table');
    expect(rangeSelect().value).toBe('90d');
    expect(
      within(rangeSelect())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['7 days', '30 days', '90 days', 'All time']);

    fireEvent.change(rangeSelect(), { target: { value: '7d' } });
    await waitFor(() => expect(card('Average resolution time').textContent).toContain('5.5 h'));
    expect(screen.getByTestId('location').dataset.search).toBe('?range=7d');

    // 30 days is the default and is left out of the URL.
    fireEvent.change(rangeSelect(), { target: { value: '30d' } });
    await waitFor(() => expect(screen.getByTestId('location').dataset.search).toBe(''));
    await screen.findByText(/Showing the last 30 days/);

    expect(metricsCalls(fetchMock)).toEqual([
      '/api/v1/metrics?range=90d',
      '/api/v1/metrics?range=7d',
      '/api/v1/metrics?range=30d',
    ]);
  });

  it('falls back to 30 days for an unknown range in the URL', async () => {
    storeSession('jwt-token', ADMIN);
    const fetchMock = stubApi({ [url('30d')]: jsonResponse(200, metrics()) });
    renderApp('/metrics?range=1y');

    await screen.findByRole('table');
    expect(rangeSelect().value).toBe('30d');
    expect(metricsCalls(fetchMock)).toEqual(['/api/v1/metrics?range=30d']);
  });

  it('aborts the previous request when the range changes before it answers', async () => {
    storeSession('jwt-token', ADMIN);
    const fetchMock = stubApi({
      [url('30d')]: () => new Promise(() => {}),
      [url('7d')]: jsonResponse(200, metrics({ range: '7d' })),
    });
    renderApp('/metrics');

    await waitFor(() => expect(metricsCalls(fetchMock)).toHaveLength(1));
    fireEvent.change(rangeSelect(), { target: { value: '7d' } });

    expect(await screen.findByRole('table')).toBeTruthy();
    const firstSignal = fetchMock.mock.calls.find(([u]) => u === '/api/v1/metrics?range=30d')[1]
      .signal;
    expect(firstSignal.aborted).toBe(true);
  });

  it('shows an error with a retry', async () => {
    storeSession('jwt-token', ADMIN);
    const fetchMock = stubApi({
      [url('30d')]: [
        jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }),
        jsonResponse(200, metrics()),
      ],
    });
    renderApp('/metrics');

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(metricsCalls(fetchMock)).toHaveLength(2);
  });

  it('shows "Deleted user" for a holder of open tickets who no longer exists', async () => {
    storeSession('jwt-token', ADMIN);
    stubApi({
      [url('30d')]: jsonResponse(
        200,
        metrics({
          perAgent: [{ id: 'x', name: null, openAssigned: 1, resolvedInRange: 0, inactive: true }],
        }),
      ),
    });
    renderApp('/metrics');

    expect(await screen.findByRole('rowheader', { name: 'Deleted user (inactive)' })).toBeTruthy();
  });

  it.each(['customer', 'agent'])('hides the link from a %s and redirects them', (role) => {
    storeSession('jwt-token', { id: 'u1', name: 'Someone', role });
    const fetchMock = stubApi();
    renderApp('/metrics');

    expect(screen.getByTestId('location').textContent).toBe('/tickets');
    expect(screen.queryByRole('link', { name: 'Metrics' })).toBeNull();
    expect(metricsCalls(fetchMock)).toEqual([]);
  });

  it('sends a logged-out visitor to /login', () => {
    stubApi();
    renderApp('/metrics');

    expect(screen.getByRole('form', { name: 'Log in' })).toBeTruthy();
  });
});
