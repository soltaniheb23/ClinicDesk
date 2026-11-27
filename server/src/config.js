// Environment checks and parsing shared by server.js (startup) and app.js (runtime).

// HS256 keys should be at least 256 bits; 32 characters is the floor we accept in production.
const JWT_SECRET_MIN_LENGTH = 32;

// The RATE_LIMIT_* variables read by src/security/rateLimit.js.
const RATE_LIMIT_VARIABLES = [
  'RATE_LIMIT_LOGIN_MAX',
  'RATE_LIMIT_LOGIN_WINDOW_MS',
  'RATE_LIMIT_REGISTER_MAX',
  'RATE_LIMIT_REGISTER_WINDOW_MS',
  'RATE_LIMIT_GLOBAL_MAX',
  'RATE_LIMIT_GLOBAL_WINDOW_MS',
];

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// CLIENT_ORIGIN as a list: comma-separated, trimmed, trailing slashes removed, empty
// entries dropped. "*" is never returned (getStartupErrors refuses it), so the API can
// only ever echo back one exact, configured origin.
function parseClientOrigins(value) {
  return [...new Set(splitList(value).filter((origin) => origin !== '*'))];
}

// True for "https://host[:port]" style values with nothing after the origin.
function isOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

// Express "trust proxy" from TRUST_PROXY. Unset: 1 in production (Render puts exactly one
// proxy in front of the app) and false elsewhere. "false" or "0": trust no proxy. A whole
// number: trust that many hops. Anything else is null (a startup error): "true" would make
// every X-Forwarded-For value trusted, so any client could pick the IP the rate limiter sees.
function parseTrustProxy(env) {
  const value = env.TRUST_PROXY?.trim();
  if (value === undefined || value === '') return env.NODE_ENV === 'production' ? 1 : false;
  if (value === 'false' || value === '0') return false;
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  return null;
}

// An on/off setting such as TRUST_CF_CONNECTING_IP or DEBUG_CLIENT_IP. Unset or empty: false.
// "true" or "false" (surrounding spaces ignored). Anything else is null (a startup error), so
// a typo such as "ture" or "yes" never silently leaves a security setting off or on.
function parseBooleanFlag(value) {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '' || trimmed === 'false') return false;
  if (trimmed === 'true') return true;
  return null;
}

// TRUST_CF_CONNECTING_IP: whether the rate limiters key on Cloudflare's CF-Connecting-IP
// header instead of req.ip (src/security/rateLimit.js). Only safe when every request reaches
// the API through Cloudflare, which overwrites the header; otherwise a client could set it.
function parseTrustCfConnectingIp(env) {
  return parseBooleanFlag(env.TRUST_CF_CONNECTING_IP);
}

// DEBUG_CLIENT_IP: temporary. Logs the client-IP inputs of each failed login (routes/auth.js)
// while the Render and Cloudflare setup is being confirmed. Remove once it is.
function parseDebugClientIp(env) {
  return parseBooleanFlag(env.DEBUG_CLIENT_IP);
}

// The variables EMAIL_ENABLED=true needs (src/notifications/mailer.js, docs/notifications.md).
const MAIL_REQUIRED_VARIABLES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_FROM',
  'APP_URL',
];

// True for an absolute http(s) URL without credentials, query or fragment.
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

// Control characters (CR and LF included) never belong in a mail header value.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

// Mail settings from env (docs/notifications.md). `enabled` is null for an invalid
// EMAIL_ENABLED (a startup error). Values are trimmed; APP_URL loses its trailing slashes so
// links can be built as APP_URL + path.
function parseMailConfig(env) {
  const value = (name) => env[name]?.trim() || undefined;
  return {
    enabled: parseBooleanFlag(env.EMAIL_ENABLED),
    host: value('SMTP_HOST'),
    port: value('SMTP_PORT') === undefined ? undefined : Number(value('SMTP_PORT')),
    user: value('SMTP_USER'),
    pass: env.SMTP_PASS || undefined,
    from: value('MAIL_FROM'),
    appUrl: value('APP_URL')?.replace(/\/+$/, ''),
  };
}

