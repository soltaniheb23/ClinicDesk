import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

const ticket = {
  id: '6651b2a7c3d4e5f6a7b8c9d1',
  title: 'Printer in reception not working',
  description: 'It shows error E-12 since this morning.\nTried turning it off and on.',
  category: 'it',
  priority: 'high',
  status: 'open',
  createdBy: { id: 'u1', name: 'Mara Jensen' },
  assignee: null,
  createdAt: '2026-12-01T09:15:00.000Z',
  updatedAt: '2026-12-01T09:15:00.000Z',
};

beforeEach(() => {
  window.sessionStorage.clear();
  storeSession('jwt-token', { id: 'u1', name: 'Mara Jensen', role: 'customer' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TicketDetailPage', () => {
  it('renders the ticket read-only', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { ticket }));
    renderApp(`/tickets/${ticket.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: ticket.title })).toBeTruthy();
    expect(screen.getByText('Open').className).toBe('badge badge-status-open');
    expect(screen.getByText('High').className).toBe('badge badge-priority-high');

    const meta = document.querySelector('dl.ticket-meta');
    expect(within(meta).getByText('IT')).toBeTruthy();
    expect(within(meta).getByText('Mara Jensen')).toBeTruthy();
    expect(within(meta).getByText('01.12.2026')).toBeTruthy();

    expect(screen.getByRole('region', { name: 'Assignment' }).textContent).toBe('Unassigned');

    const description = screen.getByRole('region', { name: 'Description' });
    expect(description.textContent).toContain('Tried turning it off and on.');

    expect(screen.getByRole('link', { name: 'Back to tickets' }).getAttribute('href')).toBe(
      '/tickets',
    );
    // A customer on an open ticket gets no status or assignment controls; the only other
    // buttons are the attachment upload (CD-18) and the comment form's.
    expect(await screen.findByText('No comments yet.')).toBeTruthy();
    expect(await screen.findByText('No attachments yet.')).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Log out',
      'Upload',
      'Post comment',
    ]);

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/tickets/${ticket.id}`);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');
  });

  it('shows the assignee name when assigned', async () => {
    stubFetch(jsonResponse(200, { ticket: { ...ticket, assignee: { id: 'a1', name: 'Lena' } } }));
    renderApp(`/tickets/${ticket.id}`);

    expect(await screen.findByText('Assigned to Lena')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Ticket assignment' })).toBeNull();
  });

  it('shows "Ticket not found" on a 404', async () => {
    stubFetch(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Ticket not found' } }));
    renderApp('/tickets/6651b2a7c3d4e5f6a7b8c9d9');

    expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to tickets' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the friendly error on a network problem and retries', async () => {
    stubFetch(new TypeError('Failed to fetch'), jsonResponse(200, { ticket }));
    renderApp(`/tickets/${ticket.id}`);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: ticket.title })).toBeTruthy();
  });

  it('does not treat /tickets/new as a ticket id', () => {
    stubFetch();
    renderApp('/tickets/new');

    expect(screen.getByRole('heading', { name: 'New ticket' })).toBeTruthy();
  });
});
