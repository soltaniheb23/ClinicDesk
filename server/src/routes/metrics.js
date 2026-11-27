// Team metrics (CD-23, docs/metrics.md). Read only, admin only: the page compares
// colleagues, so agents and customers get 403.
//
// Order of checks: 401 (authenticate) -> 403 not an admin (requireRole) -> 400 bad query.
const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../auth/authenticate');
const { requireRole } = require('../auth/authorize');
const { computeMetrics } = require('../metrics/compute');
const { DEFAULT_RANGE, RANGES } = require('../metrics/range');
const { strictQuerySchema } = require('../queryParams');
const { validationError } = require('../validation');

const router = express.Router();

const querySchema = strictQuerySchema({
  range: z
    .enum(RANGES, { error: `Range must be one of: ${RANGES.join(', ')}` })
    .default(DEFAULT_RANGE),
});

router.use(authenticate, requireRole('admin'));

router.get('/', async (request, response) => {
  const parsed = querySchema.safeParse(request.query ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  // The app's clock (app.js), so tests can fix "now" like the SLA tests do.
  const now = request.app.get('clock')();
  const metrics = await computeMetrics({ range: parsed.data.range, now });

  // Names of colleagues and their workload: never kept by a shared cache.
  response.set('Cache-Control', 'private, no-store');
  return response.json(metrics);
});

module.exports = router;
