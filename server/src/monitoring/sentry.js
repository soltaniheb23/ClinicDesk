// Error monitoring with Sentry (CD-25, docs/monitoring.md).
//
// Off unless SENTRY_DSN is set: without it the SDK is never loaded or initialised, so no
// event and no network call can happen. Under NODE_ENV=test it is also off unless a test
// injects a (mocked) SDK. server.js calls initSentry() before it requires the app.
//
// Only unexpected errors are reported: the 500 branch of the error handler in app.js
// (through captureError), and uncaught exceptions and unhandled rejections (the SDK's
// default integrations). 4xx answers are never reported.
const { parseSentryDsn } = require('../config');
const { scrubBreadcrumb, scrubEvent } = require('./scrub');

// Errors: every one is sent. Performance tracing is off (no tracesSampleRate), so no
// transactions or spans are sent at all.
const ERROR_SAMPLE_RATE = 1.0;

// The SDK once initialised, otherwise null (monitoring is off).
let sdk = null;

// The options passed to Sentry.init. Exported for the tests.
function sentryOptions(env, dsn) {
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    // Render sets RENDER_GIT_COMMIT to the deployed commit; without it there is no release.
    ...(env.RENDER_GIT_COMMIT ? { release: env.RENDER_GIT_COMMIT } : {}),
    // A fixed name instead of the machine's hostname (which can hold a person's name).
    serverName: 'clinicdesk-api',
    sampleRate: ERROR_SAMPLE_RATE,
    sendDefaultPii: false,
    // SDK v11 collects request data according to dataCollection: turn every category off.
    // scrubEvent below removes the same data again, in case a default changes.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

// Returns true when Sentry was initialised. `sentry` replaces the SDK (tests pass a mock).
function initSentry(env = process.env, { sentry } = {}) {
  const dsn = parseSentryDsn(env);
  // Unset (undefined) or invalid (null; getStartupErrors stops the server for it).
  if (!dsn) return false;
  if (env.NODE_ENV === 'test' && !sentry) return false;

  const client = sentry ?? require('@sentry/node');
  client.init(sentryOptions(env, dsn));
  sdk = client;
  return true;
}

function isSentryEnabled() {
  return sdk !== null;
}

// Reports one error. `request` adds the caller's opaque user id (never anything else about
// them) and the route. Does nothing while monitoring is off. Returns true when sent.
function captureError(error, request, { tags = {} } = {}) {
  if (!sdk) return false;
  sdk.withScope((scope) => {
    if (request?.user?.id) scope.setUser({ id: String(request.user.id) });
    if (request?.method) scope.setTag('http.method', request.method);
    for (const [name, value] of Object.entries(tags)) scope.setTag(name, value);
    sdk.captureException(error);
  });
  return true;
}

// For the tests: forget the SDK so the next test starts with monitoring off.
function resetSentry() {
  sdk = null;
}

module.exports = { captureError, initSentry, isSentryEnabled, resetSentry, sentryOptions };
