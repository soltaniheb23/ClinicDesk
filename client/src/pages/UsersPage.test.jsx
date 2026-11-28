// Admin user management page (CD-19).
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubViewport } from '../test/helpers.jsx';

const ME = {
  id: 'ad1',
  name: 'Anton Admin',
  email: 'anton@example.com',
  role: 'admin',
  isActive: true,
  createdAt: '2026-11-01T09:00:00.000Z',
};
const LENA = {
  id: 'u2',
  name: 'Lena Berg',
  email: 'lena@example.com',
  role: 'agent',
  isActive: true,
  createdAt: '2026-11-02T09:00:00.000Z',
};
const MARA = {
  id: 'u3',
  name: 'Mara Jensen',
  email: 'mara@example.com',
  role: 'customer',
  isActive: false,
  createdAt: '2026-11-03T09:00:00.000Z',
};
const USERS = [ME, LENA, MARA];

function pageBody({ items = USERS, page = 1, total = items.length, totalPages = 1 } = {}) {
  return { items, page, limit: 20, total, totalPages };
}

const EMPTY = pageBody({ items: [], total: 0, totalPages: 0 });

// Answers GET /api/v1/users with `list(searchParams)`, and POST and PATCH with the queued
// responses (an Error is a network failure). Returns the fetch mock.
function stubUsers({ list = () => jsonResponse(200, pageBody()), post = [], patch = [] } = {}) {
  const queues = { POST: [...post], PATCH: [...patch] };
  const fetchMock = vi.fn((url, init = {}) => {
    const method = init.method ?? 'GET';
    const parsed = new URL(url, 'http://localhost');
    if (method === 'GET' && parsed.pathname === '/api/v1/users') {
      const response = list(parsed.searchParams);
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }
    const next = queues[method]?.shift();
    if (!next) return Promise.resolve(jsonResponse(200, { items: [] }));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requests(fetchMock, method) {
  return fetchMock.mock.calls
    .filter(([, init = {}]) => (init.method ?? 'GET') === method)
    .map(([url, init = {}]) => ({
      url,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    }));
}

function listQueries(fetchMock) {
  return requests(fetchMock, 'GET')
    .map(({ url }) => new URL(url, 'http://localhost'))
    .filter((url) => url.pathname === '/api/v1/users')
    .map((url) => Object.fromEntries(url.searchParams));
}

function loginAsAdmin() {
  storeSession('jwt-token', { id: ME.id, name: ME.name, role: 'admin' });
}

async function openPage(path = '/admin/users') {
  renderApp(path);
  return screen.findByRole('table');
}

function rowFor(name) {
  return within(screen.getByRole('table'))
    .getByText(name, { selector: '.user-name' })
    .closest('tr');
}

function errorBody(status, code, message) {
  return jsonResponse(status, { error: { code, message } });
}

beforeEach(() => {
  window.sessionStorage.clear();
  loginAsAdmin();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('user list', () => {
  it('shows a loading state, then a table of users with labelled columns', async () => {
    const fetchMock = stubUsers();
    renderApp('/admin/users');

    expect(screen.getByText('Loading users...')).toBeTruthy();

    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Name', 'Email', 'Role', 'Status', 'Created', 'Access']);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('3 users')).toBeTruthy();

    const lena = within(rowFor('Lena Berg'));
    expect(lena.getByText('lena@example.com')).toBeTruthy();
    expect(lena.getByText('Active').className).toBe('badge badge-user-active');
    expect(lena.getByText('02.11.2026')).toBeTruthy();
    expect(within(rowFor('Mara Jensen')).getByText('Deactivated')).toBeTruthy();

    expect(listQueries(fetchMock)).toEqual([{ page: '1', limit: '20' }]);
  });

  it('gives every row control a label that names the user', async () => {
    stubUsers();
    await openPage();

    const select = screen.getByLabelText('Role for Lena Berg');
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('agent');
    expect(screen.getByRole('button', { name: 'Save role for Lena Berg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deactivate Lena Berg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivate Mara Jensen' })).toBeTruthy();
  });

  it('shows no controls on your own row', async () => {
    stubUsers();
    await openPage();

    const own = within(rowFor('Anton Admin'));
    expect(own.getByText('You')).toBeTruthy();
    expect(own.getByText('Admin')).toBeTruthy();
    expect(own.getByText('Your account')).toBeTruthy();
    expect(own.queryByRole('combobox')).toBeNull();
    expect(own.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Role for Anton Admin')).toBeNull();
  });

  it('shows an error with a retry that loads the list again', async () => {
    let calls = 0;
    stubUsers({
      list: () => {
        calls += 1;
        return calls === 1 ? new TypeError('Failed to fetch') : jsonResponse(200, pageBody());
      },
    });
    renderApp('/admin/users');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('shows the server message when the API refuses the list', async () => {
    stubUsers({
      list: () => errorBody(403, 'FORBIDDEN', 'You do not have permission to do this'),
    });
    renderApp('/admin/users');

    expect((await screen.findByRole('alert')).textContent).toContain(
      'You do not have permission to do this',
    );
  });

  it('shows an empty state when there are no users', async () => {
    stubUsers({ list: () => jsonResponse(200, EMPTY) });
    renderApp('/admin/users');

    expect(await screen.findByRole('region', { name: 'No users yet' })).toBeTruthy();
  });

  it('offers page 1 when the page in the URL is past the end', async () => {
    const fetchMock = stubUsers({
      list: (params) =>
        jsonResponse(
          200,
          params.get('page') === '5' ? pageBody({ items: [], total: 3, page: 5 }) : pageBody(),
        ),
    });
    renderApp('/admin/users?page=5');

    const empty = await screen.findByRole('region', { name: 'No users on this page' });
    fireEvent.click(within(empty).getByRole('button', { name: 'Go to page 1' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(listQueries(fetchMock).at(-1).page).toBe('1');
  });

  it('pages through the list', async () => {
    const fetchMock = stubUsers({
      list: (params) =>
        jsonResponse(200, pageBody({ page: Number(params.get('page')), total: 45, totalPages: 3 })),
    });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(listQueries(fetchMock).at(-1).page).toBe('2'));
    expect(screen.getByTestId('location').dataset.search).toBe('?page=2');
  });
});

describe('filters', () => {
  it('sends role and active-state filters and keeps them in the URL', async () => {
    const fetchMock = stubUsers();
    await openPage();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'agent' } });
    await waitFor(() => expect(listQueries(fetchMock).at(-1)).toMatchObject({ role: 'agent' }));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'false' } });
    await waitFor(() =>
      expect(listQueries(fetchMock).at(-1)).toEqual({
        page: '1',
        limit: '20',
        role: 'agent',
        isActive: 'false',
      }),
    );
    expect(screen.getByTestId('location').dataset.search).toBe('?role=agent&active=false');
  });

  it('searches name or email after a pause', async () => {
    const fetchMock = stubUsers();
    await openPage();

    fireEvent.change(screen.getByLabelText('Search name or email'), {
      target: { value: '  lena ' },
    });

    await waitFor(() => expect(listQueries(fetchMock).at(-1)).toMatchObject({ q: 'lena' }));
  });

  it('reads filters from the URL and ignores unknown values', async () => {
    const fetchMock = stubUsers();
    await openPage('/admin/users?role=root&active=maybe&q=berg');

    expect(listQueries(fetchMock)).toEqual([{ page: '1', limit: '20', q: 'berg' }]);
    expect(screen.getByLabelText('Role').value).toBe('');
    expect(screen.getByLabelText('Search name or email').value).toBe('berg');
  });

  it('shows a no-match state with a button that clears the filters', async () => {
    const fetchMock = stubUsers({
      list: (params) => jsonResponse(200, params.has('q') ? EMPTY : pageBody()),
    });
    renderApp('/admin/users?q=nobody&role=agent');

    const empty = await screen.findByRole('region', { name: 'No users match your filters' });
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(listQueries(fetchMock).at(-1)).toEqual({ page: '1', limit: '20' });
    expect(screen.getByTestId('location').dataset.search).toBe('');
  });
});

describe('create user', () => {
  const CREATED = {
    id: 'u9',
    name: 'Omar Haddad',
    email: 'omar@example.com',
    role: 'agent',
    isActive: true,
    createdAt: '2026-11-25T09:00:00.000Z',
  };

  function fillForm({
    name = 'Omar Haddad',
    email = 'omar@example.com',
    password = 'temp-pass-123',
    role = 'agent',
  } = {}) {
    const form = screen.getByRole('form', { name: 'Create user' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: name } });
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: email } });
    fireEvent.change(within(form).getByLabelText(/Temporary password/), {
      target: { value: password },
    });
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: role } });
    return form;
  }

  async function openForm() {
    const toggle = screen.getByRole('button', { name: 'New user' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('create-user-panel');
    return screen.getByRole('form', { name: 'Create user' });
  }

  it('creates a user, shows a confirmation and reloads the list', async () => {
    const fetchMock = stubUsers({ post: [jsonResponse(201, { user: CREATED })] });
    await openPage();
    await openForm();
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));

    const form = fillForm({ email: '  omar@example.com ' });
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('User created: Omar Haddad (Agent).')).toBeTruthy();
    expect(requests(fetchMock, 'POST')).toEqual([
      {
        url: '/api/v1/users',
        body: {
          name: 'Omar Haddad',
          email: 'omar@example.com',
          password: 'temp-pass-123',
          role: 'agent',
        },
      },
    ]);
    expect(screen.queryByRole('form', { name: 'Create user' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New user' }));
    await waitFor(() => expect(listQueries(fetchMock)).toHaveLength(2));
  });

  it('offers every role and starts with customer', async () => {
    stubUsers();
    await openPage();
    const form = await openForm();

    const role = within(form).getByLabelText('Role');
    expect(role.value).toBe('customer');
    expect([...role.options].map((option) => option.value)).toEqual(['customer', 'agent', 'admin']);
  });

  it('checks the fields before sending', async () => {
    const fetchMock = stubUsers();
    await openPage();
    await openForm();

    const form = fillForm({ name: ' ', email: 'not-an-email', password: 'short' });
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));

    expect(within(form).getByText('Enter a name')).toBeTruthy();
    expect(within(form).getByText('Enter a valid email address')).toBeTruthy();
    expect(within(form).getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(within(form).getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(within(form).getByLabelText('Name'));
    expect(requests(fetchMock, 'POST')).toEqual([]);
  });

  it('shows a duplicate email in an alert and keeps the form', async () => {
    stubUsers({
      post: [errorBody(409, 'EMAIL_TAKEN', 'An account with this email already exists')],
    });
    await openPage();
    await openForm();

    const form = fillForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));

    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toBe('An account with this email already exists');
    expect(within(form).getByLabelText('Name').value).toBe('Omar Haddad');
    expect(within(form).getByRole('button', { name: 'Create user' }).disabled).toBe(false);
  });

  it('shows server field errors next to the field', async () => {
    stubUsers({
      post: [
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Some fields are invalid',
            details: [{ field: 'password', message: 'Password must be at most 72 bytes' }],
          },
        }),
      ],
    });
    await openPage();
    await openForm();

    const form = fillForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));

    expect(await within(form).findByText('Password must be at most 72 bytes')).toBeTruthy();
    expect(document.activeElement).toBe(within(form).getByLabelText(/Temporary password/));
  });

  it('closes with Cancel and returns focus to "New user"', async () => {
    stubUsers();
    await openPage();
    const form = await openForm();

    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('form', { name: 'Create user' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New user' }));
  });
});

