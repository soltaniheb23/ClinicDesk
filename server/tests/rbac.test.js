const os = require('node:os');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const User = require('../src/models/User');
const { signToken } = require('../src/auth/token');
const { authenticate } = require('../src/auth/authenticate');
const { requireRole, canAccessOwnedResource } = require('../src/auth/authorize');

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};

// Test-only routes. They exist only in this file, never in the production app.
// Owned resources stand in for tickets until CD-11 adds the real ticket routes.
const ownedResources = new Map();

function buildTestApp() {
  const testApp = express();
  const ok = (request_, response) => response.json({ user: request_.user });

  testApp.get('/test/authenticated', authenticate, ok);
  testApp.get('/test/agent-only', authenticate, requireRole('agent'), ok);
  testApp.get('/test/admin-only', authenticate, requireRole('admin'), ok);
  testApp.get('/test/staff', authenticate, requireRole('agent', 'admin'), ok);
  testApp.get('/test/resources/:id', authenticate, (request_, response) => {
    const resource = ownedResources.get(request_.params.id);

    // Like the planned ticket routes, hide resources the user may not see behind a 404.
    if (!resource || !canAccessOwnedResource(request_.user, resource.ownerId)) {
      return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    return response.json({ resource });
  });

  // eslint-disable-next-line no-unused-vars
  testApp.use((error, _request, response, _next) => {
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  });

  return testApp;
}

const testApp = buildTestApp();
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await User.init();
}, 120000);

afterEach(async () => {
  await User.deleteMany({});
  ownedResources.clear();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

let userCount = 0;
async function createUser(role, overrides = {}) {
  userCount += 1;
  return User.create({
    name: `${role} ${userCount}`,
    email: `${role}${userCount}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
    ...overrides,
  });
}

function get(path, token) {
  const pending = request(testApp).get(path);
  return token ? pending.set('Authorization', `Bearer ${token}`) : pending;
}

describe('authenticate', () => {
  it('returns 401 without a token', async () => {
    const response = await get('/test/authenticated');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a Bearer header without a token', 'Bearer'],
    ['a token that is not a JWT', 'Bearer not-a-jwt'],
  ])('returns 401 for %s', async (_label, header) => {
    const response = await request(testApp).get('/test/authenticated').set('Authorization', header);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it('returns 401 for an expired token', async () => {
    const user = await createUser('customer');
    const expired = jwt.sign(
      { sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) - 60 },
      'test-secret',
    );

    const response = await get('/test/authenticated', expired);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it('returns 401 for a token signed with another secret', async () => {
    const user = await createUser('admin');
    const forged = jwt.sign({ sub: user.id, role: 'admin' }, 'some-other-secret');

    const response = await get('/test/admin-only', forged);

    expect(response.status).toBe(401);
  });

  it('returns 401 for an unsigned ("alg": "none") token', async () => {
    const user = await createUser('admin');
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: user.id, role: 'admin' })}.`;

    const response = await get('/test/admin-only', unsigned);

    expect(response.status).toBe(401);
  });

  it('returns 401 for a token whose subject is not a valid id', async () => {
    const token = jwt.sign({ sub: 'not-an-object-id', role: 'admin' }, 'test-secret');

    const response = await get('/test/authenticated', token);

    expect(response.status).toBe(401);
  });

  it('returns 401 for a deactivated user', async () => {
    const user = await createUser('agent');
    const token = signToken(user);
    await User.updateOne({ _id: user._id }, { isActive: false });

    const response = await get('/test/authenticated', token);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it('returns 401 for a deleted user', async () => {
    const user = await createUser('customer');
    const token = signToken(user);
    await User.deleteOne({ _id: user._id });

    const response = await get('/test/authenticated', token);

    expect(response.status).toBe(401);
  });

  it('sets request.user to the id and role from the database', async () => {
    const user = await createUser('customer');

    const response = await get('/test/authenticated', signToken(user));

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: user.id, role: 'customer' });
  });

  it('answers 500, not 401, when JWT_SECRET is missing on the server', async () => {
    const user = await createUser('customer');
    const token = signToken(user);
    delete process.env.JWT_SECRET;

    try {
      const response = await get('/test/authenticated', token);
      expect(response.status).toBe(500);
    } finally {
      process.env.JWT_SECRET = 'test-secret';
    }
  });
});

describe('requireRole', () => {
  it('returns 403 for a customer on an agent-only route', async () => {
    const customer = await createUser('customer');

    const response = await get('/test/agent-only', signToken(customer));

    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN);
  });

  it('lets an agent through an agent-only route', async () => {
    const agent = await createUser('agent');

    const response = await get('/test/agent-only', signToken(agent));

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('agent');
  });

  it('lets an admin through an admin-only route', async () => {
    const admin = await createUser('admin');

    const response = await get('/test/admin-only', signToken(admin));

    expect(response.status).toBe(200);
  });

  it('returns 403 for an agent on an admin-only route', async () => {
    const agent = await createUser('agent');

    const response = await get('/test/admin-only', signToken(agent));

    expect(response.status).toBe(403);
  });

  it('accepts any of several roles', async () => {
    const agent = await createUser('agent');
    const admin = await createUser('admin');
    const customer = await createUser('customer');

    expect((await get('/test/staff', signToken(agent))).status).toBe(200);
    expect((await get('/test/staff', signToken(admin))).status).toBe(200);
    expect((await get('/test/staff', signToken(customer))).status).toBe(403);
  });

  it('applies a promotion in the database immediately, even with an old token', async () => {
    const user = await createUser('customer');
    const oldToken = signToken(user);
    expect((await get('/test/agent-only', oldToken)).status).toBe(403);

    await User.updateOne({ _id: user._id }, { role: 'agent' });

    expect((await get('/test/agent-only', oldToken)).status).toBe(200);
  });

  it('applies a demotion immediately: an old admin token no longer grants admin access', async () => {
    const user = await createUser('admin');
    const oldToken = signToken(user);
    expect(jwt.decode(oldToken).role).toBe('admin');

    await User.updateOne({ _id: user._id }, { role: 'customer' });

    const response = await get('/test/admin-only', oldToken);
    expect(response.status).toBe(403);
    expect(response.body).toEqual(FORBIDDEN);
  });

  it('refuses with 401 when authenticate did not run', async () => {
    const bareApp = express();
    bareApp.get('/x', requireRole('admin'), (_request, response) => response.json({}));

    const response = await request(bareApp).get('/x');

    expect(response.status).toBe(401);
  });

  it('needs at least one role', () => {
    expect(() => requireRole()).toThrow('requireRole needs at least one role');
  });
});

