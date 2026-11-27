// Error monitoring (CD-25, docs/monitoring.md): Sentry stays off without a DSN, only 5xx
// errors are reported, the scrubber removes personal and secret data, and the admin-only
// test route. @sentry/node is mocked, so no test can send anything over the network.
const os = require('node:os');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('@sentry/node', () => {
  const mockScope = { setUser: jest.fn(), setTag: jest.fn() };
  return {
    mockScope,
    init: jest.fn(),
    onUnhandledRejectionIntegration: jest.fn((options) => ({
      name: 'OnUnhandledRejection',
      options,
    })),
    captureException: jest.fn(),
    withScope: jest.fn((callback) => callback(mockScope)),
  };
});

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const Sentry = require('@sentry/node');
const { createApp } = require('../src/app');
const User = require('../src/models/User');
const { signToken } = require('../src/auth/token');
const { scrubBreadcrumb, scrubEvent } = require('../src/monitoring/scrub');
const {
  captureError,
  initSentry,
  isSentryEnabled,
  resetSentry,
  sentryOptions,
} = require('../src/monitoring/sentry');
const { TEST_ERROR_MESSAGE } = require('../src/routes/debug');

// A made-up DSN in the documented format; it is never contacted (the SDK is mocked).
const DSN = 'https://publickey@o0.ingest.sentry.io/0';
const INTERNAL_ERROR = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };

function appWith(rateLimit = { enabled: false }) {
  return createApp({ env: { NODE_ENV: 'test' }, rateLimit });
}

function enableMockedSentry(env = {}) {
  return initSentry({ NODE_ENV: 'test', SENTRY_DSN: DSN, ...env }, { sentry: Sentry });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSentry();
});

