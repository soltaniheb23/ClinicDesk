// Admin user management (CD-19, docs/user-management.md): GET, POST and PATCH /users,
// and what a role change or deactivation does to existing sessions and to login.
const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');
const User = require('../src/models/User');
const { hashPassword } = require('../src/auth/password');
const { signToken } = require('../src/auth/token');

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'User not found' } };
const USER_FIELDS = ['createdAt', 'email', 'id', 'isActive', 'name', 'role'];
const PASSWORD = 'a-long-password';

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await User.init();
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
  await User.deleteMany({});
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

function call(method, path, token) {
  const pending = request(app)[method](`/api/v1/users${path}`);
  return token ? pending.set('Authorization', `Bearer ${token}`) : pending;
}

const list = (token, query = '') => call('get', `/${query}`, token);
const create = (token, body) => call('post', '/', token).send(body);
const update = (token, id, body) => call('patch', `/${id}`, token).send(body);

function newUserBody(fields = {}) {
  userCount += 1;
  return {
    name: 'Lena Berg',
    email: `lena${userCount}@example.com`,
    password: PASSWORD,
    role: 'agent',
    ...fields,
  };
}

function expectValidationError(response, field) {
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
}

function names(response) {
  return response.body.items.map((user) => user.name);
}

// No response body anywhere in this file may carry a password or its hash.
function expectNoSecrets(body) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/passwordHash|"password"|\$2[aby]\$/);
}

describe('access', () => {
  const ROUTES = [
    ['GET /users', (token) => list(token)],
    ['POST /users', (token) => create(token, newUserBody())],
    [
      'PATCH /users/:id',
      async (token) => {
        const target = await createUser('customer');
        return update(token, target.id, { role: 'agent' });
      },
    ],
  ];

  describe.each(ROUTES)('%s', (_name, send) => {
    it('returns 401 without a token', async () => {
      const response = await send(null);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    });

    it('returns 401 for a deactivated admin', async () => {
      const admin = await createUser('admin', { isActive: false });

      const response = await send(admin.token);

      expect(response.status).toBe(401);
    });

    it.each(['customer', 'agent'])('returns 403 for a %s', async (role) => {
      const actor = await createUser(role);

      const response = await send(actor.token);

      expect(response.status).toBe(403);
      expect(response.body).toEqual(FORBIDDEN);
    });

    it('lets an admin in', async () => {
      const admin = await createUser('admin');

      const response = await send(admin.token);

      expect(response.status).toBeLessThan(300);
      expectNoSecrets(response.body);
    });
  });

  it('answers 403 before 400 for a non-admin with a bad body or query', async () => {
    const agent = await createUser('agent');
    const target = await createUser('customer');

    expect((await list(agent.token, '?limit=0')).status).toBe(403);
    expect((await create(agent.token, {})).status).toBe(403);
    expect((await update(agent.token, target.id, { role: 'root' })).status).toBe(403);
    expect((await update(agent.token, 'not-an-id', {})).status).toBe(403);
  });

  it('keeps GET /users/agents open to agents', async () => {
    const agent = await createUser('agent');

    expect((await call('get', '/agents', agent.token)).status).toBe(200);
  });
});

