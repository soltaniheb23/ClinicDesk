const os = require('node:os');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');
const User = require('../src/models/User');

const INVALID_CREDENTIALS = 'Invalid email or password';
const validUser = {
  name: 'Mara Jensen',
  email: 'mara@example.com',
  password: 'a-long-password',
};

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // The MongoDB driver loads `os` with a dynamic import(), which Jest's sandbox blocks
  // without --experimental-vm-modules, so pass it in directly.
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

function register(body = validUser) {
  return request(app).post('/api/v1/auth/register').send(body);
}

function login(body) {
  return request(app).post('/api/v1/auth/login').send(body);
}

describe('POST /api/v1/auth/register', () => {
  it('creates a customer and returns the user and a token', async () => {
    const response = await register();

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      name: 'Mara Jensen',
      email: 'mara@example.com',
      role: 'customer',
      isActive: true,
    });
    expect(response.body.user.id).toEqual(expect.any(String));
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('password');
    expect(JSON.stringify(response.body)).not.toContain(validUser.password);

    const payload = jwt.verify(response.body.token, 'test-secret');
    expect(payload).toMatchObject({ sub: response.body.user.id, role: 'customer' });
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('stores a bcrypt hash, not the password', async () => {
    await register();

    const stored = await User.findOne({ email: validUser.email }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(validUser.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('ignores a role sent by the client', async () => {
    const response = await register({ ...validUser, role: 'admin' });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('customer');
    const stored = await User.findOne({ email: validUser.email });
    expect(stored.role).toBe('customer');
  });

  it('normalizes the email to lowercase', async () => {
    const response = await register({ ...validUser, email: '  Mara@Example.COM ' });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('mara@example.com');
  });

  it('returns 409 when the email is already registered', async () => {
    await register();
    const response = await register({ ...validUser, email: 'MARA@example.com' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['missing name', { email: 'a@example.com', password: 'a-long-password' }, 'name'],
    ['blank name', { ...validUser, name: '   ' }, 'name'],
    ['invalid email', { ...validUser, email: 'not-an-email' }, 'email'],
    ['missing email', { name: 'Mara', password: 'a-long-password' }, 'email'],
    ['short password', { ...validUser, password: 'short' }, 'password'],
    ['missing password', { name: 'Mara', email: 'a@example.com' }, 'password'],
    ['non-string password', { ...validUser, password: 12345678 }, 'password'],
  ])('returns 400 for %s', async (_label, body, field) => {
    const response = await register(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('returns a token and the user for valid credentials', async () => {
    const response = await login({ email: validUser.email, password: validUser.password });

    expect(response.status).toBe(200);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    const payload = jwt.verify(response.body.token, 'test-secret');
    expect(payload).toMatchObject({ sub: response.body.user.id, role: 'customer' });
  });

  it('returns the same 401 message for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ email: validUser.email, password: 'wrong-password' });
    const unknownEmail = await login({ email: 'nobody@example.com', password: 'wrong-password' });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: INVALID_CREDENTIALS },
      });
      expect(response.body).not.toHaveProperty('token');
    }
  });

  it('does not let a deactivated user log in', async () => {
    await User.updateOne({ email: validUser.email }, { isActive: false });

    const response = await login({ email: validUser.email, password: validUser.password });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe(INVALID_CREDENTIALS);
    expect(response.body).not.toHaveProperty('token');
  });

  it('returns 400 when fields are missing', async () => {
    const response = await login({ email: validUser.email });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user without the password hash', async () => {
    const { body } = await register();

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: body.user.id,
      name: validUser.name,
      email: validUser.email,
      role: 'customer',
      isActive: true,
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });

  it('returns 401 once the user is deactivated', async () => {
    const { body } = await register();
    await User.updateOne({ email: validUser.email }, { isActive: false });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(401);
  });
});

describe('registration rules', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function detailsFor(response) {
    return response.body.error.details;
  }

  it.each([
    ['exactly 8 characters', 'abcdefgh'],
    ['exactly 72 bytes', 'a'.repeat(72)],
    ['24 three-byte characters (72 bytes)', '€'.repeat(24)],
  ])('accepts a password of %s', async (_label, password) => {
    const response = await register({ ...validUser, password });

    expect(response.status).toBe(201);
  });

  it.each([
    ['7 characters', 'abcdefg', 'Password must be at least 8 characters'],
    ['73 bytes', 'a'.repeat(73), 'Password must be at most 72 bytes'],
    // Only 25 characters, but 75 bytes: bcrypt would silently ignore the end.
    ['25 three-byte characters (75 bytes)', '€'.repeat(25), 'Password must be at most 72 bytes'],
  ])('rejects a password of %s', async (_label, password, message) => {
    const response = await register({ ...validUser, password });

    expect(response.status).toBe(400);
    expect(detailsFor(response)).toEqual([{ field: 'password', message }]);
    expect(await User.countDocuments()).toBe(0);
  });

  it('does not trim the password', async () => {
    await register({ ...validUser, password: '  padded-password  ' });

    const exact = await login({ email: validUser.email, password: '  padded-password  ' });
    const trimmed = await login({ email: validUser.email, password: 'padded-password' });

    expect(exact.status).toBe(200);
    expect(trimmed.status).toBe(401);
  });

  it('trims the name and accepts 80 characters', async () => {
    const response = await register({ ...validUser, name: `  ${'n'.repeat(80)}  ` });

    expect(response.status).toBe(201);
    expect(response.body.user.name).toBe('n'.repeat(80));
  });

  it('rejects a name longer than 80 characters', async () => {
    const response = await register({ ...validUser, name: 'n'.repeat(81) });

    expect(response.status).toBe(400);
    expect(detailsFor(response)).toEqual([
      { field: 'name', message: 'Name must be at most 80 characters' },
    ]);
  });

  it('rejects an email longer than 254 characters', async () => {
    const response = await register({
      ...validUser,
      email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}.com`,
    });

    expect(response.status).toBe(400);
    expect(detailsFor(response)).toEqual([{ field: 'email', message: 'Email is too long' }]);
  });

  it('treats the same email with different case or spaces as already registered', async () => {
    await register();

    const response = await register({ ...validUser, email: '  MARA@Example.COM ' });

    expect(response.status).toBe(409);
    expect(await User.countDocuments()).toBe(1);
  });

  it('returns 400 for a request without a body', async () => {
    const response = await request(app).post('/api/v1/auth/register');

    expect(response.status).toBe(400);
    expect(
      detailsFor(response)
        .map((detail) => detail.field)
        .sort(),
    ).toEqual(['email', 'name', 'password']);
  });

  it('returns a token for the new customer that expires after JWT_EXPIRES_IN', async () => {
    const response = await register();

    const payload = jwt.verify(response.body.token, 'test-secret');
    expect(payload.sub).toBe(response.body.user.id);
    expect(payload.role).toBe('customer');
    expect(payload.exp - payload.iat).toBe(60 * 60);
    expect(payload).not.toHaveProperty('email');
  });

  it('answers a generic 500 for an unexpected database error, without details', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(User, 'create').mockRejectedValueOnce(new Error('connection reset by peer'));

    const response = await register();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(JSON.stringify(response.body)).not.toContain('connection reset');
  });
});

describe('login rules', () => {
  beforeEach(async () => {
    await register();
  });

  it('normalises the email (case and spaces) before looking the user up', async () => {
    const response = await login({ email: '  MARA@EXAMPLE.com ', password: validUser.password });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(validUser.email);
  });

  it('is case-sensitive for the password', async () => {
    const response = await login({ email: validUser.email, password: 'A-LONG-PASSWORD' });

    expect(response.status).toBe(401);
  });

  it('rejects a password over 72 bytes before checking it', async () => {
    const response = await login({ email: validUser.email, password: 'a'.repeat(73) });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      { field: 'password', message: 'Password must be at most 72 bytes' },
    ]);
  });

  it('returns 400 for a request without a body', async () => {
    const response = await request(app).post('/api/v1/auth/login');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('gives a deactivated user the same answer as a wrong password', async () => {
    await User.updateOne({ email: validUser.email }, { isActive: false });

    const deactivated = await login({ email: validUser.email, password: validUser.password });
    const wrongPassword = await login({ email: 'nobody@example.com', password: 'whatever-pass' });

    expect(deactivated.status).toBe(401);
    expect(deactivated.body).toEqual(wrongPassword.body);
  });

  it('puts the role from the database into the token', async () => {
    await User.updateOne({ email: validUser.email }, { role: 'agent' });

    const response = await login({ email: validUser.email, password: validUser.password });

    expect(jwt.verify(response.body.token, 'test-secret').role).toBe('agent');
    expect(response.body.user.role).toBe('agent');
  });
});

describe('GET /api/v1/auth/me token checks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function me(token) {
    return request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  }

  it('accepts the token returned by login', async () => {
    await register();
    const { body } = await login({ email: validUser.email, password: validUser.password });

    const response = await me(body.token);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(validUser.email);
  });

  it('rejects an expired token', async () => {
    const { body } = await register();
    const expired = jwt.sign(
      { sub: body.user.id, role: 'customer', exp: Math.floor(Date.now() / 1000) - 1 },
      'test-secret',
    );

    const response = await me(expired);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects a token whose payload was changed after signing', async () => {
    const { body } = await register();
    const [header, , signature] = body.token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: body.user.id, role: 'admin', exp: 4102444800 }),
    ).toString('base64url');

    const response = await me(`${header}.${forgedPayload}.${signature}`);

    expect(response.status).toBe(401);
  });

  it('rejects a token with a cut-off signature', async () => {
    const { body } = await register();

    const response = await me(body.token.slice(0, -4));

    expect(response.status).toBe(401);
  });

  it('rejects a token signed with another algorithm (HS512)', async () => {
    const { body } = await register();
    const other = jwt.sign({ sub: body.user.id, role: 'customer' }, 'test-secret', {
      algorithm: 'HS512',
    });

    const response = await me(other);

    expect(response.status).toBe(401);
  });

  it('returns 401 when the user is deleted after the token was checked', async () => {
    const { body } = await register();
    const findById = User.findById.bind(User);
    let calls = 0;
    // authenticate() loads the user first; the route's own lookup then finds nothing.
    jest.spyOn(User, 'findById').mockImplementation((...args) => {
      calls += 1;
      return calls === 1 ? findById(...args) : findById(new mongoose.Types.ObjectId());
    });

    const response = await me(body.token);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});
