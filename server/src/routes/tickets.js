const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const { authenticate } = require('../auth/authenticate');
const { canAccessOwnedResource } = require('../auth/authorize');
const { validationError } = require('../validation');
const {
  STATUSES,
  allowedNextStatuses,
  canTransition,
  isWorkflowTransition,
} = require('../tickets/statusWorkflow');

const router = express.Router();

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
// Only these user fields ever leave the server inside a ticket (never email or passwordHash).
const PUBLIC_USER_FIELDS = 'name';

const listQuerySchema = z.object({
  page: z.coerce
    .number({ error: 'Page must be a whole number of at least 1' })
    .int({ error: 'Page must be a whole number of at least 1' })
    .min(1, { error: 'Page must be a whole number of at least 1' })
    .default(1),
  limit: z.coerce
    .number({ error: 'Limit must be a whole number from 1 to 50' })
    .int({ error: 'Limit must be a whole number from 1 to 50' })
    .min(1, { error: 'Limit must be a whole number from 1 to 50' })
    .max(50, { error: 'Limit must be a whole number from 1 to 50' })
    .default(10),
});

function publicUser(user) {
  return user ? { id: user._id.toString(), name: user.name } : null;
}

// Builds the API shape from a lean, populated ticket, field by field.
function serializeTicket(ticket) {
  return {
    id: ticket._id.toString(),
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    createdBy: publicUser(ticket.createdBy),
    assignee: publicUser(ticket.assignee),
    firstResponseAt: ticket.firstResponseAt ?? null,
    resolvedAt: ticket.resolvedAt ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

// Detail-style response: the ticket plus the statuses this user may move it to next.
function serializeTicketFor(ticket, user) {
  return {
    ...serializeTicket(ticket),
    allowedNextStatuses: allowedNextStatuses(ticket.status, user.role),
  };
}

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

const statusChangeSchema = z.object({
  status: z.enum(STATUSES, { error: `Status must be one of: ${STATUSES.join(', ')}` }),
});

function withPublicUsers(query) {
  return query
    .populate('createdBy', PUBLIC_USER_FIELDS)
    .populate('assignee', PUBLIC_USER_FIELDS)
    .lean();
}

// Unknown keys (status, createdBy, assignee, ...) are stripped: the server sets those.
const createTicketSchema = z.object({
  title: z
    .string({ error: 'Title is required' })
    .trim()
    .min(1, { error: 'Title is required' })
    .max(120, { error: 'Title must be at most 120 characters' }),
  description: z
    .string({ error: 'Description is required' })
    .trim()
    .min(1, { error: 'Description is required' })
    .max(5000, { error: 'Description must be at most 5000 characters' }),
  category: z.enum(Ticket.CATEGORIES, { error: 'Choose a valid category' }).default('other'),
  priority: z.enum(Ticket.PRIORITIES, { error: 'Choose a valid priority' }).default('normal'),
});

// Every ticket route needs a logged-in user. Customers, agents and admins may create tickets.
router.use(authenticate);

router.post('/', async (request, response) => {
  const parsed = createTicketSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const created = await Ticket.create({ ...parsed.data, createdBy: request.user.id });
  const ticket = await withPublicUsers(Ticket.findById(created._id));

  return response.status(201).json({ ticket: serializeTicket(ticket) });
});

// Customers see their own tickets; agents and admins see all. Newest first.
// Filters (status, priority, search, ...) come in CD-17.
router.get('/', async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const { page, limit } = parsed.data;
  const filter = request.user.role === 'customer' ? { createdBy: request.user.id } : {};

  const [tickets, total] = await Promise.all([
    withPublicUsers(
      Ticket.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ),
    Ticket.countDocuments(filter),
  ]);

  return response.json({
    items: tickets.map(serializeTicket),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

// Returns the ticket if this user may see it, otherwise null. An invalid id, an unknown
// ticket and another customer's ticket are treated the same, so a 404 never reveals that a
// ticket exists.
async function findVisibleTicket(request) {
  if (!mongoose.isValidObjectId(request.params.id)) return null;

  const ticket = await withPublicUsers(Ticket.findById(request.params.id));
  if (!ticket || !canAccessOwnedResource(request.user, ticket.createdBy?._id)) return null;

  return ticket;
}

router.get('/:id', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(NOT_FOUND);

  return response.json({ ticket: serializeTicketFor(ticket, request.user) });
});

// Status workflow (docs/status-workflow.md). Checks, in order:
// 404 not visible -> 400 bad body -> 403 customer asks for a staff-only transition ->
// 409 not a workflow transition (including "same status" and anything from closed).
router.patch('/:id/status', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(NOT_FOUND);

  const parsed = statusChangeSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const currentStatus = ticket.status;
  const nextStatus = parsed.data.status;
  const { role } = request.user;

  if (!canTransition(currentStatus, nextStatus, role)) {
    if (role === 'customer' && isWorkflowTransition(currentStatus, nextStatus)) {
      return response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
      });
    }

    return response.status(409).json({
      error: {
        code: 'INVALID_TRANSITION',
        message: `Cannot change status from ${STATUS_LABELS[currentStatus]} to ${STATUS_LABELS[nextStatus]}`,
      },
    });
  }

  const update = { status: nextStatus };
  if (nextStatus === 'resolved') update.resolvedAt = new Date();
  if (currentStatus === 'resolved' && nextStatus === 'in_progress') update.resolvedAt = null;
  // firstResponseAt is left alone: the first agent comment sets it (CD-14).

  // Only applies if nobody changed the status since we read it.
  const updated = await withPublicUsers(
    Ticket.findOneAndUpdate(
      { _id: ticket._id, status: currentStatus },
      { $set: update },
      { returnDocument: 'after', runValidators: true },
    ),
  );

  if (!updated) {
    return response.status(409).json({
      error: {
        code: 'STATUS_CONFLICT',
        message: 'The status was changed by someone else. Reload the ticket and try again.',
      },
    });
  }

  return response.json({ ticket: serializeTicketFor(updated, request.user) });
});

module.exports = router;