describe('role change', () => {
  it('saves the new role and updates the row', async () => {
    const fetchMock = stubUsers({
      patch: [jsonResponse(200, { user: { ...LENA, role: 'admin' } })],
    });
    await openPage();

    const save = screen.getByRole('button', { name: 'Save role for Lena Berg' });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Role for Lena Berg'), { target: { value: 'admin' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(await screen.findByText('Lena Berg is now an admin.')).toBeTruthy();
    expect(requests(fetchMock, 'PATCH')).toEqual([
      { url: '/api/v1/users/u2', body: { role: 'admin' } },
    ]);
    const select = screen.getByLabelText('Role for Lena Berg');
    expect(select.value).toBe('admin');
    expect(document.activeElement).toBe(select);
    expect(screen.getByRole('button', { name: 'Save role for Lena Berg' }).disabled).toBe(true);
  });

  it('shows a last-admin refusal in an alert in the row', async () => {
    const other = { ...LENA, role: 'admin' };
    stubUsers({
      list: () => jsonResponse(200, pageBody({ items: [ME, other] })),
      patch: [
        errorBody(409, 'LAST_ADMIN', 'The last active admin cannot be demoted or deactivated'),
      ],
    });
    await openPage();

    fireEvent.change(screen.getByLabelText('Role for Lena Berg'), { target: { value: 'agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save role for Lena Berg' }));

    const alert = await within(rowFor('Lena Berg')).findByRole('alert');
    expect(alert.textContent).toBe('The last active admin cannot be demoted or deactivated');
    expect(screen.getByLabelText('Role for Lena Berg').getAttribute('aria-describedby')).toBe(
      alert.id,
    );
  });
});

