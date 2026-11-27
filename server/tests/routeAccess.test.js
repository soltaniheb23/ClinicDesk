// RBAC over the real routes: every protected route against every role, plus missing,
// expired and deactivated-user tokens and other customers' tickets. The detailed rules of
// each route are tested in its own file; this file checks who gets in.
const os = require('node:os');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');
const User = require('../src/models/User');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const { signToken } = require('../src/auth/token');

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), Ticket.init(), Comment.init()]);
}, 120000);

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Ticket.deleteMany({}), Comment.deleteMany({})]);
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
  return { user, id: user.id, token: signToken(user) };
}

// Every protected route. `ticketStatus` is the status the customer-owned ticket starts in;
// `body(actor)` builds the request body for the user making the call.
const ROUTES = [
  { name: 'GET /auth/me', method: 'get', path: () => '/api/v1/auth/me' },
  {
    name: 'POST /tickets',
    method: 'post',
    path: () => '/api/v1/tickets',
    body: () => ({ title: 'Printer', description: 'Broken' }),
  },
  { name: 'GET /tickets', method: 'get', path: () => '/api/v1/tickets' },
  { name: 'GET /tickets/:id', method: 'get', path: (t) => `/api/v1/tickets/${t}`, ticket: true },
  {
    name: 'PATCH /tickets/:id/status (open -> in_progress)',
    method: 'patch',
    path: (t) => `/api/v1/tickets/${t}/status`,
    ticket: true,
    body: () => ({ status: 'in_progress' }),
  },
  {
    name: 'PATCH /tickets/:id/status (resolved -> closed)',
    method: 'patch',
    path: (t) => `/api/v1/tickets/${t}/status`,
    ticket: true,
    ticketStatus: 'resolved',
    body: () => ({ status: 'closed' }),
  },
  {
    name: 'PATCH /tickets/:id/assignee (self)',
    method: 'patch',
    path: (t) => `/api/v1/tickets/${t}/assignee`,
    ticket: true,
    body: (actor) => ({ assignee: actor.id }),
  },
  {
    name: 'GET /tickets/:id/comments',
    method: 'get',
    path: (t) => `/api/v1/tickets/${t}/comments`,
    ticket: true,
  },
  {
    name: 'POST /tickets/:id/comments (public)',
    method: 'post',
    path: (t) => `/api/v1/tickets/${t}/comments`,
    ticket: true,
    body: () => ({ body: 'Hello' }),
  },
  {
    name: 'POST /tickets/:id/comments (internal)',
    method: 'post',
    path: (t) => `/api/v1/tickets/${t}/comments`,
    ticket: true,
    body: () => ({ body: 'Note', internal: true }),
  },
  {
    name: 'GET /tickets/:id/attachments',
    method: 'get',
    path: (t) => `/api/v1/tickets/${t}/attachments`,
    ticket: true,
  },
  { name: 'GET /users/agents', method: 'get', path: () => '/api/v1/users/agents' },
  { name: 'GET /users', method: 'get', path: () => '/api/v1/users' },
  {
    name: 'POST /users',
    method: 'post',
    path: () => '/api/v1/users',
    body: () => ({
      name: 'New Agent',
      email: `new-agent-${new mongoose.Types.ObjectId()}@example.com`,
      password: 'a-long-password',
      role: 'agent',
    }),
  },
  {
    // The target is the customer who owns the ticket (never the caller).
    name: 'PATCH /users/:id (role)',
    method: 'patch',
    path: (_ticketId, owner) => `/api/v1/users/${owner.id}`,
    body: () => ({ role: 'agent' }),
  },
  { name: 'GET /audit-logs', method: 'get', path: () => '/api/v1/audit-logs' },
  { name: 'GET /metrics', method: 'get', path: () => '/api/v1/metrics' },
  { name: 'POST /debug/sentry-test', method: 'post', path: () => '/api/v1/debug/sentry-test' },
];

