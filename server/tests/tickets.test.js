const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');
const User = require('../src/models/User');
const Ticket = require('../src/models/Ticket');
const { signToken } = require('../src/auth/token');

const validTicket = {
  title: 'Printer in reception not working',
  description: 'It shows error E-12 since this morning.',
  category: 'it',
  priority: 'high',
};

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init()]);
}, 120000);

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Ticket.deleteMany({})]);
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
  return { user, token: signToken(user) };
}

function createTicket(token, body = validTicket) {
  return request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send(body);
}

function listTickets(token, query = '') {
  return request(app).get(`/api/v1/tickets${query}`).set('Authorization', `Bearer ${token}`);
}

function getTicket(token, id) {
  return request(app).get(`/api/v1/tickets/${id}`).set('Authorization', `Bearer ${token}`);
}

// Inserts tickets with distinct, increasing createdAt values (index 0 is the oldest).
async function seedTickets(owner, count, startAt = Date.UTC(2026, 11, 1)) {
  return Ticket.insertMany(
    Array.from({ length: count }, (_, index) => ({
      ...validTicket,
      title: `Ticket ${index + 1}`,
      createdBy: owner._id,
      createdAt: new Date(startAt + index * 60000),
    })),
  );
}

const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };

describe('authentication', () => {
  it.each([
    ['POST /api/v1/tickets', () => request(app).post('/api/v1/tickets').send(validTicket)],
    ['GET /api/v1/tickets', () => request(app).get('/api/v1/tickets')],
    [
      'GET /api/v1/tickets/:id',
      () => request(app).get(`/api/v1/tickets/${new mongoose.Types.ObjectId()}`),
    ],
  ])('%s returns 401 without a token', async (_label, send) => {
    const response = await send();

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(await Ticket.countDocuments()).toBe(0);
  });
});

