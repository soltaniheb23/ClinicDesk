// Rate limits (CD-24, docs/security-review.md).
//
// Counters live in memory, per process. That is enough for ClinicDesk's single Render
// instance; with several instances each one would count on its own, and a shared store
// (for example Redis) would be needed.
//
// The client key: by default req.ip, which comes from X-Forwarded-For and the TRUST_PROXY
// hop count (app.js). Behind Cloudflare plus Render's load balancer no fixed hop count gave
// an entry the client could not choose (a new X-Forwarded-For meant a new counter). With
// TRUST_CF_CONNECTING_IP=true the key is Cloudflare's CF-Connecting-IP instead, which
// Cloudflare sets to the address that connected to it and overwrites if the client sends it.
const { isIP } = require('node:net');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { parseTrustCfConnectingIp } = require('../config');

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

// Returns the keyGenerator shared by every limiter. ipKeyGenerator keeps IPv4 as is and
// reduces IPv6 to its /56 network (express-rate-limit's default), so one client cannot rotate
// through the addresses of its own IPv6 range to get fresh counters.
function clientKeyGenerator(trustCfConnectingIp) {
  return function keyGenerator(request) {
    if (trustCfConnectingIp) {
      const cfConnectingIp = request.get('cf-connecting-ip')?.trim();
      // Only a bare IPv4 or IPv6 address; anything else falls back to req.ip.
      if (cfConnectingIp && isIP(cfConnectingIp)) return ipKeyGenerator(cfConnectingIp);
    }
    return ipKeyGenerator(request.ip);
  };
}

function buildLimiter({ max, windowMs, message }, keyGenerator, extra = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator,
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
// `trustCfConnectingIp` defaults to TRUST_CF_CONNECTING_IP in `env` (config.js); an invalid
// value counts as false here, and stops the server at startup.
function createLimiters({
  env = process.env,
  enabled,
  trustCfConnectingIp,
  login,
  register,
  global,
} = {}) {
  const isEnabled = enabled ?? env.NODE_ENV !== 'test';
  if (!isEnabled) {
    return { loginLimiter: passThrough, registerLimiter: passThrough, globalLimiter: passThrough };
  }

  const settings = (name, overrides) => ({
    ...DEFAULTS[name],
    ...envSettings(env, name),
    ...overrides,
  });

  const keyGenerator = clientKeyGenerator(
    trustCfConnectingIp ?? parseTrustCfConnectingIp(env) === true,
  );

  return {
    loginLimiter: buildLimiter(settings('login', login), keyGenerator, {
      skipSuccessfulRequests: true,
    }),
    registerLimiter: buildLimiter(settings('register', register), keyGenerator),
    globalLimiter: buildLimiter(settings('global', global), keyGenerator),
  };
}

module.exports = { clientKeyGenerator, createLimiters, DEFAULTS };
