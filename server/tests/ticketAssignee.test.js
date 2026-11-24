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

const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
const FORBIDDEN_BODY = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};
const BAD_ASSIGNEE_BODY = {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Some fields are invalid',
    details: [{ field: 'assignee', message: 'Assignee must be an active agent or admin' }],
  },
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
async function createUser(role = 'customer', fields = {}) {
  userCount += 1;
  const user = await User.create({
    name: `${role} ${userCount}`,
    email: `${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
    ...fields,
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

function assign(token, id, body) {
  return request(app)
    .patch(`/api/v1/tickets/${id}/assignee`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function storedAssignee(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  return ticket.assignee ? ticket.assignee.toString() : null;
}

describe('PATCH /api/v1/tickets/:id/assignee as an agent', () => {
  it('lets an agent claim an unassigned ticket', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await assign(agent.token, ticket.id, { assignee: agent.id });

    expect(response.status).toBe(200);
    expect(response.body.ticket.assignee).toEqual({ id: agent.id, name: agent.user.name });
    expect(response.body.ticket.allowedNextStatuses).toEqual(['in_progress']);
    expect(await storedAssignee(ticket.id)).toBe(agent.id);
  });

  it('lets an agent claim a ticket assigned to someone else', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const other = await createUser('agent');
    const ticket = await createTicket(customer.user, { assignee: other.user._id });

    const response = await assign(agent.token, ticket.id, { assignee: agent.id });

    expect(response.status).toBe(200);
    expect(await storedAssignee(ticket.id)).toBe(agent.id);
  });

  it.each([
    ['another agent', 'agent'],
    ['an admin', 'admin'],
  ])('does not let an agent assign %s', async (_label, role) => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const target = await createUser(role);
    const ticket = await createTicket(customer.user);

    const response = await assign(agent.token, ticket.id, { assignee: target.id });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN_BODY);
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it('lets an agent release their own assignment', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user, { assignee: agent.user._id });

    const response = await assign(agent.token, ticket.id, { assignee: null });

    expect(response.status).toBe(200);
    expect(response.body.ticket.assignee).toBeNull();
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it('does not let an agent release someone else’s assignment', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const other = await createUser('agent');
    const ticket = await createTicket(customer.user, { assignee: other.user._id });

    const response = await assign(agent.token, ticket.id, { assignee: null });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN_BODY);
    expect(await storedAssignee(ticket.id)).toBe(other.id);
  });

  it('does not let an agent "release" an unassigned ticket', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await assign(agent.token, ticket.id, { assignee: null });

    expect(response.status).toBe(403);
  });

  it('checks the assignee before the agent rule (400 before 403)', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const otherCustomer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await assign(agent.token, ticket.id, { assignee: otherCustomer.id });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(BAD_ASSIGNEE_BODY);
  });
});

describe('PATCH /api/v1/tickets/:id/assignee as an admin', () => {
  it.each(['agent', 'admin'])('assigns any active %s', async (role) => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const target = await createUser(role);
    const ticket = await createTicket(customer.user);

    const response = await assign(admin.token, ticket.id, { assignee: target.id });

    expect(response.status).toBe(200);
    expect(response.body.ticket.assignee).toEqual({ id: target.id, name: target.user.name });
    expect(await storedAssignee(ticket.id)).toBe(target.id);
  });

  it('reassigns from one agent to another', async () => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const first = await createUser('agent');
    const second = await createUser('agent');
    const ticket = await createTicket(customer.user, { assignee: first.user._id });

    const response = await assign(admin.token, ticket.id, { assignee: second.id });

    expect(response.status).toBe(200);
    expect(await storedAssignee(ticket.id)).toBe(second.id);
  });

  it('unassigns a ticket', async () => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user, { assignee: agent.user._id });

    const response = await assign(admin.token, ticket.id, { assignee: null });

    expect(response.status).toBe(200);
    expect(response.body.ticket.assignee).toBeNull();
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it('never returns emails in the ticket', async () => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const response = await assign(admin.token, ticket.id, { assignee: agent.id });

    expect(JSON.stringify(response.body)).not.toContain('@');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });
});

describe('PATCH /api/v1/tickets/:id/assignee validation', () => {
  it.each([
    ['a customer', async () => (await createUser()).id],
    ['an inactive agent', async () => (await createUser('agent', { isActive: false })).id],
    ['an inactive admin', async () => (await createUser('admin', { isActive: false })).id],
    ['an unknown user', async () => new mongoose.Types.ObjectId().toString()],
  ])('returns 400 when the assignee is %s', async (_label, makeAssignee) => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const ticket = await createTicket(customer.user);

    const response = await assign(admin.token, ticket.id, { assignee: await makeAssignee() });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(BAD_ASSIGNEE_BODY);
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it.each([
    ['a missing assignee', {}],
    ['an invalid id', { assignee: 'not-an-id' }],
    ['a number', { assignee: 42 }],
    ['an object', { assignee: { id: 'x' } }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_label, body) => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const ticket = await createTicket(customer.user);

    const response = await assign(admin.token, ticket.id, body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'assignee', message: 'Assignee must be a user id or null' },
    ]);
  });
});

describe('PATCH /api/v1/tickets/:id/assignee access', () => {
  it('returns 401 without a token', async () => {
    const customer = await createUser();
    const ticket = await createTicket(customer.user);

    const response = await request(app)
      .patch(`/api/v1/tickets/${ticket.id}/assignee`)
      .send({ assignee: null });

    expect(response.status).toBe(401);
  });

  it('returns 403 to a customer on their own ticket, even with a bad body', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user);

    for (const body of [{ assignee: agent.id }, { assignee: customer.id }, {}]) {
      const response = await assign(customer.token, ticket.id, body);
      expect(response.status).toBe(403);
      expect(response.body).toEqual(FORBIDDEN_BODY);
    }
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it('returns the same 404 to a customer for another customer’s ticket', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const ticket = await createTicket(owner.user);

    const response = await assign(stranger.token, ticket.id, { assignee: null });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it.each([
    ['an invalid id', 'not-an-id'],
    ['an unknown id', new mongoose.Types.ObjectId().toString()],
  ])('returns the same 404 for %s', async (_label, id) => {
    const agent = await createUser('agent');

    const response = await assign(agent.token, id, { assignee: agent.id });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });
});

describe('PATCH /api/v1/tickets/:id/assignee conflicts', () => {
  it.each([
    ['an agent claiming', 'agent'],
    ['an admin assigning', 'admin'],
  ])('returns 409 TICKET_CLOSED for %s a closed ticket', async (_label, role) => {
    const customer = await createUser();
    const actor = await createUser(role);
    const ticket = await createTicket(customer.user, { status: 'closed' });

    const response = await assign(actor.token, ticket.id, { assignee: actor.id });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'TICKET_CLOSED', message: 'A closed ticket cannot be reassigned' },
    });
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it('returns 409 ASSIGNEE_CONFLICT when the assignee changed after it was read', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const other = await createUser('agent');
    const ticket = await createTicket(customer.user);

    // Another request assigns the ticket between our read and our conditional update.
    const original = Ticket.findOneAndUpdate.bind(Ticket);
    jest.spyOn(Ticket, 'findOneAndUpdate').mockImplementation((...args) => {
      const query = original(...args);
      const exec = query.exec.bind(query);
      query.exec = async () => {
        await Ticket.collection.updateOne(
          { _id: ticket._id },
          { $set: { assignee: other.user._id } },
        );
        return exec();
      };
      return query;
    });

    const response = await assign(agent.token, ticket.id, { assignee: agent.id });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'ASSIGNEE_CONFLICT',
        message: 'The ticket was changed by someone else. Reload the ticket and try again.',
      },
    });
    expect(await storedAssignee(ticket.id)).toBe(other.id);
  });

  it('returns 409 ASSIGNEE_CONFLICT when the ticket was closed after it was read', async () => {
    const customer = await createUser();
    const admin = await createUser('admin');
    const agent = await createUser('agent');
    const ticket = await createTicket(customer.user, { status: 'resolved' });

    const original = Ticket.findOneAndUpdate.bind(Ticket);
    jest.spyOn(Ticket, 'findOneAndUpdate').mockImplementation((...args) => {
      const query = original(...args);
      const exec = query.exec.bind(query);
      query.exec = async () => {
        await Ticket.collection.updateOne({ _id: ticket._id }, { $set: { status: 'closed' } });
        return exec();
      };
      return query;
    });

    const response = await assign(admin.token, ticket.id, { assignee: agent.id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ASSIGNEE_CONFLICT');
    expect(await storedAssignee(ticket.id)).toBeNull();
  });

  it('never loses an update when two agents claim at the same time', async () => {
    const customer = await createUser();
    const first = await createUser('agent');
    const second = await createUser('agent');
    const ticket = await createTicket(customer.user);

    const responses = await Promise.all([
      assign(first.token, ticket.id, { assignee: first.id }),
      assign(second.token, ticket.id, { assignee: second.id }),
    ]);

    // Each request either wins (200) or is told it lost (409 ASSIGNEE_CONFLICT). Both may
    // win only if the second read the ticket after the first had saved (a takeover).
    const winners = responses.filter((response) => response.status === 200);
    const losers = responses.filter((response) => response.status !== 200);
    expect(winners.length).toBeGreaterThan(0);
    for (const response of losers) {
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ASSIGNEE_CONFLICT');
    }
    const winnerIds = winners.map((response) => response.body.ticket.assignee.id);
    expect(winnerIds).toContain(await storedAssignee(ticket.id));
  });
});

describe('GET /api/v1/users/agents', () => {
  function getAgents(token) {
    const call = request(app).get('/api/v1/users/agents');
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  }

  it.each(['agent', 'admin'])('lists active agents and admins for an %s', async (role) => {
    const caller = await createUser(role, { name: 'Caller' });
    const agent = await createUser('agent', { name: 'Lena Berg' });
    const admin = await createUser('admin', { name: 'Anton Admin' });
    await createUser('agent', { name: 'Inactive Agent', isActive: false });
    await createUser('customer', { name: 'Mara Jensen' });

    const response = await getAgents(caller.token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        { id: admin.id, name: 'Anton Admin' },
        { id: caller.id, name: 'Caller' },
        { id: agent.id, name: 'Lena Berg' },
      ],
    });
  });

  it('returns only id and name', async () => {
    const admin = await createUser('admin');

    const response = await getAgents(admin.token);

    expect(Object.keys(response.body.items[0]).sort()).toEqual(['id', 'name']);
    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('returns 403 to a customer', async () => {
    const customer = await createUser();

    const response = await getAgents(customer.token);

    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN_BODY);
  });

  it('returns 401 without a token', async () => {
    const response = await getAgents();

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});
