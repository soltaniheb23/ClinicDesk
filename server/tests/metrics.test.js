// GET /api/v1/metrics (CD-23, docs/metrics.md): access, validation, and every number with
// known timestamps and a fixed clock.
const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const { createApp } = require('../src/app');
const Ticket = require('../src/models/Ticket');
const User = require('../src/models/User');
const { signToken } = require('../src/auth/token');
const { slaSnapshot } = require('../src/sla/policy');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-12-15T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

let mongoServer;
let app;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init()]);
  app = createApp({ env: { NODE_ENV: 'test' }, clock: () => NOW });
}, 120000);

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Ticket.collection.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

let userCount = 0;
async function createUser(role, fields = {}) {
  userCount += 1;
  const user = await User.create({
    name: `${role} ${userCount}`,
    email: `${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
    ...fields,
  });
  return { user, id: user.id, name: user.name, token: signToken(user) };
}

let owner;
let ticketCount = 0;
// Inserted with the raw driver so createdAt and resolvedAt are exactly what the test says.
async function ticket(fields = {}) {
  ticketCount += 1;
  owner ??= await createUser('customer', { name: 'Mara Secret-Customer' });
  const document = {
    title: `Ticket title ${ticketCount}`,
    description: `Ticket description ${ticketCount}`,
    category: 'it',
    priority: 'normal',
    status: 'open',
    createdBy: owner.user._id,
    assignee: null,
    firstResponseAt: null,
    resolvedAt: null,
    createdAt: ago(DAY),
    updatedAt: NOW,
    ...fields,
  };
  if (document.assignee && document.assignee.user) document.assignee = document.assignee.user._id;
  await Ticket.collection.insertOne(document);
  return document;
}

function resolved(createdAt, resolvedAt, fields = {}) {
  return ticket({ status: 'resolved', createdAt, resolvedAt, ...fields });
}

function getMetrics(actor, query = '', to = app) {
  const pending = request(to).get(`/api/v1/metrics${query}`);
  if (actor) pending.set('Authorization', `Bearer ${actor.token}`);
  return pending;
}

afterEach(() => {
  owner = undefined;
});

describe('access and validation', () => {
  it('answers 401 without a token', async () => {
    const response = await getMetrics(null);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });

  it.each(['agent', 'customer'])('answers 403 for an %s', async (role) => {
    const actor = await createUser(role);

    const response = await getMetrics(actor);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
    });
  });

  it('answers 200 for an admin with the 30-day default, the range and the time', async () => {
    const admin = await createUser('admin');

    const response = await getMetrics(admin);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toMatchObject({
      range: '30d',
      from: '2026-11-15T12:00:00.000Z',
      generatedAt: NOW.toISOString(),
    });
  });

  it.each([
    ['7d', '2026-12-08T12:00:00.000Z'],
    ['90d', '2026-09-16T12:00:00.000Z'],
    ['all', null],
  ])('accepts range=%s', async (range, from) => {
    const admin = await createUser('admin');

    const response = await getMetrics(admin, `?range=${range}`);

    expect(response.status).toBe(200);
    expect(response.body.range).toBe(range);
    expect(response.body.from).toBe(from);
  });

  it.each(['?range=1y', '?range=', '?range=7d&range=30d', '?range[$ne]=7d', '?days=7'])(
    'answers 400 in the uniform shape for %s',
    async (query) => {
      const admin = await createUser('admin');

      const response = await getMetrics(admin, query);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
      });
      expect(response.body.error.details[0].field).toMatch(/^(range|days)/);
    },
  );

  it('names the allowed ranges in the error', async () => {
    const admin = await createUser('admin');

    const response = await getMetrics(admin, '?range=1y');

    expect(response.body.error.details).toEqual([
      { field: 'range', message: 'Range must be one of: 7d, 30d, 90d, all' },
    ]);
  });
});

describe('openTickets', () => {
  it('counts open, in_progress and waiting tickets, whatever the range', async () => {
    const admin = await createUser('admin');
    await ticket({ status: 'open' });
    await ticket({ status: 'open', createdAt: ago(400 * DAY) });
    await ticket({ status: 'in_progress' });
    await ticket({ status: 'waiting' });
    await ticket({ status: 'waiting' });
    await resolved(ago(2 * DAY), ago(DAY));
    await ticket({ status: 'closed', resolvedAt: ago(DAY) });

    for (const range of ['7d', 'all']) {
      const response = await getMetrics(admin, `?range=${range}`);

      expect(response.body.openTickets).toEqual({
        total: 5,
        byStatus: { open: 2, in_progress: 1, waiting: 2 },
      });
    }
  });

  it('returns zeros, not missing keys, without tickets', async () => {
    const admin = await createUser('admin');

    const response = await getMetrics(admin);

    expect(response.body.openTickets).toEqual({
      total: 0,
      byStatus: { open: 0, in_progress: 0, waiting: 0 },
    });
    expect(response.body.unassigned).toEqual({ open: 0 });
    expect(response.body.sla).toEqual({ breachedOpen: 0, atRiskOpen: 0 });
  });
});

describe('resolution', () => {
  it('averages resolvedAt minus createdAt in hours, one decimal, inside the range', async () => {
    const admin = await createUser('admin');
    // 2 h, 5 h and 4 h 6 min: average 3.7 h. The closed ticket keeps its resolvedAt.
    await resolved(ago(3 * DAY + 2 * HOUR), ago(3 * DAY));
    await resolved(ago(DAY + 5 * HOUR), ago(DAY));
    await ticket({
      status: 'closed',
      createdAt: ago(2 * DAY + 4.1 * HOUR),
      resolvedAt: ago(2 * DAY),
    });
    // Resolved 40 days ago: outside 30d, inside 90d and all (100 h).
    await resolved(ago(40 * DAY + 100 * HOUR), ago(40 * DAY));

    const thirty = await getMetrics(admin, '?range=30d');
    const all = await getMetrics(admin, '?range=all');

    expect(thirty.body.resolution).toEqual({ averageHours: 3.7, resolvedCount: 3 });
    // (2 + 5 + 4.1 + 100) / 4 = 27.775
    expect(all.body.resolution).toEqual({ averageHours: 27.8, resolvedCount: 4 });
  });

  it('is null, never 0 or NaN, when nothing was resolved in the range', async () => {
    const admin = await createUser('admin');
    await ticket({ status: 'open' });
    await resolved(ago(60 * DAY), ago(50 * DAY));

    const response = await getMetrics(admin, '?range=30d');

    expect(response.body.resolution).toEqual({ averageHours: null, resolvedCount: 0 });
    expect(response.text).toContain('"averageHours":null');
    expect(response.text).not.toMatch(/NaN|Infinity/);
  });

  it('includes the range start and now, and excludes just outside both', async () => {
    const admin = await createUser('admin');
    const start = ago(7 * DAY);
    await resolved(ago(8 * DAY), start, { title: 'exactly at the start' });
    await resolved(ago(8 * DAY), new Date(start.getTime() - 1), { title: '1 ms before' });
    await resolved(ago(HOUR), NOW, { title: 'exactly now' });
    await resolved(ago(HOUR), new Date(NOW.getTime() + 1), { title: '1 ms in the future' });

    const response = await getMetrics(admin, '?range=7d');

    // 24 h (at the start) and 1 h (now): 12.5 h.
    expect(response.body.resolution).toEqual({ averageHours: 12.5, resolvedCount: 2 });
  });

  it('counts a reopened ticket only by its latest resolvedAt (cleared while reopened)', async () => {
    const admin = await createUser('admin');
    // Reopened and still in progress: resolvedAt was cleared, so it is open, not resolved.
    await ticket({ status: 'in_progress', createdAt: ago(5 * DAY), resolvedAt: null });

    const response = await getMetrics(admin);

    expect(response.body.resolution.resolvedCount).toBe(0);
    expect(response.body.openTickets.byStatus.in_progress).toBe(1);
  });

  it('uses the resolvedAt index for the resolved tickets', async () => {
    const plan = await Ticket.aggregate([
      { $match: { resolvedAt: { $gte: ago(30 * DAY), $lte: NOW } } },
    ]).explain('queryPlanner');

    expect(JSON.stringify(plan)).toContain('resolvedAt_1');
  });
});

describe('perAgent and unassigned', () => {
  it('lists every active agent and admin with zeros, sorted by open then name', async () => {
    const admin = await createUser('admin', { name: 'Anton Weber' });
    const lena = await createUser('agent', { name: 'Lena Berg' });
    const bo = await createUser('agent', { name: 'Bo Idle' });
    const zoe = await createUser('agent', { name: 'zoë Busy' });
    await createUser('customer', { name: 'Not An Agent' });
    await createUser('agent', { name: 'Gone Without Tickets', isActive: false });

    await ticket({ assignee: zoe });
    await ticket({ assignee: zoe, status: 'waiting' });
    await ticket({ assignee: lena });
    await ticket({ assignee: null });
    await ticket({ assignee: null, status: 'in_progress' });
    await resolved(ago(DAY + HOUR), ago(DAY), { assignee: lena.user._id });
    await resolved(ago(DAY + HOUR), ago(DAY), { assignee: lena.user._id });
    await resolved(ago(DAY + HOUR), ago(DAY), { assignee: admin.user._id });
    await resolved(ago(60 * DAY), ago(50 * DAY), { assignee: bo.user._id });

    const response = await getMetrics(admin);

    expect(response.body.perAgent).toEqual([
      { id: zoe.id, name: 'zoë Busy', openAssigned: 2, resolvedInRange: 0, inactive: false },
      { id: lena.id, name: 'Lena Berg', openAssigned: 1, resolvedInRange: 2, inactive: false },
      { id: admin.id, name: 'Anton Weber', openAssigned: 0, resolvedInRange: 1, inactive: false },
      { id: bo.id, name: 'Bo Idle', openAssigned: 0, resolvedInRange: 0, inactive: false },
    ]);
    expect(response.body.unassigned).toEqual({ open: 2 });

    const all = await getMetrics(admin, '?range=all');
    expect(all.body.perAgent.find((row) => row.id === bo.id).resolvedInRange).toBe(1);
  });

  it('keeps a deactivated user who still holds open tickets, marked inactive', async () => {
    const admin = await createUser('admin', { name: 'Anton Weber' });
    const gone = await createUser('agent', { name: 'Former Agent', isActive: false });
    await ticket({ assignee: gone });
    await ticket({ assignee: gone, status: 'waiting' });

    const response = await getMetrics(admin);

    expect(response.body.perAgent).toEqual([
      { id: gone.id, name: 'Former Agent', openAssigned: 2, resolvedInRange: 0, inactive: true },
      { id: admin.id, name: 'Anton Weber', openAssigned: 0, resolvedInRange: 0, inactive: false },
    ]);
  });

  it('keeps a deleted user who still holds open tickets, without a name', async () => {
    const admin = await createUser('admin');
    const deletedId = new mongoose.Types.ObjectId();
    await ticket({ assignee: deletedId });

    const response = await getMetrics(admin);

    expect(response.body.perAgent).toContainEqual({
      id: deletedId.toString(),
      name: null,
      openAssigned: 1,
      resolvedInRange: 0,
      inactive: true,
    });
  });

  it('runs a fixed number of queries, not one per agent', async () => {
    const admin = await createUser('admin');
    const agents = await Promise.all([1, 2, 3, 4, 5, 6].map(() => createUser('agent')));
    for (const agent of agents) await ticket({ assignee: agent });
    const aggregate = jest.spyOn(Ticket, 'aggregate');
    const find = jest.spyOn(User, 'find');

    const response = await getMetrics(admin);

    expect(response.body.perAgent).toHaveLength(7);
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenCalledTimes(1);
    aggregate.mockRestore();
    find.mockRestore();
  });
});

describe('sla', () => {
  // Due dates relative to the real time, hours away from any boundary, so the list route
  // (which reads the real clock) and the metrics (real clock here too) agree.
  function slaTicket(priority, createdHoursAgo, fields = {}) {
    const createdAt = new Date(Date.now() - createdHoursAgo * HOUR);
    return ticket({ priority, createdAt, ...slaSnapshot(priority, createdAt), ...fields });
  }

  it('counts open breached and due-soon tickets exactly like the ?sla= list filter', async () => {
    const realClockApp = createApp({ env: { NODE_ENV: 'test' } });
    const admin = await createUser('admin');
    // normal: 8 h first response, 72 h resolution.
    await slaTicket('normal', 10); // breached: no first response after 10 h
    await slaTicket('normal', 7); // at risk: 7 of 8 h used
    await slaTicket('normal', 1); // ok
    await slaTicket('normal', 70, { firstResponseAt: new Date(Date.now() - 65 * HOUR) }); // at risk: answered in time, 70 of 72 h used
    await slaTicket('urgent', 30, { status: 'waiting' }); // breached
    await slaTicket('normal', 10, { status: 'resolved', resolvedAt: new Date() }); // not open
    await ticket({ status: 'open', createdAt: ago(100 * DAY) }); // created before CD-22: no SLA

    const metrics = await getMetrics(admin, '', realClockApp);
    const list = async (sla) => {
      const response = await request(realClockApp)
        .get(`/api/v1/tickets?sla=${sla}&status=open,in_progress,waiting&limit=50`)
        .set('Authorization', `Bearer ${admin.token}`);
      return response.body.total;
    };

    expect(metrics.body.sla).toEqual({ breachedOpen: 2, atRiskOpen: 2 });
    expect(metrics.body.sla.breachedOpen).toBe(await list('breached'));
    expect(metrics.body.sla.atRiskOpen).toBe(await list('at_risk'));
  });
});

describe('privacy', () => {
  it('returns no ticket text, emails or customer data', async () => {
    const admin = await createUser('admin', { name: 'Anton Weber' });
    const agent = await createUser('agent', { name: 'Lena Berg' });
    await ticket({ assignee: agent, title: 'SECRET-TITLE', description: 'SECRET-DESCRIPTION' });
    await resolved(ago(2 * HOUR), ago(HOUR), {
      assignee: agent.user._id,
      title: 'SECRET-TITLE-2',
      description: 'SECRET-DESCRIPTION-2',
    });

    const response = await getMetrics(admin, '?range=all');

    expect(response.status).toBe(200);
    for (const secret of ['SECRET', 'Secret-Customer', '@example.com', owner.id, 'priority']) {
      expect(response.text).not.toContain(secret);
    }
    expect(Object.keys(response.body).sort()).toEqual([
      'from',
      'generatedAt',
      'openTickets',
      'perAgent',
      'range',
      'resolution',
      'sla',
      'unassigned',
    ]);
    for (const row of response.body.perAgent) {
      expect(Object.keys(row).sort()).toEqual([
        'id',
        'inactive',
        'name',
        'openAssigned',
        'resolvedInRange',
      ]);
    }
  });
});
