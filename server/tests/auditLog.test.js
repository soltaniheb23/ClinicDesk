// Audit log (CD-20, docs/audit-log.md): what the routes record, what they never record,
// the append-only model, and GET /api/v1/audit-logs.
const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');
const AuditLog = require('../src/models/AuditLog');
const Ticket = require('../src/models/Ticket');
const User = require('../src/models/User');
const { hashPassword } = require('../src/auth/password');
const { signToken } = require('../src/auth/token');
const { recordAudit, auditEmail } = require('../src/audit/record');

const PASSWORD = 'a-long-password';
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};
const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};

let mongoServer;
let passwordHash;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init(), AuditLog.init()]);
  passwordHash = await hashPassword(PASSWORD);
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
  // The model refuses deletes (that is the point), so tests clean up through the driver.
  await Promise.all([
    User.deleteMany({}),
    Ticket.deleteMany({}),
    AuditLog.collection.deleteMany({}),
  ]);
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
    passwordHash,
    role,
    ...fields,
  });
  return { user, id: user.id, token: signToken(user) };
}

function as(actor) {
  const auth = (pending) => pending.set('Authorization', `Bearer ${actor.token}`);
  return {
    get: (path) => auth(request(app).get(path)),
    post: (path, body) => auth(request(app).post(path)).send(body),
    patch: (path, body) => auth(request(app).patch(path)).send(body),
  };
}

