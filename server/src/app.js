const express = require('express');
const helmet = require('helmet');
const { parseClientOrigins, parseTrustProxy } = require('./config');
const auditLogsRouter = require('./routes/auditLogs');
const authRouter = require('./routes/auth');
const ticketsRouter = require('./routes/tickets');
const usersRouter = require('./routes/users');
const { createLimiters } = require('./security/rateLimit');

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } };

// CORS for the configured frontend origins only (CLIENT_ORIGIN, comma-separated). The
// request's origin is echoed back on an exact match; "*" is never sent. Other origins get
// no CORS headers, and their preflight falls through to the JSON 404.
function corsAllowlist(allowedOrigins) {
  return (request, response, next) => {
    // Responses differ by Origin, so shared caches must keep them apart.
    response.vary('Origin');

    const origin = request.get('origin');
    if (!origin || !allowedOrigins.has(origin)) return next();

    response.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.set('Access-Control-Max-Age', '600');
      return response.sendStatus(204);
    }

    return next();
  };
}

// Builds the API. `env` is read once, here. `rateLimit` is passed to createLimiters
// (src/security/rateLimit.js): tests use it for small limits and fresh counters.
function createApp({ env = process.env, rateLimit = {} } = {}) {
  const app = express();
  const { loginLimiter, registerLimiter, globalLimiter } = createLimiters({ env, ...rateLimit });

  // Security headers on every response, errors and 404s included, so it comes first. The
  // API only ever returns JSON, so the CSP allows nothing to load and nothing to frame it.
  // Helmet also removes X-Powered-By.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );

  // On Render, requests arrive through one proxy, so the client's IP is the last entry of
  // X-Forwarded-For. Without this, every request would look like it came from the proxy
  // and all users would share one rate-limit counter. Trusting more hops than really exist
  // would let clients choose their own IP, so the value is a hop count (config.js).
  app.set('trust proxy', parseTrustProxy(env) ?? false);

  app.use(corsAllowlist(new Set(parseClientOrigins(env.CLIENT_ORIGIN))));

  // Outside the API prefix, so the health check is never rate limited.
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  // Limits run before the body is parsed. A request counts toward the global limit and,
  // for login and register, toward their own limit too.
  app.use('/api/v1', globalLimiter);
  app.post('/api/v1/auth/login', loginLimiter);
  app.post('/api/v1/auth/register', registerLimiter);

  // Room for a 5000-character ticket description in multi-byte scripts (up to 4 bytes each).
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/v1/hello', (_request, response) => {
    response.json({ message: 'Hello from ClinicDesk API' });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/tickets', ticketsRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/audit-logs', auditLogsRouter);

  // Unknown paths and methods: the uniform error shape, not Express's HTML page.
  app.use((_request, response) => response.status(404).json(NOT_FOUND));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
      });
    }

    if (error.type === 'entity.too.large') {
      return response.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
      });
    }

    // The error only: never the request body or headers (passwords, tokens).
    console.error(error);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });

  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
