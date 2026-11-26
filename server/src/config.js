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

  for (const name of RATE_LIMIT_VARIABLES) {
    if (env[name] !== undefined && env[name] !== '' && !isPositiveInteger(env[name])) {
      errors.push(`${name} must be a whole number greater than 0.`);
    }
  }

  return errors;
}

module.exports = {
  JWT_SECRET_MIN_LENGTH,
  RATE_LIMIT_VARIABLES,
  getStartupErrors,
  parseBooleanFlag,
  parseClientOrigins,
  parseDebugClientIp,
  parseTrustCfConnectingIp,
  parseTrustProxy,
};