describe('POST /api/v1/tickets', () => {
  it('creates a ticket owned by the logged-in user', async () => {
    const { user, token } = await createUser();

    const response = await createTicket(token);

    expect(response.status).toBe(201);
    expect(response.body.ticket).toMatchObject({
      ...validTicket,
      status: 'open',
      createdBy: { id: user.id, name: user.name },
      assignee: null,
    });
    expect(response.body.ticket.id).toEqual(expect.any(String));
    expect(response.body.ticket.createdAt).toEqual(expect.any(String));
    expect(response.body.ticket).not.toHaveProperty('_id');

    const stored = await Ticket.findById(response.body.ticket.id);
    expect(stored.createdBy.toString()).toBe(user.id);
  });

  it.each(['customer', 'agent', 'admin'])('lets a %s create a ticket', async (role) => {
    const { token } = await createUser(role);

    expect((await createTicket(token)).status).toBe(201);
  });

  it('ignores createdBy, status, assignee and other unknown keys from the client', async () => {
    const { user, token } = await createUser();
    const { user: someoneElse } = await createUser();

    const response = await createTicket(token, {
      ...validTicket,
      createdBy: someoneElse.id,
      status: 'closed',
      assignee: someoneElse.id,
      resolvedAt: '2026-01-01T00:00:00.000Z',
      isAdmin: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.ticket).toMatchObject({
      createdBy: { id: user.id, name: user.name },
      status: 'open',
      assignee: null,
      resolvedAt: null,
    });
    expect(response.body.ticket).not.toHaveProperty('isAdmin');
  });

  it('trims text and defaults category to other and priority to normal', async () => {
    const { token } = await createUser();

    const response = await createTicket(token, {
      title: '  Door badge reader  ',
      description: '  Badge reader at the back door is offline.  ',
    });

    expect(response.status).toBe(201);
    expect(response.body.ticket).toMatchObject({
      title: 'Door badge reader',
      description: 'Badge reader at the back door is offline.',
      category: 'other',
      priority: 'normal',
    });
  });

  it.each([
    ['a missing title', { ...validTicket, title: undefined }, 'title', 'Title is required'],
    ['a blank title', { ...validTicket, title: '   ' }, 'title', 'Title is required'],
    [
      'a title over 120 characters',
      { ...validTicket, title: 'x'.repeat(121) },
      'title',
      'Title must be at most 120 characters',
    ],
    [
      'a missing description',
      { ...validTicket, description: undefined },
      'description',
      'Description is required',
    ],
    [
      'a description over 5000 characters',
      { ...validTicket, description: 'x'.repeat(5001) },
      'description',
      'Description must be at most 5000 characters',
    ],
    [
      'an invalid category',
      { ...validTicket, category: 'plumbing' },
      'category',
      'Choose a valid category',
    ],
    [
      'an invalid priority',
      { ...validTicket, priority: 'critical' },
      'priority',
      'Choose a valid priority',
    ],
    ['a non-string title', { ...validTicket, title: 42 }, 'title', 'Title is required'],
  ])('returns 400 with details for %s', async (_label, body, field, message) => {
    const { token } = await createUser();

    const response = await createTicket(token, body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Some fields are invalid',
    });
    expect(response.body.error.details).toContainEqual({ field, message });
    expect(await Ticket.countDocuments()).toBe(0);
  });

  it('accepts a 5000-character description in a multi-byte script', async () => {
    const { token } = await createUser();

    const response = await createTicket(token, { ...validTicket, description: 'é'.repeat(5000) });

    expect(response.status).toBe(201);
  });

  it('returns 413 for an oversized body', async () => {
    const { token } = await createUser();

    const response = await createTicket(token, {
      ...validTicket,
      description: 'x'.repeat(40 * 1024),
    });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('GET /api/v1/tickets', () => {
  it('paginates newest first with page, limit, total and totalPages', async () => {
    const { user, token } = await createUser();
    await seedTickets(user, 7);

    const first = await listTickets(token, '?limit=3');
    const second = await listTickets(token, '?page=2&limit=3');
    const last = await listTickets(token, '?page=3&limit=3');

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, limit: 3, total: 7, totalPages: 3 });
    expect(first.body.items.map((ticket) => ticket.title)).toEqual([
      'Ticket 7',
      'Ticket 6',
      'Ticket 5',
    ]);
    expect(second.body).toMatchObject({ page: 2, limit: 3, total: 7, totalPages: 3 });
    expect(second.body.items.map((ticket) => ticket.title)).toEqual([
      'Ticket 4',
      'Ticket 3',
      'Ticket 2',
    ]);
    expect(last.body.items.map((ticket) => ticket.title)).toEqual(['Ticket 1']);
  });

  it('defaults to page 1 and 10 per page', async () => {
    const { user, token } = await createUser();
    await seedTickets(user, 12);

    const response = await listTickets(token);

    expect(response.body).toMatchObject({ page: 1, limit: 10, total: 12, totalPages: 2 });
    expect(response.body.items).toHaveLength(10);
  });

  it('breaks createdAt ties by _id, newest first', async () => {
    const { user, token } = await createUser();
    const sameTime = new Date(Date.UTC(2026, 11, 1));
    const inserted = await Ticket.insertMany(
      ['A', 'B', 'C'].map((title) => ({
        ...validTicket,
        title,
        createdBy: user._id,
        createdAt: sameTime,
      })),
    );
    const expected = [...inserted]
      .sort((a, b) => (a._id.toString() < b._id.toString() ? 1 : -1))
      .map((ticket) => ticket.title);

    const response = await listTickets(token);

    expect(response.body.items.map((ticket) => ticket.title)).toEqual(expected);
  });

  it('returns an empty page past the end', async () => {
    const { user, token } = await createUser();
    await seedTickets(user, 2);

    const response = await listTickets(token, '?page=5');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ items: [], page: 5, total: 2, totalPages: 1 });
  });

  it('returns totalPages 0 when there are no tickets', async () => {
    const { token } = await createUser();

    const response = await listTickets(token);

    expect(response.body).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it('shows a customer only their own tickets', async () => {
    const me = await createUser();
    const other = await createUser();
    await seedTickets(me.user, 2);
    await seedTickets(other.user, 3);

    const response = await listTickets(me.token);

    expect(response.body.total).toBe(2);
    expect(response.body.items.every((ticket) => ticket.createdBy.id === me.user.id)).toBe(true);
  });

  it.each(['agent', 'admin'])("shows an %s everyone's tickets", async (role) => {
    const staff = await createUser(role);
    const alice = await createUser();
    const bob = await createUser();
    await seedTickets(alice.user, 2);
    await seedTickets(bob.user, 3);

    const response = await listTickets(staff.token);

    expect(response.body.total).toBe(5);
    const owners = new Set(response.body.items.map((ticket) => ticket.createdBy.id));
    expect(owners).toEqual(new Set([alice.user.id, bob.user.id]));
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['page=', 'page'],
    ['page=1&page=2', 'page'],
    ['limit=0', 'limit'],
    ['limit=51', 'limit'],
    ['limit=ten', 'limit'],
  ])('returns 400 for ?%s', async (query, field) => {
    const { token } = await createUser();

    const response = await listTickets(token, `?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
  });

  it('populates users as { id, name } only', async () => {
    const owner = await createUser();
    const agent = await createUser('agent');
    await Ticket.create({ ...validTicket, createdBy: owner.user._id, assignee: agent.user._id });

    const response = await listTickets(agent.token);
    const [ticket] = response.body.items;

    expect(ticket.createdBy).toEqual({ id: owner.user.id, name: owner.user.name });
    expect(ticket.assignee).toEqual({ id: agent.user.id, name: agent.user.name });
    expect(JSON.stringify(response.body)).not.toMatch(/email|passwordHash|not-a-real-hash/);
  });

  it('shows a new ticket immediately after creating it', async () => {
    const { token } = await createUser();
    const created = await createTicket(token);

    const response = await listTickets(token);

    expect(response.body.items[0].id).toBe(created.body.ticket.id);
  });
});

describe('GET /api/v1/tickets/:id', () => {
  it('returns the ticket to its owner with users as { id, name }', async () => {
    const { user, token } = await createUser();
    const created = await createTicket(token);

    const response = await getTicket(token, created.body.ticket.id);

    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({
      id: created.body.ticket.id,
      ...validTicket,
      status: 'open',
      createdBy: { id: user.id, name: user.name },
      assignee: null,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/email|passwordHash|not-a-real-hash/);
  });

  it("returns the same 404 for another customer's ticket, an unknown id and an invalid id", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const created = await createTicket(alice.token);

    const responses = await Promise.all([
      getTicket(bob.token, created.body.ticket.id),
      getTicket(bob.token, new mongoose.Types.ObjectId().toString()),
      getTicket(bob.token, 'not-an-id'),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND_BODY);
    }
  });

  it.each(['agent', 'admin'])('lets an %s open any ticket', async (role) => {
    const customer = await createUser();
    const staff = await createUser(role);
    const created = await createTicket(customer.token);

    const response = await getTicket(staff.token, created.body.ticket.id);

    expect(response.status).toBe(200);
    expect(response.body.ticket.createdBy).toEqual({
      id: customer.user.id,
      name: customer.user.name,
    });
  });

  it('populates the assignee as { id, name } only', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await Ticket.create({
      ...validTicket,
      createdBy: customer.user._id,
      assignee: agent.user._id,
    });

    const response = await getTicket(customer.token, ticket.id);

    expect(response.body.ticket.assignee).toEqual({ id: agent.user.id, name: agent.user.name });
    expect(Object.keys(response.body.ticket.createdBy).sort()).toEqual(['id', 'name']);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get(`/api/v1/tickets/${new mongoose.Types.ObjectId()}`);

    expect(response.status).toBe(401);
  });
});
