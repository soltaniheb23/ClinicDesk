const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');
const User = require('../src/models/User');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const { signToken } = require('../src/auth/token');

const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
const FORBIDDEN_BODY = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init(), Comment.init()]);
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([User.deleteMany({}), Ticket.deleteMany({}), Comment.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

let userCount = 0;
async function createUser(role = 'customer') {
  userCount += 1;
  const user = await User.create({
    name: `${role} ${userCount}`,
    email: `${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
  });
  return { user, id: user.id, token: signToken(user) };
}

function createTicket(owner, fields = {}) {
  return Ticket.create({
    title: 'Printer in reception not working',
    description: 'It shows error E-12.',
    createdBy: owner._id,
    ...fields,
  });
}

function listComments(token, id) {
  return request(app).get(`/api/v1/tickets/${id}/comments`).set('Authorization', `Bearer ${token}`);
}

function postComment(token, id, body) {
  return request(app)
    .post(`/api/v1/tickets/${id}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

// Creates comments directly with increasing createdAt values (oldest first).
async function seedThread(ticket, entries) {
  const start = Date.parse('2026-12-01T09:00:00.000Z');
  for (const [index, [author, body, internal]] of entries.entries()) {
    const at = new Date(start + index * 60000);
    await Comment.create({
      ticket: ticket._id,
      author: author._id,
      body,
      internal,
      createdAt: at,
      updatedAt: at,
    });
  }
}

async function storedFirstResponse(ticketId) {
  return (await Ticket.findById(ticketId)).firstResponseAt;
}

describe('GET /api/v1/tickets/:id/comments', () => {
  async function threadSetup() {
    const customer = await createUser();
    const agent = await createUser('agent');
    const admin = await createUser('admin');
    const ticket = await createTicket(customer.user);
    await seedThread(ticket, [
      [customer.user, 'It is still broken.', false],
      [agent.user, 'Toner is empty, ordered a new one.', true],
      [agent.user, 'We are replacing the toner today.', false],
      [admin.user, 'Supplier confirmed delivery.', true],
    ]);
    return { customer, agent, admin, ticket };
  }

  it('shows a customer only the public comments, oldest first', async () => {
    const { customer, ticket } = await threadSetup();

    const response = await listComments(customer.token, ticket.id);

    expect(response.status).toBe(200);
    expect(response.body.items.map((comment) => comment.body)).toEqual([
      'It is still broken.',
      'We are replacing the toner today.',
    ]);
    expect(response.body.items.every((comment) => comment.internal === false)).toBe(true);
  });

  it('filters internal notes in the database query for customers', async () => {
    const { customer, ticket } = await threadSetup();
    const find = jest.spyOn(Comment, 'find');

    await listComments(customer.token, ticket.id);

    expect(find).toHaveBeenCalledWith({ ticket: ticket._id, internal: false });
  });

  it.each(['agent', 'admin'])('shows an %s every comment, oldest first', async (role) => {
    const setup = await threadSetup();

    const response = await listComments(setup[role].token, setup.ticket.id);

    expect(response.status).toBe(200);
    expect(response.body.items.map((comment) => [comment.body, comment.internal])).toEqual([
      ['It is still broken.', false],
      ['Toner is empty, ordered a new one.', true],
      ['We are replacing the toner today.', false],
      ['Supplier confirmed delivery.', true],
    ]);
  });

  it('keeps insertion order for comments with the same timestamp', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);
    const at = new Date('2026-12-01T09:00:00.000Z');
    for (const body of ['first', 'second', 'third']) {
      await Comment.create({ ticket: ticket._id, author: customer.user._id, body, createdAt: at });
    }

    const response = await listComments(customer.token, ticket.id);

    expect(response.body.items.map((comment) => comment.body)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('returns the comment shape with author { id, name, role } and no email', async () => {
    const { customer, agent, ticket } = await threadSetup();

    const response = await listComments(agent.token, ticket.id);

    expect(response.body.items[0]).toEqual({
      id: expect.any(String),
      ticket: ticket.id,
      author: { id: customer.id, name: customer.user.name, role: 'customer' },
      body: 'It is still broken.',
      internal: false,
      createdAt: '2026-12-01T09:00:00.000Z',
    });
    expect(JSON.stringify(response.body)).not.toContain('@');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('returns author null when the author account was deleted', async () => {
    const { customer, agent, ticket } = await threadSetup();
    await User.deleteOne({ _id: agent.user._id });

    const response = await listComments(customer.token, ticket.id);

    expect(response.status).toBe(200);
    expect(response.body.items[1]).toMatchObject({
      body: 'We are replacing the toner today.',
      author: null,
    });
  });

  it('returns an empty list for a ticket without comments', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await listComments(customer.token, ticket.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('only lists comments of the requested ticket', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);
    const other = await createTicket(customer.user);
    await seedThread(other, [[customer.user, 'Other ticket', false]]);

    const response = await listComments(customer.token, ticket.id);

    expect(response.body.items).toEqual([]);
  });

  it('returns the same 404 for another customer’s ticket', async () => {
    const { ticket } = await threadSetup();
    const stranger = await createUser();

    const response = await listComments(stranger.token, ticket.id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it.each([
    ['an invalid id', 'not-an-id'],
    ['an unknown id', new mongoose.Types.ObjectId().toString()],
  ])('returns the same 404 for %s', async (_label, id) => {
    const agent = await createUser('agent');

    const response = await listComments(agent.token, id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('returns 401 without a token', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await request(app).get(`/api/v1/tickets/${ticket.id}/comments`);

    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/tickets/:id/comments', () => {
  it('lets a customer comment on their own ticket', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await postComment(customer.token, ticket.id, {
      body: '  Still broken after the restart.  ',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      comment: {
        id: expect.any(String),
        ticket: ticket.id,
        author: { id: customer.id, name: customer.user.name, role: 'customer' },
        body: 'Still broken after the restart.',
        internal: false,
        createdAt: expect.any(String),
      },
    });
    expect(await Comment.countDocuments({ ticket: ticket._id })).toBe(1);
  });

  it.each(['agent', 'admin'])('lets an %s write an internal note', async (role) => {
    const customer = await createUser();
    const staff = await createUser(role);
    const ticket = await createTicket(customer.user);

    const response = await postComment(staff.token, ticket.id, {
      body: 'Toner is empty.',
      internal: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.comment.internal).toBe(true);
    expect(response.body.comment.author).toEqual({ id: staff.id, name: staff.user.name, role });
  });

  it('takes author, ticket and createdAt from the server, never from the body', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);
    const otherTicket = await createTicket(customer.user);
    const before = Date.now();

    const response = await postComment(customer.token, ticket.id, {
      body: 'Hello',
      author: agent.id,
      ticket: otherTicket.id,
      role: 'admin',
      createdAt: '2000-01-01T00:00:00.000Z',
      isInternal: true,
    });

    expect(response.status).toBe(201);
    const stored = await Comment.findById(response.body.comment.id);
    expect(stored.author.toString()).toBe(customer.id);
    expect(stored.ticket.toString()).toBe(ticket.id);
    expect(stored.internal).toBe(false);
    expect(stored.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(response.body.comment.author.role).toBe('customer');
  });

  it('returns 403 when a customer sends internal: true', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await postComment(customer.token, ticket.id, {
      body: 'Secret',
      internal: true,
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN_BODY);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it.each([
    ['a missing body', {}, 'Comment is required'],
    ['an empty body', { body: '' }, 'Comment is required'],
    ['a whitespace-only body', { body: '   \n  ' }, 'Comment is required'],
    ['a non-string body', { body: 42 }, 'Comment is required'],
    [
      'a 2001-character body',
      { body: 'a'.repeat(2001) },
      'Comment must be at most 2000 characters',
    ],
  ])('returns 400 for %s', async (_label, body, message) => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await postComment(customer.token, ticket.id, body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: [{ field: 'body', message }],
      },
    });
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('accepts exactly 2000 characters', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await postComment(customer.token, ticket.id, { body: 'a'.repeat(2000) });

    expect(response.status).toBe(201);
  });

  it('returns 400 for a non-boolean internal value', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await postComment(agent.token, ticket.id, { body: 'Hi', internal: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      { field: 'internal', message: 'Internal must be true or false' },
    ]);
  });

  it('validates the body before the internal-note rule (400 before 403)', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await postComment(customer.token, ticket.id, { body: '', internal: true });

    expect(response.status).toBe(400);
  });

  it.each(['customer', 'agent'])(
    'returns 409 when the %s comments on a closed ticket',
    async (role) => {
      const customer = await createUser();
      const actor = role === 'customer' ? customer : await createUser(role);
      const ticket = await createTicket(customer.user, { status: 'closed' });

      const response = await postComment(actor.token, ticket.id, { body: 'Hello?' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: { code: 'TICKET_CLOSED', message: 'A closed ticket does not accept comments' },
      });
      expect(await Comment.countDocuments()).toBe(0);
    },
  );

  it('checks the internal-note rule before the closed rule (403 before 409)', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user, { status: 'closed' });

    const response = await postComment(customer.token, ticket.id, {
      body: 'Hello',
      internal: true,
    });

    expect(response.status).toBe(403);
  });

  it('accepts comments on resolved tickets', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user, { status: 'resolved' });

    const response = await postComment(customer.token, ticket.id, { body: 'Works now, thanks.' });

    expect(response.status).toBe(201);
  });

  it('returns the same 404 for another customer’s ticket', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const ticket = await createTicket(owner.user);

    const response = await postComment(stranger.token, ticket.id, { body: 'Hi' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('checks visibility before the body (404 before 400)', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const ticket = await createTicket(owner.user);

    const response = await postComment(stranger.token, ticket.id, {});

    expect(response.status).toBe(404);
  });

  it.each([
    ['an invalid id', 'not-an-id'],
    ['an unknown id', new mongoose.Types.ObjectId().toString()],
  ])('returns the same 404 for %s', async (_label, id) => {
    const agent = await createUser('agent');

    const response = await postComment(agent.token, id, { body: 'Hi' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('returns 401 without a token', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .send({ body: 'Hi' });

    expect(response.status).toBe(401);
  });
});

describe('firstResponseAt', () => {
  it.each(['agent', 'admin'])('is set by the first public %s comment', async (role) => {
    const customer = await createUser();
    const staff = await createUser(role);
    const ticket = await createTicket(customer.user);

    const response = await postComment(staff.token, ticket.id, { body: 'On it.' });

    expect(response.status).toBe(201);
    const firstResponseAt = await storedFirstResponse(ticket.id);
    expect(firstResponseAt.toISOString()).toBe(response.body.comment.createdAt);
  });

  it('is not set by an internal note', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    await postComment(agent.token, ticket.id, { body: 'Looking into it.', internal: true });

    expect(await storedFirstResponse(ticket.id)).toBeNull();
  });

  it('is not set by a customer comment', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    await postComment(customer.token, ticket.id, { body: 'Any news?' });

    expect(await storedFirstResponse(ticket.id)).toBeNull();
  });

  it('is not overwritten by a later staff comment', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const admin = await createUser('admin');
    const ticket = await createTicket(customer.user);

    const first = await postComment(agent.token, ticket.id, { body: 'On it.' });
    await postComment(admin.token, ticket.id, { body: 'Following up.' });
    await postComment(agent.token, ticket.id, { body: 'Done.' });

    expect((await storedFirstResponse(ticket.id)).toISOString()).toBe(first.body.comment.createdAt);
  });

  it('keeps an existing firstResponseAt', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const earlier = new Date('2026-12-01T09:40:00.000Z');
    const ticket = await createTicket(customer.user, { firstResponseAt: earlier });

    await postComment(agent.token, ticket.id, { body: 'Another reply.' });

    expect((await storedFirstResponse(ticket.id)).toISOString()).toBe(earlier.toISOString());
  });

  it('is set exactly once when two agents reply at the same time', async () => {
    const customer = await createUser();
    const first = await createUser('agent');
    const second = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const responses = await Promise.all([
      postComment(first.token, ticket.id, { body: 'Reply one' }),
      postComment(second.token, ticket.id, { body: 'Reply two' }),
    ]);

    const createdAts = responses.map((response) => response.body.comment.createdAt);
    const stored = (await storedFirstResponse(ticket.id)).toISOString();
    expect(createdAts).toContain(stored);
  });

  it('shows up in the ticket detail', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const posted = await postComment(agent.token, ticket.id, { body: 'On it.' });
    const detail = await request(app)
      .get(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${customer.token}`);

    expect(detail.body.ticket.firstResponseAt).toBe(posted.body.comment.createdAt);
  });
});
