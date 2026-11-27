// Error monitoring with Sentry in the browser (CD-25, docs/monitoring.md).
//
// Off unless VITE_SENTRY_DSN is set at build time: without it Sentry.init is never called,
// so nothing is sent. In a test run it stays off unless a test injects a mocked SDK.
// main.jsx calls initMonitoring() before the app renders.
import { init } from '@sentry/react';
import { scrubBreadcrumb, scrubEvent } from './scrub.js';

// Every error is sent. No performance tracing and no session replay are configured.
const ERROR_SAMPLE_RATE = 1.0;

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// The options passed to Sentry.init. Exported for the tests.
// VITE_SENTRY_RELEASE and VITE_SENTRY_ENVIRONMENT are filled in by vite.config.js from
// Vercel's VERCEL_GIT_COMMIT_SHA and VERCEL_ENV when they are not set.
export function sentryOptions(env, dsn) {
  return {
    dsn,
    environment: env.VITE_SENTRY_ENVIRONMENT || env.MODE || 'production',
    ...(env.VITE_SENTRY_RELEASE ? { release: env.VITE_SENTRY_RELEASE } : {}),
    sampleRate: ERROR_SAMPLE_RATE,
    sendDefaultPii: false,
    // SDK v11 collects request data according to dataCollection: turn every category off.
    // scrubEvent removes the same data again, in case a default changes.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

// Returns true when Sentry was initialised. `sdk` replaces @sentry/react (tests pass a mock).
export function initMonitoring({ env = import.meta.env, sdk } = {}) {
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return false;
  if (!isHttpsUrl(dsn)) {
    console.warn('VITE_SENTRY_DSN is not an https URL; error monitoring is off.');
    return false;
  }
  if (env.MODE === 'test' && !sdk) return false;

  const options = sentryOptions(env, dsn);
  if (sdk) sdk.init(options);
  else init(options);
  return true;
}