function getMailErrors(env) {
  const config = parseMailConfig(env);
  if (config.enabled === null) {
    return [`EMAIL_ENABLED must be "true" or "false" (got "${env.EMAIL_ENABLED}").`];
  }
  if (!config.enabled) return [];

  const errors = [];
  const missing = MAIL_REQUIRED_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    errors.push(
      `EMAIL_ENABLED is "true", but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set (see server/.env.example).`,
    );
  }
  if (
    config.port !== undefined &&
    !(Number.isInteger(config.port) && config.port > 0 && config.port <= 65535)
  ) {
    errors.push('SMTP_PORT must be a whole number from 1 to 65535 (for example 587).');
  }
  if (config.from && (CONTROL_CHARACTERS.test(config.from) || !config.from.includes('@'))) {
    errors.push(
      'MAIL_FROM must be one email address, optionally with a name (ClinicDesk <no-reply@example.com>), on one line.',
    );
  }
  if (config.appUrl !== undefined && !isAppUrl(config.appUrl)) {
    errors.push(
      'APP_URL must be the http(s) URL of the client, for example https://clinicdesk.vercel.app.',
    );
  }
  return errors;
}

// SENTRY_DSN (CD-25, docs/monitoring.md). Unset or empty: undefined (error monitoring is
// off). An https URL: the trimmed value. Anything else is null (a startup error), so a typo
// never leaves monitoring silently off or sends events over plain http.
function parseSentryDsn(env) {
  const value = env.SENTRY_DSN?.trim();
  if (value === undefined || value === '') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? value : null;
  } catch {
    return null;
  }
}

function isPositiveInteger(value) {
  return /^[1-9]\d*$/.test(String(value).trim());
}

// Returns a list of problems that must stop the server from starting.
function getStartupErrors(env) {
  const errors = [];

  if (!env.MONGODB_URI) {
    errors.push(
      'MONGODB_URI is not set. Add your MongoDB connection string to server/.env (see .env.example).',
    );
  }

  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET) {
      errors.push('JWT_SECRET is not set. The server refuses to start in production without it.');
    } else if (env.JWT_SECRET.length < JWT_SECRET_MIN_LENGTH) {
      errors.push(
        `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters in production. Generate one with \`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\`.`,
      );
    }
  }

  const origins = splitList(env.CLIENT_ORIGIN);
  if (origins.includes('*')) {
    errors.push(
      'CLIENT_ORIGIN must not contain "*". List the allowed frontend origins, comma-separated.',
    );
  }
  for (const origin of origins.filter((entry) => entry !== '*' && !isOrigin(entry))) {
    errors.push(
      `CLIENT_ORIGIN entry "${origin}" is not an origin. Use the form https://host[:port], without a path.`,
    );
  }

  if (parseTrustProxy(env) === null) {
    errors.push('TRUST_PROXY must be "false" or a whole number of proxy hops (for example 1).');
  }

  if (parseTrustCfConnectingIp(env) === null) {
    errors.push(
      `TRUST_CF_CONNECTING_IP must be "true" or "false" (got "${env.TRUST_CF_CONNECTING_IP}"). Set "true" only when every request reaches the API through Cloudflare.`,
    );
  }

  if (parseDebugClientIp(env) === null) {
    errors.push(`DEBUG_CLIENT_IP must be "true" or "false" (got "${env.DEBUG_CLIENT_IP}").`);
  }

  errors.push(...getMailErrors(env));

  if (parseSentryDsn(env) === null) {
    // The value is not printed: a DSN is not a password, but it should not end up in logs.
    errors.push(
      'SENTRY_DSN must be an https URL, the DSN from Sentry (Project Settings > Client Keys), for example https://<key>@o0.ingest.sentry.io/0. Leave it empty to turn error monitoring off.',
    );
  }

  for (const name of RATE_LIMIT_VARIABLES) {
    if (env[name] !== undefined && env[name] !== '' && !isPositiveInteger(env[name])) {
      errors.push(`${name} must be a whole number greater than 0.`);
    }
  }

  return errors;
}

module.exports = {
  JWT_SECRET_MIN_LENGTH,
  MAIL_REQUIRED_VARIABLES,
  RATE_LIMIT_VARIABLES,
  getStartupErrors,
  parseBooleanFlag,
  parseClientOrigins,
  parseDebugClientIp,
  parseMailConfig,
  parseSentryDsn,
  parseTrustCfConnectingIp,
  parseTrustProxy,
};