describe('GET /api/v1/users', () => {
  it('returns users sorted by name (ignoring case), then id, with the page info', async () => {
    const admin = await createUser('admin', { name: 'Zoe Admin' });
    await createUser('agent', { name: 'lena Berg' });
    await createUser('customer', { name: 'Anton Weber' });
    await createUser('customer', { name: 'Mara Jensen' });

    const response = await list(admin.token);

    expect(response.status).toBe(200);
    expect(names(response)).toEqual(['Anton Weber', 'lena Berg', 'Mara Jensen', 'Zoe Admin']);
    expect(response.body).toMatchObject({ page: 1, limit: 10, total: 4, totalPages: 1 });
  });

  it('returns only id, name, email, role, isActive and createdAt', async () => {
    const admin = await createUser('admin');
    await User.create({
      name: 'Real Hash',
      email: 'real@example.com',
      passwordHash: await hashPassword(PASSWORD),
    });

    const response = await list(admin.token);

    for (const user of response.body.items) {
      expect(Object.keys(user).sort()).toEqual(USER_FIELDS);
    }
    expectNoSecrets(response.body);
  });

  it('orders equal names by id', async () => {
    const admin = await createUser('admin', { name: 'Admin' });
    const first = await createUser('customer', { name: 'Same Name' });
    const second = await createUser('customer', { name: 'Same Name' });

    const response = await list(admin.token);

    // Ids grow over time, so the user created first sorts first among equal names.
    expect(response.body.items.map((user) => user.id)).toEqual([admin.id, first.id, second.id]);
  });

  it('paginates with page and limit', async () => {
    const admin = await createUser('admin', { name: 'A Admin' });
    for (const letter of ['B', 'C', 'D', 'E']) await createUser('customer', { name: letter });

    const second = await list(admin.token, '?page=2&limit=2');
    const beyond = await list(admin.token, '?page=4&limit=2');

    expect(names(second)).toEqual(['C', 'D']);
    expect(second.body).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(beyond.body.items).toEqual([]);
    expect(beyond.body.total).toBe(5);
  });

  it('filters by role and by active state', async () => {
    const admin = await createUser('admin', { name: 'Admin' });
    await createUser('agent', { name: 'Active agent' });
    await createUser('agent', { name: 'Inactive agent', isActive: false });
    await createUser('customer', { name: 'Customer' });

    const agents = await list(admin.token, '?role=agent');
    const inactive = await list(admin.token, '?isActive=false');
    const activeAgents = await list(admin.token, '?role=agent&isActive=true');

    expect(names(agents)).toEqual(['Active agent', 'Inactive agent']);
    expect(names(inactive)).toEqual(['Inactive agent']);
    expect(names(activeAgents)).toEqual(['Active agent']);
    expect(activeAgents.body.total).toBe(1);
  });

  it('searches name or email, case-insensitive', async () => {
    const admin = await createUser('admin', { name: 'Admin' });
    await createUser('agent', { name: 'Lena Berg', email: 'lena@example.com' });
    await createUser('customer', { name: 'Mara Jensen', email: 'reception@clinic.example' });

    expect(names(await list(admin.token, '?q=BERG'))).toEqual(['Lena Berg']);
    expect(names(await list(admin.token, '?q=RECEPTION'))).toEqual(['Mara Jensen']);
    expect(names(await list(admin.token, '?q=%20%20lena%20%20'))).toEqual(['Lena Berg']);
  });

  it('treats the search as plain text', async () => {
    const admin = await createUser('admin', { name: 'Admin' });
    await createUser('customer', { name: 'Dot.Name' });
    await createUser('customer', { name: 'DotXName' });

    expect(names(await list(admin.token, '?q=t.N'))).toEqual(['Dot.Name']);
    expect(names(await list(admin.token, '?q=.*'))).toEqual([]);
    expect((await list(admin.token, '?q=(')).status).toBe(200);
  });

  it.each([
    ['page=0', 'page'],
    ['page=abc', 'page'],
    ['limit=51', 'limit'],
    ['limit=0', 'limit'],
    ['role=root', 'role'],
    ['isActive=yes', 'isActive'],
    ['q=', 'q'],
    [`q=${'a'.repeat(101)}`, 'q'],
    ['sort=email', 'sort'],
    ['role[$ne]=admin', 'role[$ne]'],
    ['role=agent&role=admin', 'role'],
  ])('rejects ?%s with a 400 on %s', async (query, field) => {
    const admin = await createUser('admin');

    expectValidationError(await list(admin.token, `?${query}`), field);
  });
});

