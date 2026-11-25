// Security hardening (CD-24, docs/security-review.md): helmet headers, the CORS allowlist,
// rate limits and trust proxy. Every test that needs a limiter builds its own app, so the
// counters never leak between tests.
const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const { createApp } = require('../src/app');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');
const { hashPassword } = require('../src/auth/password');
const { createLimiters, DEFAULTS } = require('../src/security/rateLimit');

const PASSWORD = 'a-long-password';
const ALLOWED = 'https://clinicdesk.vercel.app';
const SECOND = 'https://staging-clinicdesk.vercel.app';
const UNKNOWN = 'https://evil.example';

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Promise.all([User.init(), AuditLog.init()]);
}, 120000);

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([User.deleteMany({}), AuditLog.collection.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

function appWith({ env = {}, rateLimit = { enabled: false } } = {}) {
  return createApp({ env: { NODE_ENV: 'test', ...env }, rateLimit });
}

async function createUser(email = 'mara@example.com') {
  return User.create({
    name: 'Mara Jensen',
    email,
    passwordHash: await hashPassword(PASSWORD),
  });
}

describe('helmet', () => {
  function expectSecurityHeaders(response) {
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['x-powered-by']).toBeUndefined();
  }

  it('sets the headers on a 200', async () => {
    const response = await request(appWith()).get('/health');

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it('sets the headers on a JSON 404 for an unknown path or method', async () => {
    const app = appWith();
    const unknownPath = await request(app).get('/api/v1/nope');
    const unknownMethod = await request(app).delete('/api/v1/hello');

    for (const response of [unknownPath, unknownMethod]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      expectSecurityHeaders(response);
    }
  });

  it('sets the headers on a 400 for invalid JSON', async () => {
    const response = await request(appWith())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expectSecurityHeaders(response);
  });

  it('sets the headers on a 500, without leaking the error', async () => {
    jest.spyOn(User, 'findOne').mockImplementation(() => {
      throw new Error('database exploded');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(appWith())
      .post('/api/v1/auth/login')
      .send({ email: 'mara@example.com', password: PASSWORD });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(PASSWORD);
    expectSecurityHeaders(response);
  });
});

describe('CORS allowlist', () => {
  const app = () => appWith({ env: { CLIENT_ORIGIN: `${ALLOWED}/, ${SECOND}` } });

  it('echoes an allowed origin, with Vary: Origin', async () => {
    const response = await request(app()).get('/api/v1/hello').set('Origin', ALLOWED);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(response.headers.vary).toMatch(/Origin/);
  });

  it('allows every listed origin', async () => {
    const response = await request(app()).get('/api/v1/hello').set('Origin', SECOND);

    expect(response.headers['access-control-allow-origin']).toBe(SECOND);
  });

  it.each([
    ['an unknown origin', UNKNOWN],
    ['a prefix of an allowed origin', 'https://clinicdesk.vercel.app.evil.example'],
    ['another scheme', 'http://clinicdesk.vercel.app'],
    ['another port', 'https://clinicdesk.vercel.app:8443'],
    ['"null"', 'null'],
  ])('sends no CORS headers for %s, but still Vary: Origin', async (_label, origin) => {
    const response = await request(app()).get('/api/v1/hello').set('Origin', origin);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers.vary).toMatch(/Origin/);
  });

  it('answers a preflight from an allowed origin', async () => {
    const response = await request(app())
      .options('/api/v1/tickets')
      .set('Origin', SECOND)
      .set('Access-Control-Request-Method', 'PATCH');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(SECOND);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
    expect(response.headers['access-control-max-age']).toBe('600');
  });

  it('does not answer a preflight from an unknown origin', async () => {
    const response = await request(app())
      .options('/api/v1/tickets')
      .set('Origin', UNKNOWN)
      .set('Access-Control-Request-Method', 'PATCH');

    // It falls through to the API like any other request (here: 401 from the tickets
    // router), never the 204 a browser needs to send the real request.
    expect(response.status).not.toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
    expect(response.headers['access-control-allow-headers']).toBeUndefined();
  });

  it('never produces "*", even if it is configured', async () => {
    const wildcard = appWith({ env: { CLIENT_ORIGIN: '*' } });

    const response = await request(wildcard).get('/api/v1/hello').set('Origin', UNKNOWN);
    const star = await request(wildcard).get('/api/v1/hello').set('Origin', '*');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(star.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows no origin when CLIENT_ORIGIN is empty', async () => {
    const response = await request(appWith()).get('/api/v1/hello').set('Origin', ALLOWED);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps CORS headers on a 429, so the browser can show the error', async () => {
    const limited = appWith({
      env: { CLIENT_ORIGIN: ALLOWED },
      rateLimit: { enabled: true, global: { max: 1 } },
    });
    await request(limited).get('/api/v1/hello').set('Origin', ALLOWED);

    const response = await request(limited).get('/api/v1/hello').set('Origin', ALLOWED);

    expect(response.status).toBe(429);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
  });
});

describe('rate limits', () => {
  const login = (app, email = 'mara@example.com', password = 'wrong-password') =>
    request(app).post('/api/v1/auth/login').send({ email, password });
  const register = (app, index) =>
    request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'New User', email: `new${index}@example.com`, password: PASSWORD });

  function expectRateLimited(response) {
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: expect.stringMatching(/^Too many .* Try again in \d+ minutes?\.$/),
      },
    });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.headers['ratelimit-policy']).toEqual(expect.any(String));
    expect(response.headers['ratelimit']).toEqual(expect.any(String));
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  }

  it('limits failed logins and answers 429 with Retry-After', async () => {
    await createUser();
    const app = appWith({ rateLimit: { enabled: true, login: { max: 3 } } });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await login(app)).status).toBe(401);
    }
    const limited = await login(app);
    // Even the right password is refused until the window ends.
    const rightPassword = await login(app, 'mara@example.com', PASSWORD);

    expectRateLimited(limited);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
    expect(limited.body.error.message).toBe('Too many login attempts. Try again in 15 minutes.');
    expect(rightPassword.status).toBe(429);
  });

  it('does not count successful logins', async () => {
    await createUser();
    const app = appWith({ rateLimit: { enabled: true, login: { max: 2 } } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(app, 'mara@example.com', PASSWORD)).status).toBe(200);
    }
    expect((await login(app)).status).toBe(401);
    expect((await login(app)).status).toBe(401);
    expect((await login(app)).status).toBe(429);
  });

  it('writes no audit entry for a rate-limited login', async () => {
    await createUser();
    const app = appWith({ rateLimit: { enabled: true, login: { max: 2 } } });
    await login(app);
    await login(app);
    expect(await AuditLog.countDocuments({ action: 'auth.login_failed' })).toBe(2);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(app)).status).toBe(429);
    }

    expect(await AuditLog.countDocuments()).toBe(2);
  });

  it('gives register its own counter', async () => {
    await createUser();
    const app = appWith({ rateLimit: { enabled: true, login: { max: 2 }, register: { max: 2 } } });

    expect((await register(app, 1)).status).toBe(201);
    expect((await register(app, 2)).status).toBe(201);
    const limited = await register(app, 3);

    expectRateLimited(limited);
    expect(limited.body.error.message).toBe('Too many accounts created. Try again in 60 minutes.');
    expect(await User.countDocuments()).toBe(3);
    // The login counter is untouched by the registrations.
    expect((await login(app)).status).toBe(401);
    expect((await login(app)).status).toBe(401);
    expect((await login(app)).status).toBe(429);
    // ...and the register counter by the failed logins: still limited, not reset.
    expect((await register(app, 4)).status).toBe(429);
  });

  it('applies a softer global limit to the rest of the API, but not to /health', async () => {
    const app = appWith({ rateLimit: { enabled: true, global: { max: 2 } } });

    expect((await request(app).get('/api/v1/hello')).status).toBe(200);
    expect((await request(app).get('/api/v1/tickets')).status).toBe(401);
    const limited = await request(app).get('/api/v1/hello');

    expectRateLimited(limited);
    expect(limited.body.error.message).toBe('Too many requests. Try again in 15 minutes.');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });

  it('keeps separate counters per app (fresh limiters per createApp)', async () => {
    const first = appWith({ rateLimit: { enabled: true, global: { max: 1 } } });
    const second = appWith({ rateLimit: { enabled: true, global: { max: 1 } } });

    await request(first).get('/api/v1/hello');

    expect((await request(first).get('/api/v1/hello')).status).toBe(429);
    expect((await request(second).get('/api/v1/hello')).status).toBe(200);
  });

  describe('client IP behind a proxy', () => {
    const fromIp = (app, ip) => request(app).get('/api/v1/hello').set('X-Forwarded-For', ip);

    it('counts each client separately with one trusted proxy hop', async () => {
      const app = appWith({
        env: { TRUST_PROXY: '1' },
        rateLimit: { enabled: true, global: { max: 1 } },
      });

      expect((await fromIp(app, '203.0.113.1')).status).toBe(200);
      expect((await fromIp(app, '203.0.113.2')).status).toBe(200);
      expect((await fromIp(app, '203.0.113.1')).status).toBe(429);
    });

    it('ignores X-Forwarded-For when no proxy is trusted', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const app = appWith({ rateLimit: { enabled: true, global: { max: 1 } } });

      expect((await fromIp(app, '203.0.113.1')).status).toBe(200);
      // A client cannot dodge the limit by sending a new X-Forwarded-For.
      expect((await fromIp(app, '203.0.113.2')).status).toBe(429);
    });
  });
});

