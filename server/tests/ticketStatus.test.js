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
const { STATUSES } = require('../src/tickets/statusWorkflow');

const ALLOWED = [
  ['open', 'in_progress'],
  ['in_progress', 'waiting'],
  ['in_progress', 'resolved'],
  ['waiting', 'in_progress'],
  ['waiting', 'resolved'],
  ['resolved', 'closed'],
  ['resolved', 'in_progress'],
];
const isAllowed = (from, to) => ALLOWED.some(([a, b]) => a === from && b === to);
const allPairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to]));
const notAllowed = allPairs.filter(([from, to]) => !isAllowed(from, to));

const LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};
const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
const FORBIDDEN_BODY = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init()]);
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
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

function createTicket(owner, fields = {}) {
  return Ticket.create({
    title: 'Printer in reception not working',
    description: 'It shows error E-12.',
    createdBy: owner._id,
    ...fields,
  });
}

function changeStatus(token, id, body) {
  return request(app)
    .patch(`/api/v1/tickets/${id}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe.each(['agent', 'admin'])('PATCH /api/v1/tickets/:id/status as an %s', (role) => {
  it.each(ALLOWED)('allows %s -> %s', async (from, to) => {
    const customer = await createUser();
    const staff = await createUser(role);
    const ticket = await createTicket(customer.user, { status: from });

    const response = await changeStatus(staff.token, ticket.id, { status: to });

    expect(response.status).toBe(200);
    expect(response.body.ticket.status).toBe(to);
    expect((await Ticket.findById(ticket.id)).status).toBe(to);
  });

  it.each(notAllowed)('returns 409 for %s -> %s', async (from, to) => {
    const customer = await createUser();
    const staff = await createUser(role);
    const ticket = await createTicket(customer.user, { status: from });

    const response = await changeStatus(staff.token, ticket.id, { status: to });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_TRANSITION',
        message: `Cannot change status from ${LABELS[from]} to ${LABELS[to]}`,
      },
    });
    expect((await Ticket.findById(ticket.id)).status).toBe(from);
  });

  it('may change a ticket assigned to someone else', async () => {
    const customer = await createUser();
    const staff = await createUser(role);
    const other = await createUser('agent');
    const ticket = await createTicket(customer.user, { assignee: other.user._id });

    const response = await changeStatus(staff.token, ticket.id, { status: 'in_progress' });

    expect(response.status).toBe(200);
  });
});

describe('PATCH /api/v1/tickets/:id/status as a customer', () => {
  it('lets a customer close their own resolved ticket', async () => {
    const { user, token } = await createUser();
    const ticket = await createTicket(user, { status: 'resolved', resolvedAt: new Date() });

    const response = await changeStatus(token, ticket.id, { status: 'closed' });

    expect(response.status).toBe(200);
    expect(response.body.ticket.status).toBe('closed');
    expect(response.body.ticket.allowedNextStatuses).toEqual([]);
  });

  const customerCases = allPairs
    .filter(([from, to]) => !(from === 'resolved' && to === 'closed'))
    .map(([from, to]) => [from, to, isAllowed(from, to) ? 403 : 409]);

  it.each(customerCases)('refuses %s -> %s on their own ticket with %i', async (from, to, code) => {
    const { user, token } = await createUser();
    const ticket = await createTicket(user, { status: from });

    const response = await changeStatus(token, ticket.id, { status: to });

    expect(response.status).toBe(code);
    if (code === 403) expect(response.body).toEqual(FORBIDDEN_BODY);
    else expect(response.body.error.code).toBe('INVALID_TRANSITION');
    expect((await Ticket.findById(ticket.id)).status).toBe(from);
  });

  it("returns 404 for another customer's ticket, even for an allowed change", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const ticket = await createTicket(alice.user, { status: 'resolved' });

    const response = await changeStatus(bob.token, ticket.id, { status: 'closed' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
    expect((await Ticket.findById(ticket.id)).status).toBe('resolved');
  });
});

describe('PATCH /api/v1/tickets/:id/status validation and order of checks', () => {
  it('returns 401 without a token', async () => {
    const response = await request(app)
      .patch(`/api/v1/tickets/${new mongoose.Types.ObjectId()}/status`)
      .send({ status: 'closed' });

    expect(response.status).toBe(401);
  });

  it('returns the same 404 for an invalid id and an unknown ticket', async () => {
    const agent = await createUser('agent');

    const invalid = await changeStatus(agent.token, 'not-an-id', { status: 'in_progress' });
    const unknown = await changeStatus(agent.token, new mongoose.Types.ObjectId(), {
      status: 'in_progress',
    });

    expect(invalid.status).toBe(404);
    expect(invalid.body).toEqual(NOT_FOUND_BODY);
    expect(unknown.body).toEqual(NOT_FOUND_BODY);
  });

  it.each([
    ['an unknown status', { status: 'archived' }],
    ['a missing status', {}],
    ['a non-string status', { status: 3 }],
  ])('returns 400 for %s', async (_label, body) => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await changeStatus(agent.token, ticket.id, body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('status');
  });

  it('returns 400 for a request without a body', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await request(app)
      .patch(`/api/v1/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${agent.token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('status');
    expect((await Ticket.findById(ticket.id)).status).toBe('open');
  });

  it("checks visibility before the body: a bad body on another customer's ticket is 404", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const ticket = await createTicket(alice.user);

    const response = await changeStatus(bob.token, ticket.id, { status: 'archived' });

    expect(response.status).toBe(404);
  });
});

