import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

const baseTicket = {
  id: '6651b2a7c3d4e5f6a7b8c9d1',
  title: 'Printer in reception not working',
  description: 'It shows error E-12.',
  category: 'it',
  priority: 'high',
  createdBy: { id: 'u1', name: 'Mara Jensen' },
  assignee: null,
  createdAt: '2026-12-01T09:15:00.000Z',
};

function ticketWith(status, allowedNextStatuses) {
  return { ...baseTicket, status, allowedNextStatuses };
}

function statusBadge() {
  return document.querySelector('.ticket-badges .badge[class*="badge-status-"]');
}

function login(role) {
  storeSession('jwt-token', { id: role === 'customer' ? 'u1' : 'a1', name: 'Someone', role });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('status control for agents and admins', () => {
  it('lists only the allowed next statuses and sends the PATCH', async () => {
    login('agent');
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith('in_progress', ['waiting', 'resolved']) }),
      jsonResponse(200, { ticket: ticketWith('resolved', ['closed', 'in_progress']) }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    const select = await screen.findByLabelText('Status');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ['waiting', 'Waiting'],
      ['resolved', 'Resolved'],
    ]);

    fireEvent.change(select, { target: { value: 'resolved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }));

    expect(await screen.findByText('Status changed to Resolved.')).toBeTruthy();
    expect(statusBadge().textContent).toBe('Resolved');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`/api/v1/tickets/${baseTicket.id}/status`);
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body)).toEqual({ status: 'resolved' });

    // The control now offers the next steps from the new status.
    const values = within(screen.getByLabelText('Status'))
      .getAllByRole('option')
      .map((option) => option.value);
    expect(values).toEqual(['closed', 'in_progress']);
  });

  it('shows a loading state while saving', async () => {
    login('admin');
    let resolve;
    const ticketResponses = [
      Promise.resolve(jsonResponse(200, { ticket: ticketWith('open', ['in_progress']) })),
      new Promise((done) => (resolve = done)),
    ];
    // The admin's assignment control also loads the agent list; answer it separately.
    const fetchMock = vi.fn((url) =>
      url === '/api/v1/users/agents'
        ? Promise.resolve(jsonResponse(200, { items: [] }))
        : ticketResponses.shift(),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Change status' }));

    const button = screen.getByRole('button', { name: 'Saving...' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByLabelText('Status').disabled).toBe(true);

    resolve(jsonResponse(200, { ticket: ticketWith('in_progress', ['waiting', 'resolved']) }));
    expect(await screen.findByText('Status changed to In progress.')).toBeTruthy();
  });

  it('shows the backend message on a 409 and keeps the old badge', async () => {
    login('agent');
    stubFetch(
      jsonResponse(200, { ticket: ticketWith('in_progress', ['waiting', 'resolved']) }),
      jsonResponse(409, {
        error: {
          code: 'STATUS_CONFLICT',
          message: 'The status was changed by someone else. Reload the ticket and try again.',
        },
      }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Change status' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'The status was changed by someone else. Reload the ticket and try again.',
    );
    expect(statusBadge().textContent).toBe('In progress');
    expect(screen.getByRole('button', { name: 'Change status' }).disabled).toBe(false);
    expect(screen.queryByText(/Status changed to/)).toBeNull();
  });

  it('shows no control for a closed ticket', async () => {
    login('admin');
    stubFetch(jsonResponse(200, { ticket: ticketWith('closed', []) }));
    renderApp(`/tickets/${baseTicket.id}`);

    await screen.findByRole('heading', { level: 1, name: baseTicket.title });
    expect(screen.queryByRole('form', { name: 'Ticket status' })).toBeNull();
    expect(screen.queryByLabelText('Status')).toBeNull();
  });
});

describe('status control for customers', () => {
  it('shows Close ticket on a resolved ticket and closes it', async () => {
    login('customer');
    const fetchMock = stubFetch(
      jsonResponse(200, { ticket: ticketWith('resolved', ['closed']) }),
      jsonResponse(200, { ticket: ticketWith('closed', []) }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    expect(screen.queryByLabelText('Status')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));

    expect(await screen.findByText('Status changed to Closed.')).toBeTruthy();
    expect(statusBadge().textContent).toBe('Closed');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: 'closed' });
    expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull();
  });

  it.each([
    ['open', []],
    ['in_progress', []],
    ['closed', []],
  ])('shows no control on a %s ticket', async (status, allowed) => {
    login('customer');
    stubFetch(jsonResponse(200, { ticket: ticketWith(status, allowed) }));
    renderApp(`/tickets/${baseTicket.id}`);

    await screen.findByRole('heading', { level: 1, name: baseTicket.title });
    expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Ticket status' })).toBeNull();
  });

  it('shows the backend message when closing fails', async () => {
    login('customer');
    stubFetch(
      jsonResponse(200, { ticket: ticketWith('resolved', ['closed']) }),
      jsonResponse(409, {
        error: {
          code: 'INVALID_TRANSITION',
          message: 'Cannot change status from Closed to Closed',
        },
      }),
    );
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot change status from Closed to Closed',
    );
    expect(statusBadge().textContent).toBe('Resolved');
  });
});
