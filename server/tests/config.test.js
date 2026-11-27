const {
  getStartupErrors,
  MAIL_REQUIRED_VARIABLES,
  parseBooleanFlag,
  parseClientOrigins,
  parseDebugClientIp,
  parseMailConfig,
  parseSentryDsn,
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

describe('mail settings (EMAIL_ENABLED)', () => {
  // Placeholders only, never real credentials.
  const MAIL = {
    EMAIL_ENABLED: 'true',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'placeholder-user',
    SMTP_PASS: 'placeholder-pass',
    MAIL_FROM: 'ClinicDesk <no-reply@example.com>',
    APP_URL: 'https://clinicdesk.vercel.app/',
  };

  it('needs nothing when EMAIL_ENABLED is unset or "false"', () => {
    expect(getStartupErrors(BASE)).toEqual([]);
    expect(getStartupErrors({ ...BASE, EMAIL_ENABLED: 'false', SMTP_PORT: 'bad' })).toEqual([]);
  });

  it('passes with every variable set', () => {
    expect(getStartupErrors({ ...BASE, ...MAIL, NODE_ENV: 'production' })).toEqual([]);
    expect(getStartupErrors({ ...BASE, ...MAIL, MAIL_FROM: 'no-reply@example.com' })).toEqual([]);
  });

  it.each(['yes', '1', 'TRUE'])('refuses EMAIL_ENABLED=%s', (value) => {
    expect(getStartupErrors({ ...BASE, EMAIL_ENABLED: value })).toEqual([
      `EMAIL_ENABLED must be "true" or "false" (got "${value}").`,
    ]);
  });

  it.each(MAIL_REQUIRED_VARIABLES)('refuses EMAIL_ENABLED=true without %s', (name) => {
    for (const value of [undefined, '', '   ']) {
      expect(getStartupErrors({ ...BASE, ...MAIL, [name]: value })).toEqual([
        `EMAIL_ENABLED is "true", but ${name} is not set (see server/.env.example).`,
      ]);
    }
  });

  it('lists every missing variable in one message', () => {
    expect(getStartupErrors({ ...BASE, EMAIL_ENABLED: 'true' })).toEqual([
      'EMAIL_ENABLED is "true", but SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL are not set (see server/.env.example).',
    ]);
  });

  it.each([
    'clinicdesk.vercel.app',
    'ftp://files.example',
    'javascript:alert(1)',
    'https://user:pw@app.example',
    'https://app.example/?a=1',
    'https://app.example/#x',
  ])('refuses APP_URL=%s', (value) => {
    expect(getStartupErrors({ ...BASE, ...MAIL, APP_URL: value })).toEqual([
      expect.stringContaining('APP_URL must be the http(s) URL of the client'),
    ]);
  });

  it.each(['0', '65536', '587.5', 'smtp'])('refuses SMTP_PORT=%s', (value) => {
    expect(getStartupErrors({ ...BASE, ...MAIL, SMTP_PORT: value })).toEqual([
      'SMTP_PORT must be a whole number from 1 to 65535 (for example 587).',
    ]);
  });

  it.each(['no-reply.example.com', 'a@example.com\r\nBcc: victim@example.com'])(
    'refuses MAIL_FROM=%j',
    (value) => {
      expect(getStartupErrors({ ...BASE, ...MAIL, MAIL_FROM: value })).toEqual([
        expect.stringContaining('MAIL_FROM must be one email address'),
      ]);
    },
  );

  it('parses the values, trimmed, APP_URL without its trailing slash', () => {
    expect(parseMailConfig({ ...MAIL, SMTP_HOST: ' smtp.example.com ' })).toEqual({
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      user: 'placeholder-user',
      pass: 'placeholder-pass',
      from: 'ClinicDesk <no-reply@example.com>',
      appUrl: 'https://clinicdesk.vercel.app',
    });
    expect(parseMailConfig({})).toMatchObject({
      enabled: false,
      port: undefined,
      appUrl: undefined,
    });
  });
});

describe('error monitoring (SENTRY_DSN)', () => {
  // Made-up DSNs in Sentry's format, never real ones.
  const DSN = 'https://publickey@o0.ingest.sentry.io/0';

  it('is optional: unset or empty turns monitoring off', () => {
    expect(getStartupErrors(BASE)).toEqual([]);
    expect(getStartupErrors({ ...BASE, SENTRY_DSN: '' })).toEqual([]);
    expect(parseSentryDsn({})).toBeUndefined();
    expect(parseSentryDsn({ SENTRY_DSN: '   ' })).toBeUndefined();
  });

  it('accepts an https DSN, trimmed', () => {
    expect(getStartupErrors({ ...BASE, NODE_ENV: 'production', SENTRY_DSN: DSN })).toEqual([]);
    expect(parseSentryDsn({ SENTRY_DSN: ` ${DSN} ` })).toBe(DSN);
    expect(parseSentryDsn({ SENTRY_DSN: 'https://key@o0.ingest.de.sentry.io/1' })).toBe(
      'https://key@o0.ingest.de.sentry.io/1',
    );
  });

  it.each([
    'http://publickey@o0.ingest.sentry.io/0',
    'publickey@o0.ingest.sentry.io/0',
    'not a url',
    'ftp://o0.ingest.sentry.io/0',
  ])('stops startup with a clear message for SENTRY_DSN=%j, without printing it', (value) => {
    const errors = getStartupErrors({ ...BASE, SENTRY_DSN: value });

    expect(errors).toEqual([expect.stringContaining('SENTRY_DSN must be an https URL')]);
    expect(errors[0]).not.toContain(value);
    expect(parseSentryDsn({ SENTRY_DSN: value })).toBeNull();
  });
});
