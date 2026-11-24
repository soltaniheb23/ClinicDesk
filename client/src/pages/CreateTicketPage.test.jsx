import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, storeSession, stubFetch } from '../test/helpers.jsx';

const user = { id: 'u1', name: 'Mara Jensen', role: 'customer' };
const createdTicket = {
  id: 't1',
  title: 'Printer in reception not working',
  description: 'It shows error E-12 since this morning.',
  category: 'it',
  priority: 'high',
  status: 'open',
  createdBy: 'u1',
  assignee: null,
  createdAt: '2026-12-01T09:15:00.000Z',
};

function fill({ title, description, category, priority }) {
  if (title !== undefined) {
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
  }
  if (description !== undefined) {
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: description } });
  }
  if (category !== undefined) {
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: category } });
  }
  if (priority !== undefined) {
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: priority } });
  }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  storeSession('jwt-token', user);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CreateTicketPage', () => {
  it('renders the wireframe fields with IT and Normal preselected', () => {
    stubFetch();
    renderApp('/tickets/new');

    expect(screen.getByRole('heading', { name: 'New ticket' })).toBeTruthy();
    expect(screen.getByLabelText('Title').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Category').value).toBe('it');
    expect(screen.getByLabelText('Priority').value).toBe('normal');
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/tickets');
  });

  it('blocks an empty title on the client', () => {
    const fetchMock = stubFetch();
    renderApp('/tickets/new');

    fill({ title: '   ', description: 'Something is broken.' });
    submit();

    const title = screen.getByLabelText('Title');
    const error = screen.getByText('Title is required');
    expect(error.getAttribute('role')).toBe('alert');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toContain(error.id);
    expect(document.activeElement).toBe(title);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a description', () => {
    const fetchMock = stubFetch();
    renderApp('/tickets/new');

    fill({ title: 'Printer', description: '' });
    submit();

    expect(screen.getByText('Description is required')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the right body with the token and redirects to /tickets', async () => {
    const fetchMock = stubFetch(
      jsonResponse(201, { ticket: createdTicket }),
      jsonResponse(200, { items: [createdTicket] }),
    );
    renderApp('/tickets/new');

    fill({
      title: '  Printer in reception not working ',
      description: 'It shows error E-12 since this morning.',
      category: 'it',
      priority: 'high',
    });
    submit();

    expect(
      await screen.findByText('Ticket created: Printer in reception not working'),
    ).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/tickets');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/tickets');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(options.body)).toEqual({
      title: 'Printer in reception not working',
      description: 'It shows error E-12 since this morning.',
      category: 'it',
      priority: 'high',
    });

    // The list is read again, so the new ticket is visible straight away.
    expect(await screen.findByRole('cell', { name: createdTicket.title })).toBeTruthy();
  });

  it('shows backend field errors next to each field', async () => {
    stubFetch(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [
            { field: 'title', message: 'Title must be at most 120 characters' },
            { field: 'category', message: 'Choose a valid category' },
          ],
        },
      }),
    );
    renderApp('/tickets/new');

    fill({ title: 'Printer', description: 'Broken.' });
    submit();

    const titleError = await screen.findByText('Title must be at most 120 characters');
    expect(screen.getByLabelText('Title').getAttribute('aria-describedby')).toContain(
      titleError.id,
    );
    const categoryError = screen.getByText('Choose a valid category');
    expect(screen.getByLabelText('Category').getAttribute('aria-describedby')).toBe(
      categoryError.id,
    );
    expect(screen.getByTestId('location').textContent).toBe('/tickets/new');
  });

  it('shows the friendly message on a network error and re-enables Submit', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    renderApp('/tickets/new');

    fill({ title: 'Printer', description: 'Broken.' });
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not reach the ClinicDesk API.',
    );
    expect(screen.getByRole('button', { name: 'Submit' }).disabled).toBe(false);
  });

  it('disables Submit and shows progress while saving', async () => {
    let resolve;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((done) => (resolve = done))),
    );
    renderApp('/tickets/new');

    fill({ title: 'Printer', description: 'Broken.' });
    submit();

    const button = screen.getByRole('button', { name: 'Submitting...' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    resolve(jsonResponse(201, { ticket: createdTicket }));
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeTruthy();
  });

  it('is only reachable when logged in', () => {
    window.sessionStorage.clear();
    stubFetch();
    renderApp('/tickets/new');

    expect(screen.getByTestId('location').textContent).toBe('/login');
  });
});
