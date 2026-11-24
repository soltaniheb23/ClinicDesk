import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, requestsTo, storeSession, stubApi } from '../test/helpers.jsx';

const MARA = { id: 'u1', name: 'Mara Jensen', role: 'customer' };
const LENA = { id: 'a1', name: 'Lena Berg', role: 'agent' };
const ANTON = { id: 'ad1', name: 'Anton Weber', role: 'admin' };

const baseTicket = {
  id: '6651b2a7c3d4e5f6a7b8c9d1',
  title: 'Printer in reception not working',
  description: 'It shows error E-12.',
  category: 'it',
  priority: 'high',
  status: 'in_progress',
  allowedNextStatuses: [],
  createdBy: { id: MARA.id, name: MARA.name },
  assignee: null,
  createdAt: '2026-12-01T09:00:00.000Z',
};

const TICKET = `GET /api/v1/tickets/${baseTicket.id}`;
const COMMENTS = `GET /api/v1/tickets/${baseTicket.id}/comments`;
const POST_COMMENT = `POST /api/v1/tickets/${baseTicket.id}/comments`;

// Local times, so the expected "dd.mm.yyyy, hh:mm" text does not depend on the time zone.
const at = (hours, minutes) => new Date(2026, 11, 1, hours, minutes).toISOString();

let commentCount = 0;
function comment(author, body, { internal = false, createdAt = at(9, 5) } = {}) {
  commentCount += 1;
  return {
    id: `c${commentCount}`,
    ticket: baseTicket.id,
    author,
    body,
    internal,
    createdAt,
  };
}

const publicComments = [
  comment(MARA, 'It is still broken.', { createdAt: at(9, 5) }),
  comment(LENA, 'We are replacing the toner today.\nPlease wait.', { createdAt: at(10, 30) }),
];
const internalNote = comment(LENA, 'Toner is empty, ordered a new one.', {
  internal: true,
  createdAt: at(10, 0),
});

function login(user) {
  storeSession('jwt-token', user);
}

function ticketResponse(fields = {}) {
  return jsonResponse(200, { ticket: { ...baseTicket, ...fields } });
}

function thread() {
  return screen.getByRole('region', { name: 'Comments' });
}

function items() {
  return within(thread()).queryAllByRole('listitem');
}