// Expected status per role, with the customer acting on their own ticket.
const EXPECTED = {
  'GET /auth/me': { customer: 200, agent: 200, admin: 200 },
  'POST /tickets': { customer: 201, agent: 201, admin: 201 },
  'GET /tickets': { customer: 200, agent: 200, admin: 200 },
  'GET /tickets/:id': { customer: 200, agent: 200, admin: 200 },
  'PATCH /tickets/:id/status (open -> in_progress)': { customer: 403, agent: 200, admin: 200 },
  'PATCH /tickets/:id/status (resolved -> closed)': { customer: 200, agent: 200, admin: 200 },
  'PATCH /tickets/:id/assignee (self)': { customer: 403, agent: 200, admin: 200 },
  'GET /tickets/:id/comments': { customer: 200, agent: 200, admin: 200 },
  'POST /tickets/:id/comments (public)': { customer: 201, agent: 201, admin: 201 },
  'POST /tickets/:id/comments (internal)': { customer: 403, agent: 201, admin: 201 },
  'GET /tickets/:id/attachments': { customer: 200, agent: 200, admin: 200 },
  'GET /users/agents': { customer: 403, agent: 200, admin: 200 },
  'GET /users': { customer: 403, agent: 403, admin: 200 },
  'POST /users': { customer: 403, agent: 403, admin: 201 },
  'PATCH /users/:id (role)': { customer: 403, agent: 403, admin: 200 },
  'GET /audit-logs': { customer: 403, agent: 403, admin: 200 },
  'GET /metrics': { customer: 403, agent: 403, admin: 200 },
  'POST /debug/sentry-test': { customer: 403, agent: 403, admin: 200 },
};

const ROLES = ['customer', 'agent', 'admin'];
const TICKET_ROUTES = ROUTES.filter((route) => route.ticket);

const matrix = ROUTES.flatMap((route) =>
  ROLES.map((role) => [route.name, role, EXPECTED[route.name][role], route]),
);

// `owner` is the customer who owns the ticket; user routes use them as the target user.
function send(route, ticketId, token, actor, owner) {
  const pending = request(app)[route.method](route.path(ticketId, owner));
  if (token) pending.set('Authorization', `Bearer ${token}`);
  return route.body ? pending.send(route.body(actor ?? {})) : pending;
}

async function customerTicket(owner, status = 'open') {
  return Ticket.create({
    title: 'Printer in reception not working',
    description: 'It shows error E-12.',
    createdBy: owner.user._id,
    status,
  });
}

it('has an expected result for every route and role', () => {
  expect(Object.keys(EXPECTED).sort()).toEqual(ROUTES.map((route) => route.name).sort());
});

describe.each(matrix)('%s as %s', (_name, role, expected, route) => {
  it(`answers ${expected}`, async () => {
    const owner = await createUser('customer');
    const actor = role === 'customer' ? owner : await createUser(role);
    const ticket = await customerTicket(owner, route.ticketStatus);

    const response = await send(route, ticket.id, actor.token, actor, owner);

    expect(response.status).toBe(expected);
    if (expected === 403) expect(response.body).toEqual(FORBIDDEN);
  });
});

describe.each(ROUTES.map((route) => [route.name, route]))(
  '%s without a valid session',
  (_name, route) => {
    async function setup() {
      const owner = await createUser('customer');
      const ticket = await customerTicket(owner, route.ticketStatus);
      return { owner, ticket };
    }

    it('returns 401 without a token', async () => {
      const { owner, ticket } = await setup();

      const response = await send(route, ticket.id, null, null, owner);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    });

    it('returns 401 for an expired token', async () => {
      const { owner, ticket } = await setup();
      const expired = jwt.sign(
        { sub: owner.id, role: 'customer', exp: Math.floor(Date.now() / 1000) - 1 },
        'test-secret',
      );

      const response = await send(route, ticket.id, expired, owner, owner);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    });

    it.each(ROLES)('returns 401 for a deactivated %s with a valid token', async (role) => {
      const { owner, ticket } = await setup();
      const actor = await createUser(role, { isActive: false });

      const response = await send(route, ticket.id, actor.token, actor, owner);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    });
  },
);

describe.each(TICKET_ROUTES.map((route) => [route.name, route]))(
  "%s on another customer's ticket",
  (_name, route) => {
    it('returns the same 404 as an unknown ticket and changes nothing', async () => {
      const owner = await createUser('customer');
      const stranger = await createUser('customer');
      const ticket = await customerTicket(owner, route.ticketStatus);

      const foreign = await send(route, ticket.id, stranger.token, stranger);
      const unknown = await send(
        route,
        new mongoose.Types.ObjectId().toString(),
        stranger.token,
        stranger,
      );

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(NOT_FOUND);
      expect(unknown.body).toEqual(foreign.body);

      const stored = await Ticket.findById(ticket.id).lean();
      expect(stored.status).toBe(route.ticketStatus ?? 'open');
      expect(stored.assignee).toBeNull();
      expect(await Comment.countDocuments()).toBe(0);
    });
  },
);