describe('initSentry', () => {
  it('does nothing without SENTRY_DSN', () => {
    expect(initSentry({ NODE_ENV: 'production' }, { sentry: Sentry })).toBe(false);
    expect(initSentry({ NODE_ENV: 'production', SENTRY_DSN: '  ' }, { sentry: Sentry })).toBe(
      false,
    );
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('does nothing for an invalid SENTRY_DSN (startup validation stops the server)', () => {
    expect(initSentry({ SENTRY_DSN: 'http://key@o0.ingest.sentry.io/0' }, { sentry: Sentry })).toBe(
      false,
    );
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('never starts in a test run without an injected SDK, even with a DSN', () => {
    expect(initSentry({ NODE_ENV: 'test', SENTRY_DSN: DSN })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('reports nothing while it is off', () => {
    expect(captureError(new Error('boom'))).toBe(false);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('initialises with the DSN, no default PII and the scrubbers', () => {
    expect(enableMockedSentry({ RENDER_GIT_COMMIT: 'abc123' })).toBe(true);

    expect(isSentryEnabled()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = Sentry.init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'test',
      release: 'abc123',
      serverName: 'clinicdesk-api',
      sampleRate: 1,
      sendDefaultPii: false,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    expect(options.tracesSampleRate).toBeUndefined();
    // Unhandled rejections still end the process after being reported, as without Sentry.
    expect(options.integrations).toEqual([
      { name: 'OnUnhandledRejection', options: { mode: 'strict' } },
    ]);
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });

  it('uses SENTRY_ENVIRONMENT when set and omits the release without a commit', () => {
    const options = sentryOptions(
      { NODE_ENV: 'production', SENTRY_ENVIRONMENT: 'staging' },
      DSN,
      Sentry,
    );
    expect(options.environment).toBe('staging');
    expect(options).not.toHaveProperty('release');
    expect(sentryOptions({}, DSN, Sentry).environment).toBe('development');
  });
});

describe('scrubEvent', () => {
  const event = {
    message: 'Login failed for mara@example.com with Bearer abc.def',
    exception: {
      values: [
        {
          type: 'MongoServerError',
          value: 'E11000 duplicate key error dup key: { email: "mara@example.com" }',
        },
      ],
    },
    request: {
      method: 'POST',
      url: 'https://api.example.com/api/v1/tickets?q=printer&email=mara@example.com#top',
      query_string: 'q=printer',
      data: { title: 'Printer', password: 'a-long-password' },
      cookies: { session: 'secret-cookie' },
      headers: {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
        Cookie: 'session=secret-cookie',
        'User-Agent': 'jest',
        Referer: 'https://app.example.com/tickets?q=private',
      },
    },
    user: { id: '6650c3a1b2c3d4e5f6a7b8c9', email: 'mara@example.com', ip_address: '1.2.3.4' },
    extra: {
      ticket: { id: 't1', title: 'Printer', description: 'Room 3', status: 'open' },
      comment: { body: 'Call me on 0123' },
      token: 'jwt',
      smtpPass: 'x',
      nested: [{ resetToken: 'x', note: 'token eyJa.eyJb.sig' }],
    },
    breadcrumbs: [
      { category: 'http', data: { url: '/api/v1/users?q=mara', method: 'GET', body: 'x' } },
    ],
    tags: { sentry_test: 'true' },
  };

  const scrubbed = scrubEvent(event);
  const serialized = JSON.stringify(scrubbed);

  it('removes the request body, cookies, query strings and the Authorization header', () => {
    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://api.example.com/api/v1/tickets',
      headers: { 'User-Agent': 'jest', Referer: 'https://app.example.com/tickets' },
    });
  });

  it('keeps only an opaque user id', () => {
    expect(scrubbed.user).toEqual({ id: '6650c3a1b2c3d4e5f6a7b8c9' });
    expect(scrubEvent({ user: { email: 'mara@example.com' } })).not.toHaveProperty('user');
  });

  it('removes password, token, email and ticket text fields anywhere', () => {
    expect(scrubbed.extra).toEqual({
      ticket: { id: 't1', status: 'open' },
      nested: [{ note: 'token [Filtered]' }],
    });
    expect(scrubbed.breadcrumbs).toEqual([
      { category: 'http', data: { url: '/api/v1/users', method: 'GET' } },
    ]);
  });

  it('replaces emails, bearer tokens and JWTs inside free text', () => {
    expect(scrubbed.message).toBe('Login failed for [email] with Bearer [Filtered]');
    expect(scrubbed.exception.values[0].value).toBe(
      'E11000 duplicate key error dup key: { email: "[email]" }',
    );
    for (const secret of [
      'mara@example.com',
      'a-long-password',
      'secret-cookie',
      'eyJ',
      'Room 3',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('keeps what is needed to debug: the error type and tags', () => {
    expect(scrubbed.exception.values[0].type).toBe('MongoServerError');
    expect(scrubbed.tags).toEqual({ sentry_test: 'true' });
  });

  it('does not change the original event and passes non-objects through', () => {
    expect(event.request.data.password).toBe('a-long-password');
    expect(scrubEvent(null)).toBeNull();
    expect(scrubBreadcrumb(undefined)).toBeUndefined();
  });
});

describe('scrubBreadcrumb', () => {
  it('cuts query strings off URLs and drops sensitive fields', () => {
    expect(
      scrubBreadcrumb({
        category: 'console',
        message: 'sent to mara@example.com',
        data: { url: 'https://api.example.com/x?token=abc', status_code: 500, password: 'x' },
      }),
    ).toEqual({
      category: 'console',
      message: 'sent to [email]',
      data: { url: 'https://api.example.com/x', status_code: 500 },
    });
  });
});

describe('what the API reports', () => {
  let app;
  beforeEach(() => {
    enableMockedSentry();
    jest.clearAllMocks();
    app = appWith();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
    process.env.JWT_SECRET = 'test-secret';
  });

  it('reports a 500 and keeps the uniform error answer', async () => {
    // A server misconfiguration: authenticate() throws, the error handler answers 500.
    delete process.env.JWT_SECRET;

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer some-token');

    expect(response.status).toBe(500);
    expect(response.body).toEqual(INTERNAL_ERROR);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException.mock.calls[0][0]).toEqual(new Error('JWT_SECRET is not set'));
    expect(Sentry.mockScope.setUser).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invalid JSON (400)',
      (agent) =>
        agent.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":'),
      400,
    ],
    [
      'a too large body (413)',
      (agent) => agent.post('/api/v1/auth/login').send({ email: 'x'.repeat(40000) }),
      413,
    ],
    ['a missing token (401)', (agent) => agent.get('/api/v1/auth/me'), 401],
    ['an unknown path (404)', (agent) => agent.get('/api/v1/nope'), 404],
    ['a validation error (400)', (agent) => agent.post('/api/v1/auth/login').send({}), 400],
  ])('never reports %s', async (_name, send, status) => {
    const response = await send(request(app));

    expect(response.status).toBe(status);
    expect(response.body.error.code).toEqual(expect.any(String));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports nothing when monitoring is off, with the same 500 answer', async () => {
    resetSentry();
    delete process.env.JWT_SECRET;

    const response = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer x');

    expect(response.status).toBe(500);
    expect(response.body).toEqual(INTERNAL_ERROR);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/debug/sentry-test', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    // See auth.test.js: Jest's sandbox blocks the driver's dynamic import of `os`.
    await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
    await User.init();
  }, 120000);

  afterEach(async () => {
    await User.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  async function tokenFor(role) {
    const user = await User.create({
      name: `${role} user`,
      email: `${role}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
    });
    return { id: user.id, token: signToken(user) };
  }

  it('answers 401 without a token and reports nothing', async () => {
    enableMockedSentry();

    const response = await request(appWith()).post('/api/v1/debug/sentry-test');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it.each(['agent', 'customer'])('answers 403 for an %s and reports nothing', async (role) => {
    enableMockedSentry();
    const { token } = await tokenFor(role);

    const response = await request(appWith())
      .post('/api/v1/debug/sentry-test')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures a handled test error for an admin and answers { ok: true }', async () => {
    enableMockedSentry();
    const admin = await tokenFor('admin');

    const response = await request(appWith())
      .post('/api/v1/debug/sentry-test')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException.mock.calls[0][0].message).toBe(TEST_ERROR_MESSAGE);
    expect(Sentry.mockScope.setUser).toHaveBeenCalledWith({ id: admin.id });
    expect(Sentry.mockScope.setTag).toHaveBeenCalledWith('sentry_test', 'true');
  });

  it('still answers { ok: true } when monitoring is off', async () => {
    const admin = await tokenFor('admin');

    const response = await request(appWith())
      .post('/api/v1/debug/sentry-test')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('is rate limited by the global /api/v1 limiter', async () => {
    const admin = await tokenFor('admin');
    const app = appWith({ enabled: true, global: { max: 1 } });
    const send = () =>
      request(app).post('/api/v1/debug/sentry-test').set('Authorization', `Bearer ${admin.token}`);

    expect((await send()).status).toBe(200);
    const limited = await send();

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