describe('canAccessOwnedResource', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();

  it('lets a customer access their own resource (string or ObjectId owner)', () => {
    const customer = { id: ownerId.toString(), role: 'customer' };

    expect(canAccessOwnedResource(customer, ownerId)).toBe(true);
    expect(canAccessOwnedResource(customer, ownerId.toString())).toBe(true);
  });

  it("blocks another customer's resource", () => {
    const customer = { id: otherId.toString(), role: 'customer' };

    expect(canAccessOwnedResource(customer, ownerId)).toBe(false);
  });

  it('lets agents and admins access any resource', () => {
    expect(canAccessOwnedResource({ id: otherId.toString(), role: 'agent' }, ownerId)).toBe(true);
    expect(canAccessOwnedResource({ id: otherId.toString(), role: 'admin' }, ownerId)).toBe(true);
  });

  it('denies missing users, missing owners and unknown roles', () => {
    expect(canAccessOwnedResource(null, ownerId)).toBe(false);
    expect(canAccessOwnedResource({ id: ownerId.toString(), role: 'customer' }, null)).toBe(false);
    expect(canAccessOwnedResource({ id: ownerId.toString(), role: 'guest' }, ownerId)).toBe(false);
  });

  it("stops a customer from reading another customer's resource over HTTP", async () => {
    const alice = await createUser('customer');
    const bob = await createUser('customer');
    const agent = await createUser('agent');
    ownedResources.set('r1', { id: 'r1', ownerId: alice._id });

    expect((await get('/test/resources/r1', signToken(alice))).status).toBe(200);
    expect((await get('/test/resources/r1', signToken(bob))).status).toBe(404);
    expect((await get('/test/resources/r1', signToken(agent))).status).toBe(200);
  });
});
