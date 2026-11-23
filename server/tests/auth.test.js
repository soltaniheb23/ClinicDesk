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