const login = (email, password = PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

async function entries() {
  return AuditLog.find().sort({ createdAt: 1, _id: 1 }).lean();
}

function ticketFor(owner, fields = {}) {
  return Ticket.create({
    title: 'Printer in reception not working',
    description: 'It shows error E-12.',
    createdBy: owner.user._id,
    ...fields,
  });
}

// No stored entry may contain a password, a bcrypt hash or a JWT.
function expectNoSecrets(stored) {
  const text = JSON.stringify(stored);
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toMatch(/\$2[aby]\$|passwordHash|"password"|token|eyJ[\w-]+\./);
}

describe('recorded actions', () => {
  it('records a successful login with the user as actor and entity', async () => {
    const { user } = await createUser('agent');

    const response = await login(user.email);

    expect(response.status).toBe(200);
    const [entry, ...rest] = await entries();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      actor: user._id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user._id,
      metadata: {},
    });
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry).not.toHaveProperty('updatedAt');
    expectNoSecrets(entry);
  });

  it.each([
    ['a wrong password', 'agent1@example.com', 'wrong-password', {}],
    ['an unknown email', 'Nobody@Example.com', PASSWORD, {}],
    ['a deactivated user', 'agent1@example.com', PASSWORD, { isActive: false }],
  ])(
    'records a failed login for %s with the email only',
    async (_label, email, password, fields) => {
      await createUser('agent', { email: 'agent1@example.com', ...fields });

      const response = await login(email, password);

      expect(response.status).toBe(401);
      const [entry, ...rest] = await entries();
      expect(rest).toEqual([]);
      expect(entry).toMatchObject({
        actor: null,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: null,
        metadata: { email: email.toLowerCase() },
      });
      expect(Object.keys(entry.metadata)).toEqual(['email']);
      expectNoSecrets(entry);
    },
  );

  it('records nothing for a login rejected as invalid (400)', async () => {
    await login('not-an-email', PASSWORD);
    await request(app).post('/api/v1/auth/login').send({ email: 'a@example.com' });

    expect(await entries()).toEqual([]);
  });

  it('records a status change with from and to', async () => {
    const owner = await createUser('customer');
    const agent = await createUser('agent');
    const ticket = await ticketFor(owner);

    const response = await as(agent).patch(`/api/v1/tickets/${ticket.id}/status`, {
      status: 'in_progress',
    });

    expect(response.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({
        actor: agent.user._id,
        action: 'ticket.status_changed',
        entityType: 'ticket',
        entityId: ticket._id,
        metadata: { from: 'open', to: 'in_progress' },
      }),
    ]);
  });

  it('records a customer closing their own resolved ticket', async () => {
    const owner = await createUser('customer');
    const ticket = await ticketFor(owner, { status: 'resolved' });

    await as(owner).patch(`/api/v1/tickets/${ticket.id}/status`, { status: 'closed' });

    const [entry] = await entries();
    expect(entry).toMatchObject({
      actor: owner.user._id,
      metadata: { from: 'resolved', to: 'closed' },
    });
  });

  it('records an assignment change with id and name snapshots', async () => {
    const owner = await createUser('customer');
    const admin = await createUser('admin', { name: 'Anton Admin' });
    const lena = await createUser('agent', { name: 'Lena Berg' });
    const omar = await createUser('agent', { name: 'Omar Haddad' });
    const ticket = await ticketFor(owner, { assignee: lena.user._id });

    const response = await as(admin).patch(`/api/v1/tickets/${ticket.id}/assignee`, {
      assignee: omar.id,
    });

    expect(response.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({
        actor: admin.user._id,
        action: 'ticket.assignee_changed',
        entityType: 'ticket',
        entityId: ticket._id,
        metadata: {
          from: { id: lena.id, name: 'Lena Berg' },
          to: { id: omar.id, name: 'Omar Haddad' },
        },
      }),
    ]);
  });

  it('records a claim and a release with null for unassigned', async () => {
    const owner = await createUser('customer');
    const agent = await createUser('agent', { name: 'Lena Berg' });
    const ticket = await ticketFor(owner);
    const path = `/api/v1/tickets/${ticket.id}/assignee`;

    await as(agent).patch(path, { assignee: agent.id });
    await as(agent).patch(path, { assignee: null });

    const [claim, release] = await entries();
    expect(claim.metadata).toEqual({ from: null, to: { id: agent.id, name: 'Lena Berg' } });
    expect(release.metadata).toEqual({ from: { id: agent.id, name: 'Lena Berg' }, to: null });
  });

  it('records a user created by an admin, with the role and no password', async () => {
    const admin = await createUser('admin');

    const response = await as(admin).post('/api/v1/users', {
      name: 'New Agent',
      email: 'new.agent@example.com',
      password: PASSWORD,
      role: 'agent',
    });

    expect(response.status).toBe(201);
    const [entry, ...rest] = await entries();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      actor: admin.user._id,
      action: 'user.created',
      entityType: 'user',
      metadata: { role: 'agent' },
    });
    expect(entry.entityId.toString()).toBe(response.body.user.id);
    expectNoSecrets(entry);
  });

  it.each([
    ['a role change', { role: 'admin' }, [['user.role_changed', 'agent', 'admin']]],
    ['a deactivation', { isActive: false }, [['user.active_changed', true, false]]],
    [
      'both at once (two entries)',
      { role: 'customer', isActive: false },
      [
        ['user.role_changed', 'agent', 'customer'],
        ['user.active_changed', true, false],
      ],
    ],
    ['a no-op value (nothing)', { role: 'agent' }, []],
  ])('records %s on a user', async (_label, body, expected) => {
    const admin = await createUser('admin');
    const target = await createUser('agent');

    const response = await as(admin).patch(`/api/v1/users/${target.id}`, body);

    expect(response.status).toBe(200);
    const stored = await entries();
    expect(stored.map((entry) => [entry.action, entry.metadata.from, entry.metadata.to])).toEqual(
      expected,
    );
    for (const entry of stored) {
      expect(entry).toMatchObject({
        actor: admin.user._id,
        entityType: 'user',
        entityId: target.user._id,
      });
    }
  });

  it('records a reactivation', async () => {
    const admin = await createUser('admin');
    const target = await createUser('agent', { isActive: false });

    await as(admin).patch(`/api/v1/users/${target.id}`, { isActive: true });

    const [entry] = await entries();
    expect(entry).toMatchObject({
      action: 'user.active_changed',
      metadata: { from: false, to: true },
    });
  });
});

