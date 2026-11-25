// Ticket list filters, search and sorting (CD-17).
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession } from '../test/helpers.jsx';

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

function pageBody({ items = TICKETS, page = 1, total = 12, totalPages = 2 } = {}) {
  return { items, page, limit: 10, total, totalPages };
}

const EMPTY = pageBody({ items: [], total: 0, totalPages: 0 });

// Answers every ticket list request with `respond(searchParams)` (default: one page).
function stubList(respond = () => jsonResponse(200, pageBody())) {
  const fetchMock = vi.fn((url) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/v1/tickets') {
      return Promise.resolve(respond(parsed.searchParams));
    }
    return Promise.resolve(
      jsonResponse(200, { ticket: { ...TICKETS[0], description: 'x', category: 'it' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function listRequests(fetchMock) {
  return fetchMock.mock.calls
    .map(([url]) => new URL(url, 'http://localhost'))
    .filter((url) => url.pathname === '/api/v1/tickets');
}

function lastListQuery(fetchMock) {
  const requests = listRequests(fetchMock);
  return Object.fromEntries(requests[requests.length - 1].searchParams);
}

function urlSearch() {
  return new URLSearchParams(screen.getByTestId('location').dataset.search);
}

function login(role) {
  storeSession('jwt-token', { id: `${role}-1`, name: 'Test User', role });
}

function select(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('toolbar per role', () => {
  it('shows search, status, priority and category to a customer', async () => {
    login('customer');
    stubList();
    renderApp('/tickets');
    await screen.findByRole('table');

    const toolbar = screen.getByRole('search', { name: 'Filter tickets' });
    expect(within(toolbar).getByLabelText('Search title').getAttribute('type')).toBe('search');
    expect(within(toolbar).getByLabelText('Status')).toBeTruthy();
    expect(within(toolbar).getByLabelText('Priority')).toBeTruthy();
    expect(within(toolbar).getByLabelText('Category')).toBeTruthy();
    expect(within(toolbar).queryByLabelText('Assignee')).toBeNull();
    expect(within(toolbar).queryByLabelText('Sort by')).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: 'Clear filters' })).toBeNull();

    const status = within(screen.getByLabelText('Status'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(status).toEqual(['All', 'Open', 'In progress', 'Waiting', 'Resolved', 'Closed']);
  });

  it.each(['agent', 'admin'])('adds assignee and sort controls for an %s', async (role) => {
    login(role);
    stubList();
    renderApp('/tickets');
    await screen.findByRole('table');

    const assignee = within(screen.getByLabelText('Assignee'))
      .getAllByRole('option')
      .map((option) => [option.value, option.textContent]);
    expect(assignee).toEqual([
      ['', 'All'],
      ['me', 'Me'],
      ['unassigned', 'Unassigned'],
    ]);
    expect(screen.getByLabelText('Sort by').value).toBe('createdAt:desc');
  });

  it('never sends assignee for a customer, even from the URL', async () => {
    login('customer');
    const fetchMock = stubList();
    renderApp('/tickets?assignee=me&status=open');
    await screen.findByRole('table');

    expect(lastListQuery(fetchMock)).toEqual({ page: '1', limit: '10', status: 'open' });
  });
});

describe('URL state', () => {
  it('reads filters, search and sort from the URL and sends them', async () => {
    login('agent');
    const fetchMock = stubList();
    renderApp(
      '/tickets?status=open&priority=high&category=it&assignee=me&q=printer&sort=priority&order=asc&page=2',
    );
    await screen.findByRole('table');

    expect(lastListQuery(fetchMock)).toEqual({
      page: '2',
      limit: '10',
      status: 'open',
      priority: 'high',
      category: 'it',
      assignee: 'me',
      q: 'printer',
      sort: 'priority',
      order: 'asc',
    });
    expect(screen.getByLabelText('Status').value).toBe('open');
    expect(screen.getByLabelText('Priority').value).toBe('high');
    expect(screen.getByLabelText('Category').value).toBe('it');
    expect(screen.getByLabelText('Assignee').value).toBe('me');
    expect(screen.getByLabelText('Search title').value).toBe('printer');
    expect(screen.getByLabelText('Sort by').value).toBe('priority:asc');
  });

  it('ignores unknown values in the URL', async () => {
    login('agent');
    const fetchMock = stubList();
    renderApp('/tickets?status=bogus&priority=$ne&sort=title&order=up');
    await screen.findByRole('table');

    expect(lastListQuery(fetchMock)).toEqual({ page: '1', limit: '10' });
    expect(screen.getByLabelText('Status').value).toBe('');
  });

  it('updates the URL and resets to page 1 when a filter changes', async () => {
    login('agent');
    const fetchMock = stubList();
    renderApp('/tickets?page=2');
    await screen.findByText('Page 2 of 2');

    select('Status', 'waiting');

    await waitFor(() => expect(lastListQuery(fetchMock).status).toBe('waiting'));
    expect(lastListQuery(fetchMock).page).toBe('1');
    expect(urlSearch().get('status')).toBe('waiting');
    expect(urlSearch().has('page')).toBe(false);

    select('Assignee', 'unassigned');
    await waitFor(() => expect(lastListQuery(fetchMock).assignee).toBe('unassigned'));
    expect(urlSearch().toString()).toBe('status=waiting&assignee=unassigned');

    select('Status', '');
    await waitFor(() => expect(lastListQuery(fetchMock).status).toBeUndefined());
    expect(urlSearch().toString()).toBe('assignee=unassigned');
  });

  it('keeps the filters when changing page', async () => {
    login('agent');
    const fetchMock = stubList();
    renderApp('/tickets?status=open');
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(lastListQuery(fetchMock).page).toBe('2'));
    expect(lastListQuery(fetchMock).status).toBe('open');
    expect(urlSearch().toString()).toBe('status=open&page=2');
  });

  it('keeps the filters in "Back to tickets" on the detail page', async () => {
    login('agent');
    stubList();
    renderApp('/tickets?status=open&q=printer&sort=priority&order=desc&page=2');

    fireEvent.click(await screen.findByRole('link', { name: TICKETS[0].title }));

    const back = await screen.findByRole('link', { name: 'Back to tickets' });
    expect(back.getAttribute('href')).toBe(
      '/tickets?status=open&q=printer&sort=priority&order=desc&page=2',
    );
  });
});

describe('search', () => {
  it('waits for a pause in typing before searching', async () => {
    login('customer');
    const fetchMock = stubList();
    renderApp('/tickets?page=2');
    await screen.findByRole('table');
    const before = listRequests(fetchMock).length;

    const box = screen.getByLabelText('Search title');
    fireEvent.change(box, { target: { value: 'pr' } });
    fireEvent.change(box, { target: { value: 'pri' } });
    fireEvent.change(box, { target: { value: 'printer' } });

    expect(listRequests(fetchMock)).toHaveLength(before);
    expect(urlSearch().has('q')).toBe(false);

    await waitFor(() => expect(urlSearch().get('q')).toBe('printer'));
    await screen.findByRole('table');
    expect(listRequests(fetchMock)).toHaveLength(before + 1);
    expect(lastListQuery(fetchMock)).toMatchObject({ q: 'printer', page: '1' });
    expect(urlSearch().has('page')).toBe(false);
  });

  it('debounces with about 300 ms', async () => {
    vi.useFakeTimers();
    login('customer');
    const fetchMock = stubList();
    renderApp('/tickets');
    await vi.waitFor(() => expect(listRequests(fetchMock)).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Search title'), { target: { value: 'lock' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(urlSearch().has('q')).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(urlSearch().get('q')).toBe('lock'));
    await vi.waitFor(() => expect(lastListQuery(fetchMock).q).toBe('lock'));
  });

  it('searches at once on Enter', async () => {
    login('customer');
    stubList();
    renderApp('/tickets');
    await screen.findByRole('table');

    const box = screen.getByLabelText('Search title');
    fireEvent.change(box, { target: { value: 'locked' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(urlSearch().get('q')).toBe('locked');
  });

  it('trims the search before sending and skips a blank one', async () => {
    login('customer');
    const fetchMock = stubList();
    renderApp(`/tickets?q=${encodeURIComponent('  locked ')}`);
    await screen.findByRole('table');
    expect(lastListQuery(fetchMock).q).toBe('locked');

    cleanup();
    const blankMock = stubList();
    renderApp('/tickets?q=%20%20');
    await screen.findByRole('table');
    expect(lastListQuery(blankMock).q).toBeUndefined();
  });

  it('never shows a stale response after a newer one', async () => {
    login('customer');
    const pending = [];
    stubList((params) => {
      if (params.get('q') === 'old') {
        return new Promise((resolve) => pending.push(resolve));
      }
      if (params.get('q') === 'new') {
        return jsonResponse(200, pageBody({ items: [TICKETS[1]], total: 1, totalPages: 1 }));
      }
      return jsonResponse(200, pageBody());
    });
    renderApp('/tickets');
    await screen.findByRole('table');

    const box = screen.getByLabelText('Search title');
    fireEvent.change(box, { target: { value: 'old' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(pending).toHaveLength(1));

    fireEvent.change(box, { target: { value: 'new' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByRole('link', { name: 'Account locked' })).toBeTruthy();

    pending[0](jsonResponse(200, pageBody({ items: [TICKETS[0]], total: 1, totalPages: 1 })));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('link', { name: TICKETS[0].title })).toBeNull();
    expect(screen.getByRole('link', { name: 'Account locked' })).toBeTruthy();
  });

  it('follows the URL when the search is cleared from outside', async () => {
    login('customer');
    stubList();
    renderApp('/tickets?q=printer');
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(screen.getByLabelText('Search title').value).toBe(''));
    expect(urlSearch().has('q')).toBe(false);
  });
});

describe('clear filters and empty states', () => {
  it('shows "Clear filters" only while a filter is active and keeps the sort', async () => {
    login('agent');
    const fetchMock = stubList();
    renderApp('/tickets?status=open&assignee=me&q=printer&sort=priority&order=desc&page=2');
    await screen.findByRole('table');

    const toolbar = screen.getByRole('search', { name: 'Filter tickets' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(urlSearch().toString()).toBe('sort=priority&order=desc'));
    expect(lastListQuery(fetchMock)).toEqual({
      page: '1',
      limit: '10',
      sort: 'priority',
      order: 'desc',
    });
    expect(within(toolbar).queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByLabelText('Status').value).toBe('');
  });

  it('shows "No tickets match your filters" with a clear action', async () => {
    login('customer');
    const fetchMock = stubList((params) =>
      jsonResponse(200, params.get('status') ? EMPTY : pageBody()),
    );
    renderApp('/tickets?status=closed');

    const empty = await screen.findByRole('region', { name: 'No tickets match your filters' });
    expect(screen.queryByRole('heading', { name: 'No tickets yet' })).toBeNull();

    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(lastListQuery(fetchMock).status).toBeUndefined();
  });

  it('still shows "No tickets yet" with no filters', async () => {
    login('customer');
    stubList(() => jsonResponse(200, EMPTY));
    renderApp('/tickets?sort=status&order=asc');

    expect(await screen.findByRole('heading', { name: 'No tickets yet' })).toBeTruthy();
    expect(screen.queryByText('No tickets match your filters')).toBeNull();
  });

  it('shows an error with retry that keeps the filters', async () => {
    login('customer');
    let calls = 0;
    const fetchMock = stubList(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return jsonResponse(200, pageBody());
    });
    renderApp('/tickets?priority=urgent');

    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(lastListQuery(fetchMock).priority).toBe('urgent');
  });
});

describe('sortable headers', () => {
  function header(name) {
    return screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });
  }

  it('marks the active column with aria-sort and uses real buttons', async () => {
    login('customer');
    stubList();
    renderApp('/tickets');
    await screen.findByRole('table');

    expect(header('Created').getAttribute('aria-sort')).toBe('descending');
    expect(header('Status').hasAttribute('aria-sort')).toBe(false);
    expect(header('Priority').hasAttribute('aria-sort')).toBe(false);
    expect(header('Title').hasAttribute('aria-sort')).toBe(false);

    const button = within(header('Priority')).getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('sorts by a column, then toggles its direction, resetting the page', async () => {
    login('customer');
    const fetchMock = stubList();
    renderApp('/tickets?page=2');
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by priority, descending' }));
    await waitFor(() => expect(lastListQuery(fetchMock).sort).toBe('priority'));
    expect(lastListQuery(fetchMock)).toMatchObject({ order: 'desc', page: '1' });
    expect(urlSearch().toString()).toBe('sort=priority&order=desc');
    await screen.findByRole('table');
    expect(header('Priority').getAttribute('aria-sort')).toBe('descending');
    expect(header('Created').hasAttribute('aria-sort')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by priority, ascending' }));
    await waitFor(() => expect(lastListQuery(fetchMock).order).toBe('asc'));
    await screen.findByRole('table');
    expect(header('Priority').getAttribute('aria-sort')).toBe('ascending');
  });

  it('sorts status in workflow order first and goes back to the default sort', async () => {
    login('customer');
    const fetchMock = stubList();
    renderApp('/tickets?sort=status&order=desc');
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by created, descending' }));

    await waitFor(() => expect(lastListQuery(fetchMock).sort).toBeUndefined());
    expect(urlSearch().toString()).toBe('');
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by status, ascending' }));
    await waitFor(() =>
      expect(lastListQuery(fetchMock)).toMatchObject({ sort: 'status', order: 'asc' }),
    );
  });

  it('changes the sort from the staff sort select', async () => {
    login('agent');
    const fetchMock = stubList();
    renderApp('/tickets');
    await screen.findByRole('table');

    select('Sort by', 'updatedAt:desc');

    await waitFor(() =>
      expect(lastListQuery(fetchMock)).toMatchObject({ sort: 'updatedAt', order: 'desc' }),
    );
    await screen.findByRole('table');
    expect(screen.getByRole('table').querySelector('caption').textContent).toBe(
      'Tickets, recently updated',
    );
  });
});