describe('createLimiters', () => {
  it('is off by default under NODE_ENV=test and on elsewhere', () => {
    const off = createLimiters({ env: { NODE_ENV: 'test' } });
    const on = createLimiters({ env: { NODE_ENV: 'production' } });

    expect(off.loginLimiter.name).toBe('passThrough');
    expect(on.loginLimiter.name).not.toBe('passThrough');
  });

  it('has the documented defaults', () => {
    expect(DEFAULTS.login).toMatchObject({ max: 10, windowMs: 15 * 60 * 1000 });
    expect(DEFAULTS.register).toMatchObject({ max: 5, windowMs: 60 * 60 * 1000 });
    expect(DEFAULTS.global).toMatchObject({ max: 300, windowMs: 15 * 60 * 1000 });
  });

  it('reads RATE_LIMIT_* from env, and arguments win over env', async () => {
    const app = createApp({
      env: {
        NODE_ENV: 'production',
        RATE_LIMIT_GLOBAL_MAX: '1',
        RATE_LIMIT_GLOBAL_WINDOW_MS: '60000',
        RATE_LIMIT_LOGIN_MAX: 'not-a-number',
      },
    });
    await request(app).get('/api/v1/hello');

    const limited = await request(app).get('/api/v1/hello');

    expect(limited.status).toBe(429);
    expect(limited.body.error.message).toBe('Too many requests. Try again in 1 minute.');

    const overridden = createApp({
      env: { NODE_ENV: 'production', RATE_LIMIT_GLOBAL_MAX: '1' },
      rateLimit: { global: { max: 3 } },
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await request(overridden).get('/api/v1/hello')).status).toBe(200);
    }
  });
});