describe('status side effects', () => {
  it('sets resolvedAt when resolved, keeps it when closed, and clears it when reopened', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user, { status: 'in_progress' });

    const before = Date.now();
    const resolved = await changeStatus(agent.token, ticket.id, { status: 'resolved' });
    const resolvedAt = new Date(resolved.body.ticket.resolvedAt).getTime();
    expect(resolvedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(resolvedAt).toBeLessThanOrEqual(Date.now() + 1000);

    const reopened = await changeStatus(agent.token, ticket.id, { status: 'in_progress' });
    expect(reopened.body.ticket.resolvedAt).toBeNull();
    expect((await Ticket.findById(ticket.id)).resolvedAt).toBeNull();

    await changeStatus(agent.token, ticket.id, { status: 'resolved' });
    const closed = await changeStatus(customer.token, ticket.id, { status: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.ticket.resolvedAt).not.toBeNull();
  });

  it('does not touch firstResponseAt', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await changeStatus(agent.token, ticket.id, { status: 'in_progress' });

    expect(response.body.ticket.firstResponseAt).toBeNull();
  });

  it('returns 409 when the status changed after it was read', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user, { status: 'in_progress' });

    // Another request resolves the ticket between our read and our update.
    const original = Ticket.findOneAndUpdate;
    jest.spyOn(Ticket, 'findOneAndUpdate').mockImplementationOnce(function (...args) {
      const query = original.apply(this, args);
      const exec = query.exec.bind(query);
      query.exec = async (...execArgs) => {
        await Ticket.collection.updateOne({ _id: ticket._id }, { $set: { status: 'resolved' } });
        return exec(...execArgs);
      };
      return query;
    });

    const response = await changeStatus(agent.token, ticket.id, { status: 'waiting' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STATUS_CONFLICT');
    expect((await Ticket.findById(ticket.id)).status).toBe('resolved');
  });

  it('applies only one of two simultaneous changes', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const admin = await createUser('admin');
    const ticket = await createTicket(customer.user, { status: 'in_progress' });

    const responses = await Promise.all([
      changeStatus(agent.token, ticket.id, { status: 'waiting' }),
      changeStatus(admin.token, ticket.id, { status: 'resolved' }),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200);
    expect((await Ticket.findById(ticket.id)).status).toBe(winner.body.ticket.status);
  });
});

describe('allowedNextStatuses in the detail response', () => {
  it.each([
    ['customer', 'open', []],
    ['customer', 'resolved', ['closed']],
    ['customer', 'closed', []],
    ['agent', 'open', ['in_progress']],
    ['agent', 'in_progress', ['waiting', 'resolved']],
    ['agent', 'resolved', ['closed', 'in_progress']],
    ['admin', 'waiting', ['in_progress', 'resolved']],
    ['admin', 'closed', []],
  ])('lists the next statuses for a %s on a %s ticket', async (role, status, expected) => {
    const owner = await createUser();
    const viewer = role === 'customer' ? owner : await createUser(role);
    const ticket = await createTicket(owner.user, { status });

    const response = await request(app)
      .get(`/api/v1/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.ticket.allowedNextStatuses).toEqual(expected);
  });

  it('is returned after a change too', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await changeStatus(agent.token, ticket.id, { status: 'in_progress' });

    expect(response.body.ticket.allowedNextStatuses).toEqual(['waiting', 'resolved']);
  });
});
