// Audit log, read only (CD-20, docs/audit-log.md). There is no create, update or delete
// route: entries are written by the routes that act (src/audit/record.js) and the model
// refuses changes.
//
// Order of checks: 401 (authenticate) -> 403 not an admin (requireRole) -> 400 bad query.
const express = require('express');
const { z } = require('zod');
const AuditLog = require('../models/AuditLog');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { authenticate } = require('../auth/authenticate');
const { requireRole } = require('../auth/authorize');
const { pageInfo, pageLimit, pageNumber, strictQuerySchema } = require('../queryParams');
const { validationError } = require('../validation');

const router = express.Router();

const { ACTIONS, ENTITY_TYPES } = AuditLog;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const DATE_MESSAGE = 'must be an ISO date (2026-11-25) or date-time (2026-11-25T08:00:00Z)';

// An ISO date-time with a time zone, or a plain date (read as UTC). `endOfDay` makes a
// plain date in `to` include that whole day.
function isoDate(name, { endOfDay = false } = {}) {
  return z
    .union([z.iso.datetime({ offset: true }), z.iso.date()], {
      error: `${name} ${DATE_MESSAGE}`,
    })
    .transform((value) => {
      if (value.length > 10) return new Date(value);
      return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    })
    .optional();
}

const listQuerySchema = strictQuerySchema({
  page: pageNumber,
  limit: pageLimit,
  action: z.enum(ACTIONS, { error: `Action must be one of: ${ACTIONS.join(', ')}` }).optional(),
  actor: z
    .string({ error: 'Actor must be a user id' })
    .regex(OBJECT_ID_PATTERN, { error: 'Actor must be a user id' })
    .optional(),
  entityType: z
    .enum(ENTITY_TYPES, { error: `Entity type must be one of: ${ENTITY_TYPES.join(', ')}` })
    .optional(),
  from: isoDate('from'),
  to: isoDate('to', { endOfDay: true }),
}).refine((query) => !query.from || !query.to || query.from <= query.to, {
  path: ['to'],
  error: 'to must not be before from',
});

// Display names for the users and tickets the entries point at, two queries per page.
// Deleted users or tickets get no label.
async function entityLabels(entries) {
  const idsOf = (type) => [
    ...new Set(
      entries
        .filter((entry) => entry.entityType === type && entry.entityId)
        .map((e) => String(e.entityId)),
    ),
  ];
  const [users, tickets] = await Promise.all([
    User.find({ _id: { $in: idsOf('user') } })
      .select('name')
      .lean(),
    Ticket.find({ _id: { $in: idsOf('ticket') } })
      .select('title')
      .lean(),
  ]);
  return new Map([
    ...users.map((user) => [`user:${user._id}`, user.name]),
    ...tickets.map((ticket) => [`ticket:${ticket._id}`, ticket.title]),
  ]);
}

function serializeEntry(entry, labels) {
  const entityId = entry.entityId ? entry.entityId.toString() : null;
  return {
    id: entry._id.toString(),
    actor: entry.actor ? { id: entry.actor._id.toString(), name: entry.actor.name } : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId,
    entityLabel: (entityId && labels.get(`${entry.entityType}:${entityId}`)) ?? null,
    metadata: entry.metadata ?? {},
    createdAt: entry.createdAt,
  };
}

router.use(authenticate, requireRole('admin'));

router.get('/', async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const query = parsed.data;
  // Every value is built here (enum values, an ObjectId string, Dates), so no request
  // value becomes an operator.
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.actor) filter.actor = query.actor;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = query.from;
    if (query.to) filter.createdAt.$lte = query.to;
  }

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      // Only the actor's id and name leave the server (never email or passwordHash).
      .populate('actor', 'name')
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  const labels = await entityLabels(entries);

  return response.json({
    items: entries.map((entry) => serializeEntry(entry, labels)),
    ...pageInfo(query, total),
  });
});

module.exports = router;
