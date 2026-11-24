import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

const LENA = { id: 'a1', name: 'Lena Berg' };
const OMAR = { id: 'a2', name: 'Omar Haddad' };
const ADMIN = { id: 'ad1', name: 'Anton Admin' };

const baseTicket = {
  id: '6651b2a7c3d4e5f6a7b8c9d1',
  title: 'Printer in reception not working',
  description: 'It shows error E-12.',
  category: 'it',
  priority: 'high',
  status: 'in_progress',
  allowedNextStatuses: [],
  createdBy: { id: 'u1', name: 'Mara Jensen' },
  assignee: null,
  createdAt: '2026-12-01T09:15:00.000Z',
};

function ticketWith(fields) {
  return { ...baseTicket, ...fields };
}

function assignmentText() {
  return document.querySelector('.assignee-line').textContent;
}

function login(user, role) {
  storeSession('jwt-token', { ...user, role });
}

function assignForm() {
  return screen.queryByRole('form', { name: 'Ticket assignment' });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('assignment for agents', () => {
  it('claims an unassigned ticket with "Assign to me"', async () => {
    login(LENA, 'agent');
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
      jsonResponse(200, { ticket: ticketWith({ assignee: LENA }) }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Assign to me' }));

    expect(await screen.findByText('Assigned to Lena Berg.')).toBeTruthy();
    expect(assignmentText()).toBe('Assigned to Lena Berg');
    expect(screen.getByRole('button', { name: 'Unassign me' })).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`/api/v1/tickets/${baseTicket.id}/assignee`);
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body)).toEqual({ assignee: LENA.id });
  });

  it('releases their own assignment with "Unassign me"', async () => {
    login(LENA, 'agent');
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: LENA }) }),
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Unassign me' }));

    expect(await screen.findByText('Ticket unassigned.')).toBeTruthy();
    expect(assignmentText()).toBe('Unassigned');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ assignee: null });
  });

  it('offers "Assign to me" on a ticket assigned to someone else', async () => {
    login(LENA, 'agent');
    stubFetch(jsonResponse(200, { ticket: ticketWith({ assignee: OMAR }) }));
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByRole('button', { name: 'Assign to me' })).toBeTruthy();
    expect(assignmentText()).toBe('Assigned to Omar Haddad');
    expect(screen.queryByRole('button', { name: 'Unassign me' })).toBeNull();
  });

  it('shows the error and keeps the assignee when the change fails', async () => {
    login(LENA, 'agent');
    stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
      jsonResponse(409, {
        error: {
          code: 'ASSIGNEE_CONFLICT',
          message: 'The ticket was changed by someone else. Reload the ticket and try again.',
        },
      }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    const button = await screen.findByRole('button', { name: 'Assign to me' });
    fireEvent.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'The ticket was changed by someone else. Reload the ticket and try again.',
    );
    expect(assignmentText()).toBe('Unassigned');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBe('assign-error');
  });

  it('shows a saving state', async () => {
    login(LENA, 'agent');
    let resolve;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ticket: ticketWith({ assignee: null }) }))
      .mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    vi.stubGlobal('fetch', fetchMock);
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Assign to me' }));

    const saving = await screen.findByRole('button', { name: 'Saving...' });
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute('aria-busy')).toBe('true');

    resolve(jsonResponse(200, { ticket: ticketWith({ assignee: LENA }) }));
    expect(await screen.findByRole('button', { name: 'Unassign me' })).toBeTruthy();
  });
});

describe('assignment for admins', () => {
  it('assigns an agent from the select', async () => {
    login(ADMIN, 'admin');
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
      jsonResponse(200, { items: [ADMIN, LENA, OMAR] }),
      jsonResponse(200, { ticket: ticketWith({ assignee: OMAR }) }),
      jsonResponse(200, { items: [ADMIN, LENA, OMAR] }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    const select = await screen.findByLabelText('Assign to');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ['', 'Unassigned'],
      ['ad1', 'Anton Admin'],
      ['a1', 'Lena Berg'],
      ['a2', 'Omar Haddad'],
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/users/agents');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.disabled).toBe(true);

    fireEvent.change(select, { target: { value: OMAR.id } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(await screen.findByText('Assigned to Omar Haddad.')).toBeTruthy();
    expect(assignmentText()).toBe('Assigned to Omar Haddad');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ assignee: OMAR.id });
    expect((await screen.findByLabelText('Assign to')).value).toBe(OMAR.id);
  });

  it('unassigns with the "Unassigned" option', async () => {
    login(ADMIN, 'admin');
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: LENA }) }),
      jsonResponse(200, { items: [LENA, OMAR] }),
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
      jsonResponse(200, { items: [LENA, OMAR] }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    const select = await screen.findByLabelText('Assign to');
    expect(select.value).toBe(LENA.id);

    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Ticket unassigned.')).toBeTruthy();
    expect(assignmentText()).toBe('Unassigned');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ assignee: null });
  });

  it('keeps a current assignee who is no longer in the agent list', async () => {
    login(ADMIN, 'admin');
    const former = { id: 'x9', name: 'Former Agent' };
    stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: former }) }),
      jsonResponse(200, { items: [LENA] }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    const select = await screen.findByLabelText('Assign to');
    expect(select.value).toBe('x9');
    expect(within(select).getByRole('option', { name: 'Former Agent' })).toBeTruthy();
  });

  it('shows the field message from a 400', async () => {
    login(ADMIN, 'admin');
    stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
      jsonResponse(200, { items: [LENA] }),
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [{ field: 'assignee', message: 'Assignee must be an active agent or admin' }],
        },
      }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.change(await screen.findByLabelText('Assign to'), { target: { value: LENA.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Assignee must be an active agent or admin',
    );
    expect(assignmentText()).toBe('Unassigned');
  });

  it('shows a loading state and an error with retry for the agent list', async () => {
    login(ADMIN, 'admin');
    stubFetch(
      jsonResponse(200, { ticket: ticketWith({ assignee: null }) }),
      new TypeError('Failed to fetch'),
      jsonResponse(200, { items: [LENA] }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('Loading agents...')).toBeTruthy();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Assign to')).toBeTruthy();
  });
});

describe('assignment for customers and closed tickets', () => {
  it('shows only the assignee to a customer', async () => {
    login({ id: 'u1', name: 'Mara Jensen' }, 'customer');
    const fetchMock = stubFetch(jsonResponse(200, { ticket: ticketWith({ assignee: LENA }) }));
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('Assigned to Lena Berg')).toBeTruthy();
    expect(assignForm()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['agent', LENA],
    ['admin', ADMIN],
  ])('shows no control to an %s on a closed ticket', async (role, user) => {
    login(user, role);
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith({ status: 'closed', assignee: LENA }) }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('Assigned to Lena Berg')).toBeTruthy();
    expect(assignForm()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