describe('POST /api/v1/users', () => {
  it.each(['customer', 'agent', 'admin'])('creates an active %s', async (role) => {
    const admin = await createUser('admin');
    const body = newUserBody({ role, email: `  New.${role}@Example.com ` });

    const response = await create(admin.token, body);

    expect(response.status).toBe(201);
    expect(Object.keys(response.body.user).sort()).toEqual(USER_FIELDS);
    expect(response.body.user).toMatchObject({
      name: 'Lena Berg',
      email: `new.${role}@example.com`,
      role,
      isActive: true,
    });
    expect(response.body).not.toHaveProperty('token');
    expectNoSecrets(response.body);

    const stored = await User.findById(response.body.user.id).select('+passwordHash').lean();
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it('lets the new user log in with the temporary password', async () => {
    const admin = await createUser('admin');
    const body = newUserBody({ role: 'agent' });
    await create(admin.token, body);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('agent');
  });

  it('ignores isActive and other unknown fields', async () => {
    const admin = await createUser('admin');

    const response = await create(
      admin.token,
      newUserBody({ isActive: false, passwordHash: 'x', createdAt: '2000-01-01' }),
    );

    expect(response.status).toBe(201);
    expect(response.body.user.isActive).toBe(true);
    expect(new Date(response.body.user.createdAt).getFullYear()).toBeGreaterThan(2000);
  });

  it('returns 409 EMAIL_TAKEN for an email that is already used (any case)', async () => {
    const admin = await createUser('admin');
    await createUser('customer', { email: 'taken@example.com' });

    const response = await create(admin.token, newUserBody({ email: 'TAKEN@example.com' }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
    expect(await User.countDocuments({ email: 'taken@example.com' })).toBe(1);
  });

  it.each([
    ['a missing name', { name: undefined }, 'name'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a name over 80 characters', { name: 'a'.repeat(81) }, 'name'],
    ['a missing email', { email: undefined }, 'email'],
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['a missing password', { password: undefined }, 'password'],
    ['a short password', { password: 'short' }, 'password'],
    ['a password over 72 bytes', { password: 'é'.repeat(37) }, 'password'],
    ['a missing role', { role: undefined }, 'role'],
    ['an unknown role', { role: 'superadmin' }, 'role'],
  ])('rejects %s with a 400', async (_label, fields, field) => {
    const admin = await createUser('admin');

    const response = await create(admin.token, newUserBody(fields));

    expectValidationError(response, field);
    expect(await User.countDocuments()).toBe(1);
  });

  it('answers 400 before 409 for a taken email with a bad password', async () => {
    const admin = await createUser('admin');
    await createUser('customer', { email: 'taken@example.com' });

    const response = await create(
      admin.token,
      newUserBody({ email: 'taken@example.com', password: 'x' }),
    );

    expectValidationError(response, 'password');
  });
});

describe('PATCH /api/v1/users/:id', () => {
  it.each([
    ['customer', 'agent'],
    ['agent', 'admin'],
    ['admin', 'customer'],
  ])('changes a %s into an %s', async (from, to) => {
    const admin = await createUser('admin');
    const target = await createUser(from);

    const response = await update(admin.token, target.id, { role: to });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.user).sort()).toEqual(USER_FIELDS);
    expect(response.body.user).toMatchObject({ id: target.id, role: to, isActive: true });
    expectNoSecrets(response.body);
    expect((await User.findById(target.id).lean()).role).toBe(to);
  });

  it('deactivates and reactivates a user', async () => {
    const admin = await createUser('admin');
    const target = await createUser('agent');

    const off = await update(admin.token, target.id, { isActive: false });
    const on = await update(admin.token, target.id, { isActive: true });

    expect(off.status).toBe(200);
    expect(off.body.user.isActive).toBe(false);
    expect(on.status).toBe(200);
    expect(on.body.user.isActive).toBe(true);
  });

  it('changes role and active state together', async () => {
    const admin = await createUser('admin');
    const target = await createUser('agent');

    const response = await update(admin.token, target.id, { role: 'customer', isActive: false });

    expect(response.body.user).toMatchObject({ role: 'customer', isActive: false });
  });

  it('deactivates another admin while an active admin remains', async () => {
    const admin = await createUser('admin');
    const other = await createUser('admin');

    const response = await update(admin.token, other.id, { isActive: false });

    expect(response.status).toBe(200);
  });

  it.each([
    ['an empty body', {}, ''],
    ['only unknown fields', { name: 'New name', email: 'x@example.com' }, ''],
    ['an unknown role', { role: 'root' }, 'role'],
    ['a null role', { role: null }, 'role'],
    ['a string isActive', { isActive: 'false' }, 'isActive'],
  ])('rejects %s with a 400', async (_label, body, field) => {
    const admin = await createUser('admin');
    const target = await createUser('customer');

    const response = await update(admin.token, target.id, body);

    expectValidationError(response, field);
    expect((await User.findById(target.id).lean()).role).toBe('customer');
  });

  it.each([
    ['an invalid id', 'not-an-id'],
    ['a 12-character id', 'abcdefghijkl'],
    ['an unknown id', new mongoose.Types.ObjectId().toString()],
  ])('returns 404 for %s', async (_label, id) => {
    const admin = await createUser('admin');

    const response = await update(admin.token, id, { role: 'agent' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('answers 400 before 404', async () => {
    const admin = await createUser('admin');

    expectValidationError(await update(admin.token, 'not-an-id', {}), '');
  });

  describe('self-protection', () => {
    it.each([
      ['demote', { role: 'agent' }],
      ['deactivate', { isActive: false }],
      ['send a no-op change for', { role: 'admin', isActive: true }],
    ])('refuses to let an admin %s themselves', async (_label, body) => {
      const admin = await createUser('admin');
      await createUser('admin'); // Not the last admin: the self rule applies on its own.

      const response = await update(admin.token, admin.id, body);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CANNOT_CHANGE_SELF');
      expect(await User.findById(admin.id).lean()).toMatchObject({ role: 'admin', isActive: true });
    });

    it('matches the own id in upper case too', async () => {
      const admin = await createUser('admin');

      const response = await update(admin.token, admin.id.toUpperCase(), { role: 'agent' });

      expect(response.body.error.code).toBe('CANNOT_CHANGE_SELF');
    });
  });

  describe('last active admin', () => {
    // The caller is always another active admin, so the last admin can only be reached by
    // a concurrent request. This makes the target update look like it raced with one that
    // demoted the caller: right after the write, the caller loses the admin role.
    function demoteCallerRightAfterTheWrite(caller) {
      const original = User.findOneAndUpdate.bind(User);
      return jest.spyOn(User, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        await User.updateOne({ _id: caller.user._id }, { $set: { role: 'customer' } });
        return result;
      });
    }

    it.each([
      ['demoted', { role: 'agent' }],
      ['deactivated', { isActive: false }],
    ])('is never %s (409 LAST_ADMIN, change undone)', async (_label, body) => {
      const caller = await createUser('admin');
      const target = await createUser('admin');
      demoteCallerRightAfterTheWrite(caller);

      const response = await update(caller.token, target.id, body);

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual({
        code: 'LAST_ADMIN',
        message: 'The last active admin cannot be demoted or deactivated',
      });
      expect(await User.findById(target.id).lean()).toMatchObject({
        role: 'admin',
        isActive: true,
      });
    });

    it('is not checked when the target was not an active admin', async () => {
      const caller = await createUser('admin');
      const target = await createUser('agent');
      demoteCallerRightAfterTheWrite(caller);

      const response = await update(caller.token, target.id, { role: 'customer' });

      expect(response.status).toBe(200);
    });

    it('keeps an active admin when two admins demote each other at the same time', async () => {
      const first = await createUser('admin');
      const second = await createUser('admin');

      const responses = await Promise.all([
        update(first.token, second.id, { role: 'customer' }),
        update(second.token, first.id, { role: 'customer' }),
      ]);

      for (const response of responses) expect([200, 403, 409]).toContain(response.status);
      expect(await User.countDocuments({ role: 'admin', isActive: true })).toBeGreaterThan(0);
    });
  });

  it('returns 409 USER_CONFLICT when the user changed after it was read', async () => {
    const admin = await createUser('admin');
    const target = await createUser('agent');
    const original = User.findById.bind(User);
    jest.spyOn(User, 'findById').mockImplementation((id) => {
      if (String(id) !== target.id) return original(id);
      // Someone else deactivates the user between the route's read and its write.
      return {
        lean: async () => {
          const doc = await original(id).lean();
          await User.updateOne({ _id: target.user._id }, { $set: { isActive: false } });
          return doc;
        },
      };
    });

    const response = await update(admin.token, target.id, { role: 'customer' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('USER_CONFLICT');
    expect(await User.findById(target.id).lean()).toMatchObject({
      role: 'agent',
      isActive: false,
    });
  });
});

describe('effect on sessions and login', () => {
  async function userWithPassword(role) {
    const admin = await createUser('admin');
    const body = newUserBody({ role });
    const created = await create(admin.token, body);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: PASSWORD });
    return { admin, body, id: created.body.user.id, token: login.body.token };
  }

  const me = (token) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  it("stops a deactivated user's existing token at once (401)", async () => {
    const { admin, id, token } = await userWithPassword('agent');
    expect((await me(token)).status).toBe(200);

    await update(admin.token, id, { isActive: false });

    const response = await me(token);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(
      (await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401);
  });

  it('applies a role change on the next request with the same token', async () => {
    const { admin, id, token } = await userWithPassword('customer');
    const agentsBefore = await call('get', '/agents', token);

    await update(admin.token, id, { role: 'agent' });

    expect(agentsBefore.status).toBe(403);
    expect((await call('get', '/agents', token)).status).toBe(200);
    expect((await me(token)).body.user.role).toBe('agent');

    await update(admin.token, id, { role: 'customer' });
    expect((await call('get', '/agents', token)).status).toBe(403);
  });

  it('takes admin rights away from a demoted admin at once', async () => {
    const { admin, id, token } = await userWithPassword('admin');
    expect((await list(token)).status).toBe(200);

    await update(admin.token, id, { role: 'agent' });

    expect((await list(token)).status).toBe(403);
  });

  it('refuses login for a deactivated user with the same answer as a wrong password', async () => {
    const { admin, body, id } = await userWithPassword('agent');
    await update(admin.token, id, { isActive: false });

    const deactivated = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: PASSWORD });
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.user.email, password: 'wrong-password' });

    expect(deactivated.status).toBe(401);
    expect(deactivated.body).toEqual(wrongPassword.body);
    expect(deactivated.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    expect(deactivated.body).not.toHaveProperty('token');
  });

  it('lets a reactivated user log in again', async () => {
    const { admin, body, id } = await userWithPassword('agent');
    await update(admin.token, id, { isActive: false });
    await update(admin.token, id, { isActive: true });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: PASSWORD });

    expect(login.status).toBe(200);
  });
});
