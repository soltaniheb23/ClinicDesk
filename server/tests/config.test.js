const {
  getStartupErrors,
  parseBooleanFlag,
  parseClientOrigins,
  parseDebugClientIp,
  parseTrustCfConnectingIp,
  parseTrustProxy,
  RATE_LIMIT_VARIABLES,
} = require('../src/config');

// A placeholder of the minimum length, not a real secret.
const LONG_SECRET = 'x'.repeat(32);
const BASE = { MONGODB_URI: 'mongodb://db', JWT_SECRET: LONG_SECRET };

describe('getStartupErrors', () => {
  it('requires MONGODB_URI', () => {
    expect(getStartupErrors({ JWT_SECRET: 'x' })).toEqual([
      expect.stringContaining('MONGODB_URI is not set'),
    ]);
  });

  it('refuses to start in production without JWT_SECRET', () => {
    expect(getStartupErrors({ MONGODB_URI: 'mongodb://db', NODE_ENV: 'production' })).toEqual([
      expect.stringContaining('JWT_SECRET is not set'),
    ]);
  });

  it('refuses a JWT_SECRET shorter than 32 characters in production', () => {
    expect(
      getStartupErrors({ ...BASE, JWT_SECRET: 'x'.repeat(31), NODE_ENV: 'production' }),
    ).toEqual([expect.stringContaining('JWT_SECRET must be at least 32 characters')]);
  });

  it('allows a missing or short JWT_SECRET outside production', () => {
    expect(getStartupErrors({ MONGODB_URI: 'mongodb://db', NODE_ENV: 'development' })).toEqual([]);
    expect(getStartupErrors({ ...BASE, JWT_SECRET: 'short', NODE_ENV: 'development' })).toEqual([]);
  });

  it('passes with all required variables in production', () => {
    expect(
      getStartupErrors({
        ...BASE,
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://clinicdesk.vercel.app, https://staging.example.com/',
        TRUST_PROXY: '1',
        TRUST_CF_CONNECTING_IP: 'true',
        DEBUG_CLIENT_IP: 'false',
        RATE_LIMIT_LOGIN_MAX: '20',
      }),
    ).toEqual([]);
  });

  it.each(['*', 'https://clinicdesk.vercel.app,*', ' * '])(
    'refuses "*" in CLIENT_ORIGIN (%s)',
    (value) => {
      expect(getStartupErrors({ ...BASE, CLIENT_ORIGIN: value })).toEqual([
        expect.stringContaining('CLIENT_ORIGIN must not contain "*"'),
      ]);
    },
  );

  it.each(['clinicdesk.vercel.app', 'https://clinicdesk.vercel.app/app', 'ftp://files.example'])(
    'refuses a CLIENT_ORIGIN entry that is not an origin (%s)',
    (value) => {
      expect(getStartupErrors({ ...BASE, CLIENT_ORIGIN: value })).toEqual([
        expect.stringContaining('is not an origin'),
      ]);
    },
  );

  it.each(['true', 'yes', '-1', '1.5'])('refuses TRUST_PROXY=%s', (value) => {
    expect(getStartupErrors({ ...BASE, TRUST_PROXY: value })).toEqual([
      expect.stringContaining('TRUST_PROXY must be'),
    ]);
  });

  it.each(['yes', '1', 'TRUE', 'ture', 'on'])('refuses TRUST_CF_CONNECTING_IP=%s', (value) => {
    expect(getStartupErrors({ ...BASE, TRUST_CF_CONNECTING_IP: value })).toEqual([
      `TRUST_CF_CONNECTING_IP must be "true" or "false" (got "${value}"). Set "true" only when every request reaches the API through Cloudflare.`,
    ]);
  });

  it.each(['yes', '1', 'False'])('refuses DEBUG_CLIENT_IP=%s', (value) => {
    expect(getStartupErrors({ ...BASE, DEBUG_CLIENT_IP: value })).toEqual([
      `DEBUG_CLIENT_IP must be "true" or "false" (got "${value}").`,
    ]);
  });

  it.each(RATE_LIMIT_VARIABLES)('refuses a %s that is not a positive whole number', (name) => {
    for (const value of ['0', '-5', 'ten', '1.5']) {
      expect(getStartupErrors({ ...BASE, [name]: value })).toEqual([
        `${name} must be a whole number greater than 0.`,
      ]);
    }
  });
});

describe('parseClientOrigins', () => {
  it('splits, trims, removes trailing slashes, drops empty entries and duplicates', () => {
    expect(
      parseClientOrigins(' https://a.example/ ,, https://b.example:8443//,https://a.example'),
    ).toEqual(['https://a.example', 'https://b.example:8443']);
  });

  it('never returns "*" and handles a missing value', () => {
    expect(parseClientOrigins('*, https://a.example')).toEqual(['https://a.example']);
    expect(parseClientOrigins(undefined)).toEqual([]);
  });
});

describe('parseTrustProxy', () => {
  it('defaults to 1 in production and false elsewhere', () => {
    expect(parseTrustProxy({ NODE_ENV: 'production' })).toBe(1);
    expect(parseTrustProxy({ NODE_ENV: 'development' })).toBe(false);
    expect(parseTrustProxy({ NODE_ENV: 'production', TRUST_PROXY: ' ' })).toBe(1);
  });

  it('reads false, 0 and hop counts', () => {
    expect(parseTrustProxy({ NODE_ENV: 'production', TRUST_PROXY: 'false' })).toBe(false);
    expect(parseTrustProxy({ TRUST_PROXY: '0' })).toBe(false);
    expect(parseTrustProxy({ TRUST_PROXY: '2' })).toBe(2);
    expect(parseTrustProxy({ TRUST_PROXY: 'true' })).toBeNull();
  });
});

describe('parseBooleanFlag', () => {
  it('reads "true" and "false", and treats unset or empty as false', () => {
    expect(parseBooleanFlag('true')).toBe(true);
    expect(parseBooleanFlag(' true ')).toBe(true);
    expect(parseBooleanFlag('false')).toBe(false);
    expect(parseBooleanFlag('')).toBe(false);
    expect(parseBooleanFlag(undefined)).toBe(false);
  });

  it('returns null for anything else', () => {
    for (const value of ['yes', '1', '0', 'TRUE', 'on']) {
      expect(parseBooleanFlag(value)).toBeNull();
    }
  });
});

describe('parseTrustCfConnectingIp and parseDebugClientIp', () => {
  it('default to false, also in production', () => {
    expect(parseTrustCfConnectingIp({ NODE_ENV: 'production' })).toBe(false);
    expect(parseDebugClientIp({ NODE_ENV: 'production' })).toBe(false);
  });

  it('read their own variable', () => {
    expect(parseTrustCfConnectingIp({ TRUST_CF_CONNECTING_IP: 'true' })).toBe(true);
    expect(parseTrustCfConnectingIp({ DEBUG_CLIENT_IP: 'true' })).toBe(false);
    expect(parseDebugClientIp({ DEBUG_CLIENT_IP: 'true' })).toBe(true);
    expect(parseDebugClientIp({ TRUST_CF_CONNECTING_IP: 'true' })).toBe(false);
  });
});
