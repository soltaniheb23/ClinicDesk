const jwt = require('jsonwebtoken');
const { signToken } = require('../src/auth/token');

const user = { id: '6650a1f2c3d4e5f6a7b8c9d0', role: 'agent', email: 'agent@example.com' };
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('signToken', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  it('signs only the user id and role (no email), with HS256', () => {
    const token = signToken(user);

    const { header, payload } = jwt.decode(token, { complete: true });
    expect(header.alg).toBe('HS256');
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
    expect(payload).toMatchObject({ sub: user.id, role: 'agent' });
    expect(() => jwt.verify(token, 'unit-test-secret')).not.toThrow();
  });

  it('expires after 1 hour when JWT_EXPIRES_IN is not set', () => {
    delete process.env.JWT_EXPIRES_IN;

    const { exp, iat } = jwt.decode(signToken(user));

    expect(exp - iat).toBe(60 * 60);
  });

  it('uses JWT_EXPIRES_IN when it is set', () => {
    process.env.JWT_EXPIRES_IN = '15m';

    const { exp, iat } = jwt.decode(signToken(user));

    expect(exp - iat).toBe(15 * 60);
  });

  it('refuses to sign without JWT_SECRET instead of signing with an empty key', () => {
    delete process.env.JWT_SECRET;

    expect(() => signToken(user)).toThrow('JWT_SECRET is not set');
  });
});
