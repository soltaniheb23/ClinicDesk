// Rate limits (CD-24, docs/security-review.md).
//
// Counters live in memory, per process. That is enough for ClinicDesk's single Render
// instance; with several instances each one would count on its own, and a shared store
// (for example Redis) would be needed.
const { rateLimit } = require('express-rate-limit');

const MINUTE = 60 * 1000;

const DEFAULTS = Object.freeze({
  // Failed logins only (successful ones are not counted): password guessing.
  login: { max: 10, windowMs: 15 * MINUTE, message: 'Too many login attempts.' },
  // Account creation: sign-up spam.
  register: { max: 5, windowMs: 60 * MINUTE, message: 'Too many accounts created.' },
  // Everything under /api/v1: a soft ceiling against floods and scraping.
  global: { max: 300, windowMs: 15 * MINUTE, message: 'Too many requests.' },
});

function envNumber(env, name) {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

// RATE_LIMIT_<NAME>_MAX and RATE_LIMIT_<NAME>_WINDOW_MS (invalid values stop the server at
// startup, see config.js; here they are ignored).
function envSettings(env, name) {
  const prefix = `RATE_LIMIT_${name.toUpperCase()}`;
  const settings = {};
  const max = envNumber(env, `${prefix}_MAX`);
  const windowMs = envNumber(env, `${prefix}_WINDOW_MS`);
  if (max) settings.max = max;
  if (windowMs) settings.windowMs = windowMs;
  return settings;
}

function retryAfterSeconds(request) {
  const resetTime = request.rateLimit?.resetTime;
  if (!(resetTime instanceof Date)) return 1;
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
}

function buildLimiter({ max, windowMs, message }, extra = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    // RateLimit and RateLimit-Policy headers (IETF draft 7); no X-RateLimit-* headers.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // The uniform error shape. The request never reaches the route, so a limited login
    // writes no audit entry.
    handler(request, response) {
      const seconds = retryAfterSeconds(request);
      response.set('Retry-After', String(seconds));
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `${message} Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? 's' : ''}.`,
        },
      });
    },
    ...extra,
  });
}

function passThrough(_request, _response, next) {
  next();
}

// Returns { loginLimiter, registerLimiter, globalLimiter }. Each call makes fresh counters.
// Settings come from the defaults, then RATE_LIMIT_* in `env`, then the `login`, `register`
// and `global` arguments (tests use small numbers there).
// `enabled` defaults to false only when NODE_ENV is "test", so test files that are not about
// rate limits never share a counter; the rate-limit tests turn it on explicitly.
function createLimiters({ env = process.env, enabled, login, register, global } = {}) {
  const isEnabled = enabled ?? env.NODE_ENV !== 'test';
  if (!isEnabled) {
    return { loginLimiter: passThrough, registerLimiter: passThrough, globalLimiter: passThrough };
  }

  const settings = (name, overrides) => ({
    ...DEFAULTS[name],
    ...envSettings(env, name),
    ...overrides,
  });

  return {
    loginLimiter: buildLimiter(settings('login', login), { skipSuccessfulRequests: true }),
    registerLimiter: buildLimiter(settings('register', register)),
    globalLimiter: buildLimiter(settings('global', global)),
  };
}

module.exports = { createLimiters, DEFAULTS };
