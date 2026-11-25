// GET /api/v1/tickets filters, search, sorting and pagination (CD-17, docs/ticket-list.md).
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
const { escapeRegex } = require('../src/tickets/listQuery');

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

function list(token, query = '') {
  return request(app).get(`/api/v1/tickets${query}`).set('Authorization', `Bearer ${token}`);
}

const BASE_TIME = Date.UTC(2026, 11, 1);
let ticketCount = 0;

// Inserts one ticket per spec; createdAt increases with the order given unless set.
async function seed(owner, specs) {
  return Ticket.insertMany(
    specs.map((spec, index) => {
      ticketCount += 1;
      return {
        title: `Ticket ${ticketCount}`,
        description: 'Details',
        category: 'other',
        priority: 'normal',
        status: 'open',
        createdBy: owner._id,
        createdAt: new Date(BASE_TIME + index * 60000),
        ...spec,
      };
    }),
  );
}

function titles(response) {
  return response.body.items.map((ticket) => ticket.title);
}

function expectValidationError(response, field) {
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
}

describe('filters', () => {
  let agent;
  let customer;

  beforeEach(async () => {
    agent = await createUser('agent');
    customer = await createUser('customer');
    await seed(customer.user, [
      { title: 'A', status: 'open', priority: 'low', category: 'it' },
      { title: 'B', status: 'in_progress', priority: 'high', category: 'facility' },
      { title: 'C', status: 'waiting', priority: 'urgent', category: 'it' },
      { title: 'D', status: 'resolved', priority: 'normal', category: 'account' },
      { title: 'E', status: 'closed', priority: 'high', category: 'other' },
      { title: 'F', status: 'open', priority: 'high', category: 'it' },
    ]);
  });

  it.each([
    ['status=open', ['F', 'A']],
    ['priority=high', ['F', 'E', 'B']],
    ['category=it', ['F', 'C', 'A']],
    ['status=open,in_progress', ['F', 'B', 'A']],
    ['priority=low,urgent', ['C', 'A']],
    ['category=account,other', ['E', 'D']],
    ['status=open&priority=high', ['F']],
    ['status=open,waiting&category=it&priority=urgent', ['C']],
    ['status=closed&category=it', []],
    ['status=open, in_progress', ['F', 'B', 'A']],
  ])('?%s', async (query, expected) => {
    const response = await list(agent.token, `?${query}`);

    expect(response.status).toBe(200);
    expect(titles(response)).toEqual(expected);
    expect(response.body.total).toBe(expected.length);
  });

  it('filters by assignee: me, unassigned and a user id', async () => {
    const other = await createUser('agent');
    await Ticket.updateOne({ title: 'A' }, { assignee: agent.user._id });
    await Ticket.updateOne({ title: 'C' }, { assignee: agent.user._id });
    await Ticket.updateOne({ title: 'D' }, { assignee: other.user._id });

    const mine = await list(agent.token, '?assignee=me');
    const unassigned = await list(agent.token, '?assignee=unassigned');
    const byId = await list(agent.token, `?assignee=${other.user.id}`);
    const combined = await list(agent.token, '?assignee=me&status=open');

    expect(titles(mine)).toEqual(['C', 'A']);
    expect(mine.body.items[0].assignee).toEqual({ id: agent.user.id, name: agent.user.name });
    expect(titles(unassigned)).toEqual(['F', 'E', 'B']);
    expect(titles(byId)).toEqual(['D']);
    expect(titles(combined)).toEqual(['A']);
  });

  it('lets an admin filter by assignee too', async () => {
    const admin = await createUser('admin');
    await Ticket.updateOne({ title: 'B' }, { assignee: admin.user._id });

    const response = await list(admin.token, '?assignee=me');

    expect(response.status).toBe(200);
    expect(titles(response)).toEqual(['B']);
  });

  it.each(['me', 'unassigned', '6651b2a7c3d4e5f6a7b8c9d1'])(
    'answers 403 when a customer sends assignee=%s',
    async (value) => {
      const response = await list(customer.token, `?assignee=${value}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    },
  );
});

describe('customer scope', () => {
  let customer;
  let stranger;
  let agent;

  beforeEach(async () => {
    customer = await createUser('customer');
    stranger = await createUser('customer');
    agent = await createUser('agent');
    await seed(customer.user, [{ title: 'Mine: printer jam', status: 'open', priority: 'high' }]);
    await seed(stranger.user, [
      { title: 'Theirs: printer jam', status: 'open', priority: 'high', assignee: agent.user._id },
      { title: 'Theirs: closed', status: 'closed', priority: 'urgent', category: 'it' },
    ]);
  });

  it.each([
    '',
    '?status=open',
    '?status=open,in_progress,waiting,resolved,closed',
    '?priority=high,urgent',
    '?category=it,facility,account,other',
    '?q=printer',
    '?q=Theirs',
    '?q=.*',
    '?sort=priority&order=asc',
    '?sort=status&order=desc&limit=50',
  ])('never shows another customer’s ticket for "%s"', async (query) => {
    const response = await list(customer.token, query);

    expect(response.status).toBe(200);
    for (const ticket of response.body.items) {
      expect(ticket.createdBy.id).toBe(customer.user.id);
    }
    expect(response.body.total).toBe(response.body.items.length);
    expect(titles(response).every((title) => title.startsWith('Mine'))).toBe(true);
  });

  it.each([`createdBy=__OTHER__`, `createdBy[$ne]=x`, `status[$ne]=closed`, `$where=1`])(
    'rejects an attempt to widen the scope with "%s"',
    async (query) => {
      const response = await list(
        customer.token,
        `?${query.replace('__OTHER__', stranger.user.id)}`,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('shows staff every ticket that matches', async () => {
    const response = await list(agent.token, '?q=printer');

    expect(titles(response).sort()).toEqual(['Mine: printer jam', 'Theirs: printer jam']);
  });
});

describe('title search', () => {
  let agent;

  beforeEach(async () => {
    agent = await createUser('agent');
    await seed(agent.user, [
      { title: 'Printer in reception not working' },
      { title: 'Laser PRINTER toner low' },
      { title: 'Account locked' },
      { title: 'Regex chars .* inside (title)' },
      { title: 'Price is $5 + tax?' },
    ]);
  });

  it('is case-insensitive and matches inside the title', async () => {
    const response = await list(agent.token, '?q=printer');
    const inside = await list(agent.token, '?q=ocke');

    expect(titles(response)).toEqual([
      'Laser PRINTER toner low',
      'Printer in reception not working',
    ]);
    expect(titles(inside)).toEqual(['Account locked']);
  });

  it('trims the search text', async () => {
    const response = await list(agent.token, `?q=${encodeURIComponent('  locked  ')}`);

    expect(titles(response)).toEqual(['Account locked']);
  });

  it.each([
    ['.*', ['Regex chars .* inside (title)']],
    ['(', ['Regex chars .* inside (title)']],
    ['(title)', ['Regex chars .* inside (title)']],
    ['$5 + tax?', ['Price is $5 + tax?']],
    ['[a-z]', []],
    ['^Account', []],
    ['\\', []],
    ['(a+)+$', []],
    ['.', ['Regex chars .* inside (title)']],
  ])('treats %j as plain text', async (q, expected) => {
    const response = await list(agent.token, `?q=${encodeURIComponent(q)}`);

    expect(response.status).toBe(200);
    expect(titles(response)).toEqual(expected);
  });

  it('combines search with filters', async () => {
    await Ticket.updateOne({ title: 'Laser PRINTER toner low' }, { status: 'waiting' });

    const response = await list(agent.token, '?q=printer&status=waiting');

    expect(titles(response)).toEqual(['Laser PRINTER toner low']);
    expect(response.body.total).toBe(1);
  });

  it.each([
    ['', 'q'],
    ['   ', 'q'],
    ['x'.repeat(101), 'q'],
  ])('rejects q=%j', async (q, field) => {
    expectValidationError(await list(agent.token, `?q=${encodeURIComponent(q)}`), field);
  });

  it('accepts a 100-character search', async () => {
    const response = await list(agent.token, `?q=${'x'.repeat(100)}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  it('escapes every regex special character', () => {
    const special = '.*+?^${}()|[]\\/-';
    expect(new RegExp(escapeRegex(special)).test(`x${special}y`)).toBe(true);
    expect(new RegExp(`^${escapeRegex('a.c')}$`).test('abc')).toBe(false);
  });
});

describe('validation', () => {
  let agent;

  beforeEach(async () => {
    agent = await createUser('agent');
  });

  it.each([
    ['status=pending', 'status'],
    ['status=open,', 'status'],
    ['status=', 'status'],
    ['priority=critical', 'priority'],
    ['category=IT', 'category'],
    ['assignee=someone', 'assignee'],
    ['assignee=aaaaaaaaaaaa', 'assignee'],
    ['sort=title', 'sort'],
    ['sort=createdBy', 'sort'],
    ['order=up', 'order'],
    ['page=0', 'page'],
    ['limit=51', 'limit'],
  ])('rejects ?%s', async (query, field) => {
    expectValidationError(await list(agent.token, `?${query}`), field);
  });

  it.each([
    ['status[$ne]=closed', 'status[$ne]'],
    ['status[$regex]=.*', 'status[$regex]'],
    ['q[$regex]=.*', 'q[$regex]'],
    ['assignee[$exists]=true', 'assignee[$exists]'],
    ['sort[createdAt]=1', 'sort[createdAt]'],
    ['$where=1', '$where'],
    ['createdBy=6651b2a7c3d4e5f6a7b8c9d1', 'createdBy'],
  ])('rejects the operator or unknown key in ?%s', async (query, field) => {
    expectValidationError(await list(agent.token, `?${query}`), field);
  });

  it.each([
    ['status=open&status=closed', 'status'],
    ['q=a&q=b', 'q'],
    ['sort=priority&sort=status', 'sort'],
  ])('rejects the repeated parameter in ?%s', async (query, field) => {
    expectValidationError(await list(agent.token, `?${query}`), field);
  });

  it('checks the query before the assignee permission', async () => {
    const customer = await createUser('customer');

    expectValidationError(await list(customer.token, '?assignee=me&sort=title'), 'sort');
  });
});

describe('sorting', () => {
  let agent;

  beforeEach(async () => {
    agent = await createUser('agent');
  });

  it('sorts by priority by meaning in both directions', async () => {
    await seed(agent.user, [
      { title: 'normal', priority: 'normal' },
      { title: 'urgent', priority: 'urgent' },
      { title: 'low', priority: 'low' },
      { title: 'high', priority: 'high' },
    ]);

    const desc = await list(agent.token, '?sort=priority');
    const asc = await list(agent.token, '?sort=priority&order=asc');

    expect(titles(desc)).toEqual(['urgent', 'high', 'normal', 'low']);
    expect(titles(asc)).toEqual(['low', 'normal', 'high', 'urgent']);
  });

  it('sorts by status in workflow order in both directions', async () => {
    await seed(agent.user, [
      { title: 'waiting', status: 'waiting' },
      { title: 'closed', status: 'closed' },
      { title: 'open', status: 'open' },
      { title: 'resolved', status: 'resolved' },
      { title: 'in_progress', status: 'in_progress' },
    ]);

    const asc = await list(agent.token, '?sort=status&order=asc');
    const desc = await list(agent.token, '?sort=status&order=desc');

    expect(titles(asc)).toEqual(['open', 'in_progress', 'waiting', 'resolved', 'closed']);
    expect(titles(desc)).toEqual(['closed', 'resolved', 'waiting', 'in_progress', 'open']);
  });

  it('puts the newest first within the same priority', async () => {
    await seed(agent.user, [
      { title: 'high old', priority: 'high' },
      { title: 'low', priority: 'low' },
      { title: 'high new', priority: 'high' },
    ]);

    const response = await list(agent.token, '?sort=priority');

    expect(titles(response)).toEqual(['high new', 'high old', 'low']);
  });

  it('sorts by createdAt and updatedAt in both directions', async () => {
    await seed(agent.user, [
      { title: 'first', updatedAt: new Date(BASE_TIME + 3 * 60000) },
      { title: 'second', updatedAt: new Date(BASE_TIME + 1 * 60000) },
      { title: 'third', updatedAt: new Date(BASE_TIME + 2 * 60000) },
    ]);

    expect(titles(await list(agent.token, ''))).toEqual(['third', 'second', 'first']);
    expect(titles(await list(agent.token, '?order=asc'))).toEqual(['first', 'second', 'third']);
    expect(titles(await list(agent.token, '?sort=updatedAt'))).toEqual([
      'first',
      'third',
      'second',
    ]);
    expect(titles(await list(agent.token, '?sort=updatedAt&order=asc'))).toEqual([
      'second',
      'third',
      'first',
    ]);
  });

  it('keeps a stable order across pages when createdAt is equal', async () => {
    const sameTime = new Date(BASE_TIME);
    const seeded = await seed(
      agent.user,
      Array.from({ length: 7 }, (_, index) => ({ title: `Same ${index}`, createdAt: sameTime })),
    );
    const byIdDesc = seeded
      .map((ticket) => ticket.id)
      .sort()
      .reverse();

    const pages = await Promise.all(
      [1, 2, 3].map((page) => list(agent.token, `?page=${page}&limit=3`)),
    );
    const ids = pages.flatMap((page) => page.body.items.map((ticket) => ticket.id));

    expect(ids).toEqual(byIdDesc);
    expect(new Set(ids).size).toBe(7);

    const again = await list(agent.token, '?page=2&limit=3');
    expect(again.body.items.map((ticket) => ticket.id)).toEqual(byIdDesc.slice(3, 6));
  });

  it('keeps a stable order across pages for priority ties', async () => {
    const sameTime = new Date(BASE_TIME);
    await seed(
      agent.user,
      Array.from({ length: 5 }, (_, index) => ({ title: `Tie ${index}`, createdAt: sameTime })),
    );

    const first = await list(agent.token, '?sort=priority&limit=2');
    const second = await list(agent.token, '?sort=priority&limit=2&page=2');
    const third = await list(agent.token, '?sort=priority&limit=2&page=3');
    const ids = [first, second, third].flatMap((page) => page.body.items.map((t) => t.id));

    expect(new Set(ids).size).toBe(5);
  });
});

describe('pagination with filters', () => {
  it('counts and pages only the matching tickets', async () => {
    const agent = await createUser('agent');
    await seed(
      agent.user,
      Array.from({ length: 12 }, (_, index) => ({
        title: `T${String(index).padStart(2, '0')}`,
        status: index % 2 === 0 ? 'open' : 'closed',
      })),
    );

    const first = await list(agent.token, '?status=open&limit=4');
    const second = await list(agent.token, '?status=open&limit=4&page=2');
    const past = await list(agent.token, '?status=open&limit=4&page=3');

    expect(first.body).toMatchObject({ page: 1, limit: 4, total: 6, totalPages: 2 });
    expect(titles(first)).toEqual(['T10', 'T08', 'T06', 'T04']);
    expect(second.body).toMatchObject({ page: 2, limit: 4, total: 6, totalPages: 2 });
    expect(titles(second)).toEqual(['T02', 'T00']);
    expect(past.body).toMatchObject({ items: [], total: 6, totalPages: 2 });
  });

  it('answers total 0 and totalPages 0 when nothing matches', async () => {
    const agent = await createUser('agent');
    await seed(agent.user, [{ status: 'open' }]);

    const response = await list(agent.token, '?status=closed');

    expect(response.body).toMatchObject({ items: [], page: 1, total: 0, totalPages: 0 });
  });

  it('counts a customer’s matches only within their own tickets', async () => {
    const customer = await createUser('customer');
    const stranger = await createUser('customer');
    await seed(customer.user, [{ status: 'open' }, { status: 'open' }, { status: 'closed' }]);
    await seed(stranger.user, [{ status: 'open' }, { status: 'open' }]);

    const response = await list(customer.token, '?status=open&limit=1');

    expect(response.body).toMatchObject({ total: 2, totalPages: 2 });
  });
});
