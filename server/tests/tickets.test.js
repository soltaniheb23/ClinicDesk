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

function myTickets(token) {
  return request(app).get('/api/v1/tickets/mine').set('Authorization', `Bearer ${token}`);
}

describe('authentication', () => {
  it.each([
    ['POST /api/v1/tickets', () => request(app).post('/api/v1/tickets').send(validTicket)],
    ['GET /api/v1/tickets/mine', () => request(app).get('/api/v1/tickets/mine')],
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
      createdBy: user.id,
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
      createdBy: user.id,
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

describe('GET /api/v1/tickets/mine', () => {
  it('returns only my tickets, newest first', async () => {
    const me = await createUser();
    const other = await createUser();

    await createTicket(me.token, { ...validTicket, title: 'First' });
    await createTicket(other.token, { ...validTicket, title: 'Not mine' });
    await createTicket(me.token, { ...validTicket, title: 'Second' });
    await createTicket(me.token, { ...validTicket, title: 'Third' });

    const response = await myTickets(me.token);

    expect(response.status).toBe(200);
    expect(response.body.items.map((ticket) => ticket.title)).toEqual(['Third', 'Second', 'First']);
    expect(response.body.items.every((ticket) => ticket.createdBy === me.user.id)).toBe(true);
  });

  it('returns an empty list when I have no tickets', async () => {
    const { token } = await createUser();

    const response = await myTickets(token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('returns at most 50 tickets', async () => {
    const { user, token } = await createUser();
    await Ticket.insertMany(
      Array.from({ length: 55 }, (_, index) => ({
        ...validTicket,
        title: `Ticket ${index}`,
        createdBy: user._id,
      })),
    );

    const response = await myTickets(token);

    expect(response.body.items).toHaveLength(50);
  });

  it('shows a new ticket immediately after creating it', async () => {
    const { token } = await createUser();
    const created = await createTicket(token);

    const response = await myTickets(token);

    expect(response.body.items[0].id).toBe(created.body.ticket.id);
  });
});
