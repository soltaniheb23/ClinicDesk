// Debug routes (CD-25, docs/monitoring.md). Admin only.
//
// POST /sentry-test throws a test error, catches it, reports it to Sentry and answers
// { ok: true }, so an admin can prove that events reach the Sentry project. The error is
// handled: the client never sees a 500. Rate limited by the global /api/v1 limiter (app.js).
//
// Order of checks: 401 (authenticate) -> 403 not an admin (requireRole).
const express = require('express');
const { authenticate } = require('../auth/authenticate');
const { requireRole } = require('../auth/authorize');
const { captureError } = require('../monitoring/sentry');

const TEST_ERROR_MESSAGE = 'ClinicDesk Sentry test error (server, POST /api/v1/debug/sentry-test)';

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.post('/sentry-test', (request, response) => {
  try {
    throw new Error(TEST_ERROR_MESSAGE);
  } catch (error) {
    captureError(error, request, { tags: { sentry_test: 'true' } });
  }
  return response.json({ ok: true });
});

module.exports = router;
module.exports.TEST_ERROR_MESSAGE = TEST_ERROR_MESSAGE;