describe('deactivate and reactivate', () => {
  it('asks for confirmation and only then deactivates', async () => {
    const fetchMock = stubUsers({
      patch: [jsonResponse(200, { user: { ...LENA, isActive: false } })],
    });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Lena Berg' }));

    const question = screen.getByRole('group', { name: /Deactivate Lena Berg\?/ });
    expect(question.textContent).toContain('signed out at once');
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Cancel' }));
    expect(requests(fetchMock, 'PATCH')).toEqual([]);

    fireEvent.click(within(question).getByRole('button', { name: 'Yes, deactivate' }));

    expect(await screen.findByText('Lena Berg was deactivated.')).toBeTruthy();
    expect(requests(fetchMock, 'PATCH')).toEqual([
      { url: '/api/v1/users/u2', body: { isActive: false } },
    ]);
    const row = within(rowFor('Lena Berg'));
    expect(row.getByText('Deactivated')).toBeTruthy();
    const reactivate = row.getByRole('button', { name: 'Reactivate Lena Berg' });
    expect(document.activeElement).toBe(reactivate);
  });

  it('changes nothing on Cancel and returns focus to the button', async () => {
    const fetchMock = stubUsers();
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Lena Berg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: /Deactivate Lena Berg\?/ })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Deactivate Lena Berg' }),
    );
    expect(requests(fetchMock, 'PATCH')).toEqual([]);
  });

  it('reactivates after confirmation', async () => {
    const fetchMock = stubUsers({
      patch: [jsonResponse(200, { user: { ...MARA, isActive: true } })],
    });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Mara Jensen' }));
    const question = screen.getByRole('group', { name: /Reactivate Mara Jensen\?/ });
    fireEvent.click(within(question).getByRole('button', { name: 'Yes, reactivate' }));

    expect(await screen.findByText('Mara Jensen was reactivated.')).toBeTruthy();
    expect(requests(fetchMock, 'PATCH')).toEqual([
      { url: '/api/v1/users/u3', body: { isActive: true } },
    ]);
    expect(within(rowFor('Mara Jensen')).getByText('Active')).toBeTruthy();
  });

  it('shows a server refusal in an alert and closes the question', async () => {
    stubUsers({
      patch: [
        errorBody(409, 'LAST_ADMIN', 'The last active admin cannot be demoted or deactivated'),
      ],
    });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Lena Berg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, deactivate' }));

    const alert = await within(rowFor('Lena Berg')).findByRole('alert');
    expect(alert.textContent).toBe('The last active admin cannot be demoted or deactivated');
    // Checked at once, without waitFor: focus must already be back when the alert appears
    // (CD-47).
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Deactivate Lena Berg' }),
    );
    expect(screen.queryByRole('group', { name: /Deactivate Lena Berg\?/ })).toBeNull();
    expect(within(rowFor('Lena Berg')).getByText('Active')).toBeTruthy();
  });

  it('returns focus to the button at once when a reactivation is refused', async () => {
    const fetchMock = stubUsers({
      patch: [
        errorBody(
          409,
          'USER_CONFLICT',
          'The user was changed by someone else. Reload the list and try again.',
        ),
      ],
    });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Mara Jensen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, reactivate' }));

    const alert = await within(rowFor('Mara Jensen')).findByRole('alert');
    expect(alert.textContent).toBe(
      'The user was changed by someone else. Reload the list and try again.',
    );
    // No waitFor: the refusal arrives after an await, and focus must move in the same commit
    // that closes the question (CD-47).
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Reactivate Mara Jensen' }),
    );
    expect(screen.queryByRole('group', { name: /Reactivate Mara Jensen\?/ })).toBeNull();
    expect(requests(fetchMock, 'PATCH')).toEqual([
      { url: '/api/v1/users/u3', body: { isActive: true } },
    ]);
    expect(within(rowFor('Mara Jensen')).getByText('Deactivated')).toBeTruthy();
  });

  it('shows a network failure in an alert', async () => {
    stubUsers({ patch: [new TypeError('Failed to fetch')] });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Lena Berg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, deactivate' }));

    expect((await within(rowFor('Lena Berg')).findByRole('alert')).textContent).toBe(
      'Could not reach the ClinicDesk API.',
    );
  });
});