function commentTextarea() {
  return screen.getByRole('textbox', { name: 'Add a comment' });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('comment list', () => {
  it('shows a customer the comments oldest first with author, role and time', async () => {
    login(MARA);
    const fetchMock = stubApi({
      [TICKET]: ticketResponse(),
      [COMMENTS]: jsonResponse(200, { items: publicComments }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('It is still broken.')).toBeTruthy();
    const [first, second] = items();
    expect(within(first).getByText('Mara Jensen')).toBeTruthy();
    expect(within(first).getByText('Customer')).toBeTruthy();
    const time = within(first).getByText('01.12.2026, 09:05');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('dateTime')).toBe(publicComments[0].createdAt);

    expect(within(second).getByText('Lena Berg')).toBeTruthy();
    expect(within(second).getByText('Agent')).toBeTruthy();
    expect(within(second).getByText('01.12.2026, 10:30')).toBeTruthy();
    expect(second.querySelector('.comment-body').textContent).toBe(
      'We are replacing the toner today.\nPlease wait.',
    );

    expect(within(thread()).queryByText('Internal note')).toBeNull();
    expect(requestsTo(fetchMock, COMMENTS)[0].init.headers.Authorization).toBe('Bearer jwt-token');
  });

  it.each([
    ['an agent', LENA],
    ['an admin', ANTON],
  ])('marks internal notes for %s', async (_label, user) => {
    login(user);
    stubApi({
      [TICKET]: ticketResponse(),
      [COMMENTS]: jsonResponse(200, {
        items: [publicComments[0], internalNote, publicComments[1]],
      }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    await screen.findByText('Toner is empty, ordered a new one.');
    const [first, note, last] = items();
    expect(note.className).toBe('comment comment-internal');
    expect(within(note).getByText('Internal note').className).toBe('badge badge-internal');
    expect(first.className).toBe('comment');
    expect(last.className).toBe('comment');
    expect(within(first).queryByText('Internal note')).toBeNull();
  });

  it('renders comment text as plain text, never as HTML', async () => {
    login(MARA);
    const html = '<img src=x onerror="alert(1)"><b>bold</b>';
    stubApi({
      [TICKET]: ticketResponse(),
      [COMMENTS]: jsonResponse(200, { items: [comment(MARA, html)] }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    const body = await screen.findByText(html);
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
  });

  it('shows "Deleted user" when the author no longer exists', async () => {
    login(LENA);
    stubApi({
      [TICKET]: ticketResponse(),
      [COMMENTS]: jsonResponse(200, { items: [comment(null, 'Old comment')] }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('Deleted user')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    login(MARA);
    stubApi({ [TICKET]: ticketResponse() });
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('No comments yet.')).toBeTruthy();
    expect(items()).toEqual([]);
  });

  it('shows a loading state, then an error with retry', async () => {
    login(MARA);
    stubApi({
      [TICKET]: ticketResponse(),
      [COMMENTS]: [
        new TypeError('Failed to fetch'),
        jsonResponse(200, { items: [publicComments[0]] }),
      ],
    });
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('Loading comments...')).toBeTruthy();

    const alert = await within(await screen.findByRole('region', { name: 'Comments' })).findByRole(
      'alert',
    );
    expect(alert.textContent).toContain('Could not reach the ClinicDesk API.');
    // No form while the thread could not be loaded.
    expect(screen.queryByRole('form', { name: 'Add a comment' })).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('It is still broken.')).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Add a comment' })).toBeTruthy();
  });
});

describe('comment form', () => {
  it('lets a customer post a comment, appends it and clears the field', async () => {
    login(MARA);
    const posted = comment(MARA, 'Any news?', { createdAt: at(11, 0) });
    const fetchMock = stubApi({
      [TICKET]: ticketResponse(),
      [COMMENTS]: jsonResponse(200, { items: publicComments }),
      [POST_COMMENT]: jsonResponse(201, { comment: posted }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    const textarea = await screen.findByRole('textbox', { name: 'Add a comment' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('0 / 2000')).toBeTruthy();
    expect(textarea.getAttribute('maxLength')).toBe('2000');
    expect(textarea.getAttribute('aria-describedby')).toBe('comment-body-count');

    fireEvent.change(textarea, { target: { value: 'Any news?' } });
    expect(screen.getByText('9 / 2000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(await screen.findByText('Any news?', { selector: '.comment-body' })).toBeTruthy();
    expect(items().map((item) => item.querySelector('.comment-body').textContent)).toEqual([
      'It is still broken.',
      'We are replacing the toner today.\nPlease wait.',
      'Any news?',
    ]);
    expect(commentTextarea().value).toBe('');
    expect(screen.getByText('0 / 2000')).toBeTruthy();

    const [post] = requestsTo(fetchMock, POST_COMMENT);
    expect(post.body).toEqual({ body: 'Any news?', internal: false });
    expect(post.init.headers.Authorization).toBe('Bearer jwt-token');
  });

  it.each([
    ['an agent', LENA],
    ['an admin', ANTON],
  ])('lets %s post an internal note', async (_label, user) => {
    login(user);
    const posted = comment(user, 'Checked the logs.', { internal: true, createdAt: at(11, 0) });
    const fetchMock = stubApi({
      [TICKET]: ticketResponse(),
      [POST_COMMENT]: jsonResponse(201, { comment: posted }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    const checkbox = await screen.findByRole('checkbox', { name: /Internal note/ });
    expect(checkbox.checked).toBe(false);

    fireEvent.change(commentTextarea(), { target: { value: 'Checked the logs.' } });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    const body = await screen.findByText('Checked the logs.', { selector: '.comment-body' });
    expect(within(body.closest('li')).getByText('Internal note')).toBeTruthy();
    expect(requestsTo(fetchMock, POST_COMMENT)[0].body).toEqual({
      body: 'Checked the logs.',
      internal: true,
    });
    // Reset for the next comment.
    expect(screen.getByRole('checkbox', { name: /Internal note/ }).checked).toBe(false);
  });

  it('lets an agent post a public reply by default', async () => {
    login(LENA);
    const fetchMock = stubApi({
      [TICKET]: ticketResponse(),
      [POST_COMMENT]: jsonResponse(201, { comment: comment(LENA, 'On it.') }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Add a comment' }), {
      target: { value: 'On it.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await screen.findByText('On it.', { selector: '.comment-body' });
    expect(requestsTo(fetchMock, POST_COMMENT)[0].body).toEqual({
      body: 'On it.',
      internal: false,
    });
  });

  it('does not send an empty comment', async () => {
    login(MARA);
    const fetchMock = stubApi({ [TICKET]: ticketResponse() });
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Add a comment' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Write a comment first.');
    expect(commentTextarea().getAttribute('aria-invalid')).toBe('true');
    expect(requestsTo(fetchMock, POST_COMMENT)).toEqual([]);
  });

  it('shows a saving state', async () => {
    login(MARA);
    let resolve;
    stubApi({
      [TICKET]: ticketResponse(),
      [POST_COMMENT]: () => new Promise((done) => (resolve = done)),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Add a comment' }), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    const button = await screen.findByRole('button', { name: 'Posting...' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(commentTextarea().disabled).toBe(true);

    resolve(jsonResponse(201, { comment: comment(MARA, 'Hello') }));
    expect(await screen.findByRole('button', { name: 'Post comment' })).toBeTruthy();
  });

  it('shows the server error and keeps the text', async () => {
    login(MARA);
    stubApi({
      [TICKET]: ticketResponse(),
      [POST_COMMENT]: jsonResponse(409, {
        error: { code: 'TICKET_CLOSED', message: 'A closed ticket does not accept comments' },
      }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Add a comment' }), {
      target: { value: 'Hello?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A closed ticket does not accept comments',
    );
    expect(commentTextarea().value).toBe('Hello?');
    expect(commentTextarea().getAttribute('aria-describedby')).toBe(
      'comment-body-count comment-error',
    );
    expect(items()).toEqual([]);
  });

  it('shows the field message from a 400', async () => {
    login(MARA);
    stubApi({
      [TICKET]: ticketResponse(),
      [POST_COMMENT]: jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [{ field: 'body', message: 'Comment must be at most 2000 characters' }],
        },
      }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Add a comment' }), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Comment must be at most 2000 characters',
    );
  });
});

describe('closed tickets', () => {
  it.each([
    ['a customer', MARA],
    ['an agent', LENA],
  ])('shows the thread but no form to %s', async (_label, user) => {
    login(user);
    stubApi({
      [TICKET]: ticketResponse({ status: 'closed' }),
      [COMMENTS]: jsonResponse(200, { items: publicComments }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByText('It is still broken.')).toBeTruthy();
    expect(
      screen.getByText('This ticket is closed, so it does not accept new comments.'),
    ).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Add a comment' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
  });

  it('removes the form when the ticket is closed on the page', async () => {
    login(MARA);
    stubApi({
      [TICKET]: ticketResponse({ status: 'resolved', allowedNextStatuses: ['closed'] }),
      [`PATCH /api/v1/tickets/${baseTicket.id}/status`]: ticketResponse({
        status: 'closed',
        allowedNextStatuses: [],
      }),
    });
    renderApp(`/tickets/${baseTicket.id}`);

    expect(await screen.findByRole('form', { name: 'Add a comment' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close ticket' }));

    expect(
      await screen.findByText('This ticket is closed, so it does not accept new comments.'),
    ).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Add a comment' })).toBeNull();
  });
});