describe('rejected requests record nothing', () => {
  async function setup() {
    const owner = await createUser('customer');
    const agent = await createUser('agent');
    const admin = await createUser('admin');
    const ticket = await ticketFor(owner);
    return { owner, agent, admin, ticket };
  }

  it.each([
    [
      'status 400 (bad value)',
      ({ agent, ticket }) =>
        as(agent).patch(`/api/v1/tickets/${ticket.id}/status`, { status: 'x' }),
    ],
    [
      'status 403 (customer)',
      ({ owner, ticket }) =>
        as(owner).patch(`/api/v1/tickets/${ticket.id}/status`, { status: 'in_progress' }),
    ],
    [
      'status 404',
      ({ agent }) =>
        as(agent).patch(`/api/v1/tickets/${new mongoose.Types.ObjectId()}/status`, {
          status: 'in_progress',
        }),
    ],
    [
      'status 409 (skips a step)',
      ({ agent, ticket }) =>
        as(agent).patch(`/api/v1/tickets/${ticket.id}/status`, { status: 'closed' }),
    ],
    [
      'assignee 403 (customer)',
      ({ owner, ticket }) =>
        as(owner).patch(`/api/v1/tickets/${ticket.id}/assignee`, { assignee: null }),
    ],
    [
      'assignee 400 (not staff)',
      ({ admin, owner, ticket }) =>
        as(admin).patch(`/api/v1/tickets/${ticket.id}/assignee`, { assignee: owner.id }),
    ],
    [
      'user create 403 (agent)',
      ({ agent }) =>
        as(agent).post('/api/v1/users', {
          name: 'X',
          email: 'x@example.com',
          password: PASSWORD,
          role: 'agent',
        }),
    ],
    [
      'user create 400',
      ({ admin }) =>
        as(admin).post('/api/v1/users', {
          name: 'X',
          email: 'x@example.com',
          password: 'short',
          role: 'agent',
        }),
    ],
    [
      'user create 409 (email taken)',
      ({ admin, agent }) =>
        as(admin).post('/api/v1/users', {
          name: 'X',
          email: agent.user.email,
          password: PASSWORD,
          role: 'agent',
        }),
    ],
    ['user patch 400', ({ admin, agent }) => as(admin).patch(`/api/v1/users/${agent.id}`, {})],
    [
      'user patch 404',
      ({ admin }) =>
        as(admin).patch(`/api/v1/users/${new mongoose.Types.ObjectId()}`, { role: 'agent' }),
    ],
    [
      'user patch 409 (self)',
      ({ admin }) => as(admin).patch(`/api/v1/users/${admin.id}`, { role: 'agent' }),
    ],
  ])('%s', async (_label, send) => {
    const context = await setup();

    const response = await send(context);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('records nothing when the last-admin safeguard undoes a change', async () => {
    const caller = await createUser('admin');
    const target = await createUser('admin');
    const original = User.findOneAndUpdate.bind(User);
    jest.spyOn(User, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await User.updateOne({ _id: caller.user._id }, { $set: { role: 'customer' } });
      return result;
    });

    const response = await as(caller).patch(`/api/v1/users/${target.id}`, { isActive: false });

    expect(response.body.error.code).toBe('LAST_ADMIN');
    expect(await AuditLog.countDocuments()).toBe(0);
  });
});

describe('a failing audit write never breaks the action', () => {
  beforeEach(() => {
    jest.spyOn(AuditLog, 'create').mockRejectedValue(new Error('database unavailable'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('still logs the user in', async () => {
    const { user } = await createUser('agent');

    const response = await login(user.email);

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(console.error).toHaveBeenCalledWith(
      'Could not write audit entry "auth.login":',
      expect.any(Error),
    );
  });

  it('still answers 401 for a failed login', async () => {
    const response = await login('nobody@example.com');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('still changes the status, the assignee and the user', async () => {
    const owner = await createUser('customer');
    const admin = await createUser('admin');
    const ticket = await ticketFor(owner);

    const status = await as(admin).patch(`/api/v1/tickets/${ticket.id}/status`, {
      status: 'in_progress',
    });
    const assignee = await as(admin).patch(`/api/v1/tickets/${ticket.id}/assignee`, {
      assignee: admin.id,
    });
    const created = await as(admin).post('/api/v1/users', {
      name: 'New Agent',
      email: 'new.agent@example.com',
      password: PASSWORD,
      role: 'agent',
    });
    const updated = await as(admin).patch(`/api/v1/users/${owner.id}`, { role: 'agent' });

    expect([status.status, assignee.status, created.status, updated.status]).toEqual([
      200, 200, 201, 200,
    ]);
    expect(status.body.ticket.status).toBe('in_progress');
    expect(updated.body.user.role).toBe('agent');
    expect(console.error).toHaveBeenCalledTimes(4);
  });

  it('recordAudit resolves instead of throwing', async () => {
    await expect(
      recordAudit({ action: 'auth.login', entityType: 'user' }),
    ).resolves.toBeUndefined();
  });
});

describe('append-only model', () => {
  async function anEntry() {
    return AuditLog.create({
      action: 'auth.login_failed',
      entityType: 'user',
      metadata: { email: 'a@example.com' },
    });
  }

  it.each([
    ['updateOne', () => AuditLog.updateOne({}, { action: 'auth.login' })],
    ['updateMany', () => AuditLog.updateMany({}, { action: 'auth.login' })],
    ['replaceOne', () => AuditLog.replaceOne({}, { action: 'auth.login', entityType: 'user' })],
    ['findOneAndUpdate', () => AuditLog.findOneAndUpdate({}, { action: 'auth.login' })],
    [
      'findByIdAndUpdate',
      (entry) => AuditLog.findByIdAndUpdate(entry._id, { action: 'auth.login' }),
    ],
    [
      'findOneAndReplace',
      () => AuditLog.findOneAndReplace({}, { action: 'auth.login', entityType: 'user' }),
    ],
    ['findOneAndDelete', () => AuditLog.findOneAndDelete({})],
    ['findByIdAndDelete', (entry) => AuditLog.findByIdAndDelete(entry._id)],
    ['deleteOne', () => AuditLog.deleteOne({})],
    ['deleteMany', () => AuditLog.deleteMany({})],
    [
      'document.save',
      async (entry) => {
        const loaded = await AuditLog.findById(entry._id);
        loaded.action = 'auth.login';
        return loaded.save();
      },
    ],
    ['document.deleteOne', async (entry) => (await AuditLog.findById(entry._id)).deleteOne()],
    [
      'document.updateOne',
      async (entry) => (await AuditLog.findById(entry._id)).updateOne({ action: 'auth.login' }),
    ],
  ])('refuses %s and keeps the entry', async (_label, change) => {
    const entry = await anEntry();

    await expect(change(entry)).rejects.toThrow('Audit log entries cannot be changed or deleted');

    expect(await AuditLog.findById(entry._id).lean()).toMatchObject({
      action: 'auth.login_failed',
      metadata: { email: 'a@example.com' },
    });
  });

  it('serializes like the other models (id, no _id or __v, no updatedAt)', async () => {
    const entry = await anEntry();

    const json = entry.toJSON();

    expect(json.id).toBe(entry._id.toString());
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
    expect(json).not.toHaveProperty('updatedAt');
    expect(json).toMatchObject({ actor: null, entityId: null, createdAt: expect.any(Date) });
  });

  it('allows create and insertMany', async () => {
    await anEntry();
    await AuditLog.insertMany([{ action: 'auth.login', entityType: 'user' }]);

    expect(await AuditLog.countDocuments()).toBe(2);
  });

  it('rejects unknown actions and entity types', async () => {
    await expect(
      AuditLog.create({ action: 'ticket.deleted', entityType: 'ticket' }),
    ).rejects.toThrow();
    await expect(
      AuditLog.create({ action: 'auth.login', entityType: 'comment' }),
    ).rejects.toThrow();
  });

  it('has no update or delete route', async () => {
    const admin = await createUser('admin');
    const entry = await anEntry();

    for (const method of ['put', 'patch', 'delete']) {
      const client = request(app);
      const send = client[method].bind(client);
      const response = await send(`/api/v1/audit-logs/${entry.id}`).set(
        'Authorization',
        `Bearer ${admin.token}`,
      );
      expect(response.status).toBe(404);
    }
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('normalizes the attempted email (lowercase, trimmed, at most 254 characters)', () => {
    expect(auditEmail('  Mara@Example.COM ')).toBe('mara@example.com');
    expect(auditEmail('a'.repeat(300))).toHaveLength(254);
    expect(auditEmail(undefined)).toBe('');
  });
});

describe('GET /api/v1/audit-logs', () => {
  const list = (actor, query = '') => as(actor).get(`/api/v1/audit-logs${query}`);

  // Inserts entries with increasing createdAt (one minute apart, from `start`).
  const START = Date.UTC(2026, 10, 20, 8, 0, 0);
  async function seed(specs) {
    return AuditLog.insertMany(
      specs.map((spec, index) => ({
        entityType: 'user',
        createdAt: new Date(START + index * 60000),
        ...spec,
      })),
    );
  }

  it('returns 401 without a token and 403 for customers and agents', async () => {
    const customer = await createUser('customer');
    const agent = await createUser('agent');

    const anonymous = await request(app).get('/api/v1/audit-logs');

    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual(UNAUTHENTICATED);
    for (const actor of [customer, agent]) {
      const response = await list(actor, '?action=nope');
      expect(response.status).toBe(403);
      expect(response.body).toEqual(FORBIDDEN);
    }
  });

  it('returns entries newest first with the actor as { id, name } and an entity label', async () => {
    const admin = await createUser('admin', { name: 'Anton Admin' });
    const owner = await createUser('customer', { name: 'Mara Jensen' });
    const ticket = await ticketFor(owner);
    await seed([
      { actor: admin.user._id, action: 'auth.login', entityId: admin.user._id },
      {
        actor: admin.user._id,
        action: 'ticket.status_changed',
        entityType: 'ticket',
        entityId: ticket._id,
        metadata: { from: 'open', to: 'in_progress' },
      },
      { action: 'auth.login_failed', metadata: { email: 'x@example.com' } },
    ]);

    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, limit: 10, total: 3, totalPages: 1 });
    const [failed, status, ownLogin] = response.body.items;
    expect(failed).toEqual({
      id: expect.any(String),
      actor: null,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: null,
      entityLabel: null,
      metadata: { email: 'x@example.com' },
      createdAt: new Date(START + 120000).toISOString(),
    });
    expect(status).toMatchObject({
      actor: { id: admin.id, name: 'Anton Admin' },
      entityId: ticket.id,
      entityLabel: 'Printer in reception not working',
      metadata: { from: 'open', to: 'in_progress' },
    });
    expect(Object.keys(status.actor)).toEqual(['id', 'name']);
    expect(ownLogin).toMatchObject({ entityLabel: 'Anton Admin' });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('gives a deleted actor or entity no name', async () => {
    const admin = await createUser('admin');
    const gone = new mongoose.Types.ObjectId();
    await seed([
      { actor: gone, action: 'user.created', entityId: gone, metadata: { role: 'agent' } },
    ]);

    const [entry] = (await list(admin)).body.items;

    expect(entry).toMatchObject({ actor: null, entityId: gone.toString(), entityLabel: null });
  });

  it('breaks ties on createdAt by _id, newest first', async () => {
    const admin = await createUser('admin');
    const at = new Date(START);
    const [first, second] = await AuditLog.insertMany([
      { action: 'auth.login', entityType: 'user', createdAt: at },
      { action: 'auth.login', entityType: 'user', createdAt: at },
    ]);

    const ids = (await list(admin)).body.items.map((entry) => entry.id);

    expect(ids).toEqual([second.id, first.id]);
  });

  it('paginates', async () => {
    const admin = await createUser('admin');
    await seed(Array.from({ length: 5 }, () => ({ action: 'auth.login' })));

    const second = await list(admin, '?page=2&limit=2');
    const beyond = await list(admin, '?page=9&limit=2');

    expect(second.body).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(second.body.items.map((entry) => entry.createdAt)).toEqual([
      new Date(START + 2 * 60000).toISOString(),
      new Date(START + 1 * 60000).toISOString(),
    ]);
    expect(beyond.body.items).toEqual([]);
  });

  it('filters by action, actor and entity type', async () => {
    const admin = await createUser('admin');
    const agent = await createUser('agent');
    await seed([
      { actor: agent.user._id, action: 'auth.login' },
      { actor: admin.user._id, action: 'auth.login' },
      { actor: admin.user._id, action: 'ticket.status_changed', entityType: 'ticket' },
      { action: 'auth.login_failed' },
    ]);

    const actions = async (query) =>
      (await list(admin, query)).body.items.map((entry) => entry.action);

    expect(await actions('?action=auth.login')).toEqual(['auth.login', 'auth.login']);
    expect(await actions(`?actor=${agent.id}`)).toEqual(['auth.login']);
    expect(await actions('?entityType=ticket')).toEqual(['ticket.status_changed']);
    expect(await actions(`?action=auth.login&actor=${admin.id}`)).toEqual(['auth.login']);
  });

  it('filters by date range (from and to inclusive, a plain "to" date covers its day)', async () => {
    const admin = await createUser('admin');
    await AuditLog.insertMany(
      [
        '2026-11-19T23:59:59Z',
        '2026-11-20T00:00:00Z',
        '2026-11-21T23:59:00Z',
        '2026-11-22T00:00:00Z',
      ].map((time) => ({ action: 'auth.login', entityType: 'user', createdAt: new Date(time) })),
    );

    const times = async (query) =>
      (await list(admin, query)).body.items.map((entry) => entry.createdAt);

    expect(await times('?from=2026-11-20&to=2026-11-21')).toEqual([
      '2026-11-21T23:59:00.000Z',
      '2026-11-20T00:00:00.000Z',
    ]);
    expect(await times('?from=2026-11-21T23:59:00%2B00:00')).toEqual([
      '2026-11-22T00:00:00.000Z',
      '2026-11-21T23:59:00.000Z',
    ]);
    expect(await times('?to=2026-11-20T01:00:00%2B01:00')).toEqual([
      '2026-11-20T00:00:00.000Z',
      '2026-11-19T23:59:59.000Z',
    ]);
  });

  it.each([
    ['page=0', 'page'],
    ['limit=51', 'limit'],
    ['action=ticket.deleted', 'action'],
    ['actor=not-an-id', 'actor'],
    ['entityType=comment', 'entityType'],
    ['from=yesterday', 'from'],
    ['to=2026-13-01', 'to'],
    ['from=2026-11-25T08:00:00', 'from'],
    ['from=2026-11-22&to=2026-11-21', 'to'],
    ['sort=createdAt', 'sort'],
    ['action[$ne]=auth.login', 'action[$ne]'],
    ['action=auth.login&action=user.created', 'action'],
  ])('rejects ?%s with a 400 on %s', async (query, field) => {
    const admin = await createUser('admin');

    const response = await list(admin, `?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
  });
});