describe('on narrow screens', () => {
  it('shows one card per user instead of the table, with the same controls', async () => {
    stubViewport(360);
    const fetchMock = stubUsers({
      patch: [jsonResponse(200, { user: { ...LENA, role: 'customer' } })],
    });
    renderApp('/admin/users');

    const list = await screen.findByRole('list', { name: 'Users, sorted by name' });
    expect(screen.queryByRole('table')).toBeNull();
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);

    const own = within(cards[0]);
    expect(own.getByRole('heading', { level: 2, name: 'Anton Admin You' })).toBeTruthy();
    expect(own.queryByRole('button')).toBeNull();
    expect(own.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Email',
      'Role',
      'Status',
      'Created',
    ]);

    const lena = within(cards[1]);
    expect(lena.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      'lena@example.com',
      'Active',
      '02.11.2026',
    ]);
    fireEvent.change(lena.getByLabelText('Role for Lena Berg'), { target: { value: 'customer' } });
    fireEvent.click(lena.getByRole('button', { name: 'Save role for Lena Berg' }));

    expect(await screen.findByText('Lena Berg is now a customer.')).toBeTruthy();
    expect(requests(fetchMock, 'PATCH')[0].body).toEqual({ role: 'customer' });
    expect(within(cards[1]).getByRole('button', { name: 'Deactivate Lena Berg' })).toBeTruthy();
  });

  it('uses cards below the desktop breakpoint and the table from it', async () => {
    const viewport = stubViewport(800);
    stubUsers();
    renderApp('/admin/users');

    expect(await screen.findByRole('list', { name: 'Users, sorted by name' })).toBeTruthy();

    act(() => viewport.setWidth(1280));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Users, sorted by name' })).toBeNull();
  });
});
