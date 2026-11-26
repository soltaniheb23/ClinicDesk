// SLA timer on tickets (CD-22, docs/sla.md): snapshot at creation, firstResponseAt and
// resolvedAt rules, the sla object per role, and the ?sla= list filter.
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
const { HOUR_MS, SLA_POLICY } = require('../src/sla/policy');

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
    email: `sla-${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
  });
  return { user, id: user.id, token: signToken(user) };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function postTicket(token, fields = {}) {
  return request(app)
    .post('/api/v1/tickets')
    .set(auth(token))
    .send({ title: 'Printer offline', description: 'Error E-12.', ...fields });
}

function postComment(token, id, body) {
  return request(app).post(`/api/v1/tickets/${id}/comments`).set(auth(token)).send(body);
}

function setStatus(token, id, status) {
  return request(app).patch(`/api/v1/tickets/${id}/status`).set(auth(token)).send({ status });
}

function list(token, query = '') {
  return request(app).get(`/api/v1/tickets${query}`).set(auth(token));
}

// A ticket stored directly, created `ageHours` ago with a "normal" SLA (8h / 72h).
function seedTicket(owner, { ageHours = 0, ...fields } = {}) {
  const createdAt = new Date(Date.now() - ageHours * HOUR_MS);
  return Ticket.create({
    title: 'Seeded ticket',
    description: 'Seeded.',
    priority: 'normal',
    createdBy: owner._id,
    createdAt,
    slaFirstResponseDueAt: new Date(createdAt.getTime() + 8 * HOUR_MS),
    slaResolutionDueAt: new Date(createdAt.getTime() + 72 * HOUR_MS),
    ...fields,
  });
}

const hoursAgo = (hours) => new Date(Date.now() - hours * HOUR_MS);

describe('SLA snapshot on create', () => {
  it.each(Object.keys(SLA_POLICY))('stores the %s due dates from createdAt', async (priority) => {
    const { token } = await createUser();

    const response = await postTicket(token, { priority });
    expect(response.status).toBe(201);

    const stored = await Ticket.findById(response.body.ticket.id).lean();
    const created = stored.createdAt.getTime();
    expect(created).toBe(Date.parse(response.body.ticket.createdAt));
    expect(stored.slaFirstResponseDueAt.getTime() - created).toBe(
      SLA_POLICY[priority].firstResponseHours * HOUR_MS,
    );
    expect(stored.slaResolutionDueAt.getTime() - created).toBe(
      SLA_POLICY[priority].resolutionHours * HOUR_MS,
    );
  });

  it('ignores SLA fields sent by the client', async () => {
    const { token } = await createUser('agent');

    const response = await postTicket(token, {
      priority: 'urgent',
      slaFirstResponseDueAt: '2099-01-01T00:00:00.000Z',
      slaResolutionDueAt: '2099-01-01T00:00:00.000Z',
      firstResponseAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
    });

    const stored = await Ticket.findById(response.body.ticket.id).lean();
    expect(stored.slaFirstResponseDueAt.getTime() - stored.createdAt.getTime()).toBe(HOUR_MS);
    expect(stored.firstResponseAt).toBeNull();
    expect(stored.createdAt.getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(stored.createdAt.getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it('returns the sla object to the agent who created the ticket', async () => {
    const { token } = await createUser('agent');

    const response = await postTicket(token, { priority: 'high' });

    expect(response.body.ticket.sla).toEqual({
      state: 'ok',
      kind: 'first_response',
      dueAt: expect.any(String),
    });
    expect(response.body.ticket).not.toHaveProperty('slaFirstResponseDueAt');
    expect(response.body.ticket).not.toHaveProperty('slaResolutionDueAt');
  });
});

describe('firstResponseAt', () => {
  async function setup() {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await seedTicket(customer.user);
    return { customer, agent, ticket };
  }

  const stored = async (id) => (await Ticket.findById(id).lean()).firstResponseAt;

  it('is set by the first public agent reply and not changed by a second one', async () => {
    const { agent, ticket } = await setup();
    const admin = await createUser('admin');

    const first = await postComment(agent.token, ticket.id, { body: 'Looking into it.' });
    expect((await stored(ticket.id)).toISOString()).toBe(first.body.comment.createdAt);

    await postComment(admin.token, ticket.id, { body: 'Second reply.' });
    expect((await stored(ticket.id)).toISOString()).toBe(first.body.comment.createdAt);
  });

  it('is set by a public admin reply', async () => {
    const { ticket } = await setup();
    const admin = await createUser('admin');

    await postComment(admin.token, ticket.id, { body: 'On it.' });
    expect(await stored(ticket.id)).not.toBeNull();
  });

  it('is not set by an internal note', async () => {
    const { agent, ticket } = await setup();

    await postComment(agent.token, ticket.id, { body: 'Check the toner.', internal: true });
    expect(await stored(ticket.id)).toBeNull();
  });

  it('is not set by a customer reply', async () => {
    const { customer, ticket } = await setup();

    await postComment(customer.token, ticket.id, { body: 'Any news?' });
    expect(await stored(ticket.id)).toBeNull();
  });

  it('is set only once when two agents reply at the same time', async () => {
    const { agent, ticket } = await setup();
    const other = await createUser('agent');

    const replies = await Promise.all([
      postComment(agent.token, ticket.id, { body: 'Reply A' }),
      postComment(other.token, ticket.id, { body: 'Reply B' }),
    ]);

    // Whichever update ran first wins; the other one matches nothing and changes nothing.
    const times = replies.map((reply) => reply.body.comment.createdAt);
    const firstResponseAt = (await stored(ticket.id)).toISOString();
    expect(times).toContain(firstResponseAt);

    await postComment(agent.token, ticket.id, { body: 'Reply C' });
    expect((await stored(ticket.id)).toISOString()).toBe(firstResponseAt);
  });

  it('moves the sla object from first_response to resolution', async () => {
    const { agent, ticket } = await setup();

    await postComment(agent.token, ticket.id, { body: 'Hello.' });
    const detail = await request(app).get(`/api/v1/tickets/${ticket.id}`).set(auth(agent.token));

    expect(detail.body.ticket.sla).toMatchObject({ state: 'ok', kind: 'resolution' });
  });
});

describe('resolvedAt', () => {
  it('is set on resolved, kept on closed and cleared on reopen', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await seedTicket(customer.user, {
      status: 'in_progress',
      firstResponseAt: hoursAgo(0),
    });

    const resolved = await setStatus(agent.token, ticket.id, 'resolved');
    expect(resolved.body.ticket.resolvedAt).not.toBeNull();
    expect(resolved.body.ticket.sla.state).toBe('met');

    const reopened = await setStatus(agent.token, ticket.id, 'in_progress');
    expect(reopened.body.ticket.resolvedAt).toBeNull();
    expect(reopened.body.ticket.sla).toMatchObject({ state: 'ok', kind: 'resolution' });

    await setStatus(agent.token, ticket.id, 'resolved');
    const firstResolvedAt = (await Ticket.findById(ticket.id).lean()).resolvedAt;
    const closed = await setStatus(customer.token, ticket.id, 'closed');
    expect(closed.status).toBe(200);
    expect((await Ticket.findById(ticket.id).lean()).resolvedAt).toEqual(firstResolvedAt);
  });

  it('is set on close when a resolved ticket has none', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const ticket = await seedTicket(customer.user, { status: 'resolved', resolvedAt: null });

    const closed = await setStatus(agent.token, ticket.id, 'closed');

    expect(closed.body.ticket.resolvedAt).not.toBeNull();
  });
});

describe('who sees the sla object', () => {
  async function setup() {
    const customer = await createUser();
    const ticket = await seedTicket(customer.user, { ageHours: 9 });
    return { customer, ticket };
  }

  it.each(['agent', 'admin'])('returns sla on list and detail for an %s', async (role) => {
    const { ticket } = await setup();
    const staff = await createUser(role);
    const expected = {
      state: 'breached',
      kind: 'first_response',
      dueAt: ticket.slaFirstResponseDueAt.toISOString(),
    };

    const listed = await list(staff.token);
    expect(listed.body.items[0].sla).toEqual(expected);

    const detail = await request(app).get(`/api/v1/tickets/${ticket.id}`).set(auth(staff.token));
    expect(detail.body.ticket.sla).toEqual(expected);
  });

  it('never returns SLA data to a customer (list, detail, create, status change)', async () => {
    const { customer, ticket } = await setup();
    await Ticket.updateOne({ _id: ticket._id }, { status: 'resolved', resolvedAt: new Date() });

    const listed = await list(customer.token);
    const detail = await request(app).get(`/api/v1/tickets/${ticket.id}`).set(auth(customer.token));
    const created = await postTicket(customer.token, { priority: 'urgent' });
    const closed = await setStatus(customer.token, ticket.id, 'closed');

    const bodies = [
      listed.body.items[0],
      detail.body.ticket,
      created.body.ticket,
      closed.body.ticket,
    ];
    for (const body of bodies) {
      expect(body).toBeDefined();
      expect(body).not.toHaveProperty('sla');
      expect(body).not.toHaveProperty('slaFirstResponseDueAt');
      expect(body).not.toHaveProperty('slaResolutionDueAt');
    }
    for (const response of [listed, detail, created, closed]) {
      expect(JSON.stringify(response.body)).not.toMatch(/sla/i);
    }
  });

  it('returns state null for a ticket created before CD-22', async () => {
    const customer = await createUser();
    const agent = await createUser('agent');
    const legacy = await Ticket.create({
      title: 'Old ticket',
      description: 'From before CD-22.',
      createdBy: customer.user._id,
    });

    const detail = await request(app).get(`/api/v1/tickets/${legacy.id}`).set(auth(agent.token));

    expect(detail.body.ticket.sla).toEqual({ state: null, dueAt: null, kind: null });
  });
});

describe('GET /api/v1/tickets?sla=', () => {
  // One ticket per state (titles name them), plus a legacy ticket without SLA.
  async function seedStates() {
    const customer = await createUser();
    const agent = await createUser('agent');
    const owner = customer.user;
    await Promise.all([
      seedTicket(owner, { title: 'ok', ageHours: 1 }),
      seedTicket(owner, { title: 'at risk first response', ageHours: 7, priority: 'high' }),
      seedTicket(owner, { title: 'breached first response', ageHours: 9 }),
      seedTicket(owner, {
        title: 'at risk resolution',
        ageHours: 60,
        firstResponseAt: hoursAgo(59),
        status: 'in_progress',
      }),
      seedTicket(owner, {
        title: 'breached resolution',
        ageHours: 80,
        firstResponseAt: hoursAgo(79),
        status: 'waiting',
      }),
      seedTicket(owner, {
        title: 'met',
        ageHours: 80,
        firstResponseAt: hoursAgo(79),
        resolvedAt: hoursAgo(70),
        status: 'resolved',
      }),
      seedTicket(owner, {
        title: 'resolved late',
        ageHours: 100,
        firstResponseAt: hoursAgo(99),
        resolvedAt: hoursAgo(10),
        status: 'closed',
      }),
      Ticket.create({ title: 'legacy', description: 'Old.', createdBy: owner._id }),
    ]);
    return { customer, agent };
  }

  const titles = (response) => response.body.items.map((item) => item.title).sort();

  it('returns only breached tickets, with a matching total and sla state', async () => {
    const { agent } = await seedStates();

    const response = await list(agent.token, '?sla=breached&limit=50');

    expect(response.status).toBe(200);
    expect(titles(response)).toEqual([
      'breached first response',
      'breached resolution',
      'resolved late',
    ]);
    expect(response.body.total).toBe(3);
    expect(response.body.items.every((item) => item.sla.state === 'breached')).toBe(true);
  });

  it('returns only at-risk tickets', async () => {
    const { agent } = await seedStates();

    const response = await list(agent.token, '?sla=at_risk');

    expect(titles(response)).toEqual(['at risk first response', 'at risk resolution']);
    expect(response.body.items.every((item) => item.sla.state === 'at_risk')).toBe(true);
  });

  it('combines with status, priority, search, sorting and pagination', async () => {
    const { agent } = await seedStates();

    const byStatus = await list(agent.token, '?sla=breached&status=open,waiting');
    expect(titles(byStatus)).toEqual(['breached first response', 'breached resolution']);

    const byPriority = await list(agent.token, '?sla=at_risk&priority=high');
    expect(titles(byPriority)).toEqual(['at risk first response']);

    const bySearch = await list(agent.token, '?sla=breached&q=resolution');
    expect(titles(bySearch)).toEqual(['breached resolution']);

    const paged = await list(agent.token, '?sla=breached&sort=createdAt&order=asc&limit=2&page=2');
    expect(paged.body).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(paged.body.items.map((item) => item.title)).toEqual(['breached first response']);
  });

  it('combines with the assignee filter', async () => {
    const { agent, customer } = await seedStates();
    await seedTicket(customer.user, {
      title: 'mine and breached',
      ageHours: 9,
      assignee: agent.id,
    });

    const response = await list(agent.token, '?sla=breached&assignee=me');

    expect(titles(response)).toEqual(['mine and breached']);
    expect(response.body.total).toBe(1);
  });

  it.each(['?sla=late', '?sla=ok', '?sla=met', '?sla=', '?sla=breached,at_risk', '?sla[$ne]=x'])(
    'rejects %s with 400 in the shared error shape',
    async (query) => {
      const { token } = await createUser('agent');

      const response = await list(token, query);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
      });
      expect(response.body.error.details[0].field).toMatch(/^sla/);
    },
  );

  it('rejects a repeated sla parameter', async () => {
    const { token } = await createUser('admin');

    const response = await list(token, '?sla=breached&sla=at_risk');

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toEqual({
      field: 'sla',
      message: 'SLA must be one of: breached, at_risk',
    });
  });

  it.each(['breached', 'at_risk'])('answers 403 when a customer sends sla=%s', async (value) => {
    const { customer } = await seedStates();

    const response = await list(customer.token, `?sla=${value}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN_BODY);
  });

  it('checks the value before the role: a customer with a bad value gets 400', async () => {
    const { token } = await createUser();

    expect((await list(token, '?sla=bogus')).status).toBe(400);
  });
});
