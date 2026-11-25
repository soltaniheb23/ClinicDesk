const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { authenticate } = require('../auth/authenticate');
const { canAccessOwnedResource } = require('../auth/authorize');
const { validationError } = require('../validation');
const {
  STATUSES,
  allowedNextStatuses,
  canTransition,
  isWorkflowTransition,
} = require('../tickets/statusWorkflow');
const { buildListFilter, buildListPipeline, listQuerySchema } = require('../tickets/listQuery');

const router = express.Router();

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
// Only these user fields ever leave the server inside a ticket (never email or passwordHash).
const PUBLIC_USER_FIELDS = 'name';

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

const assigneeChangeSchema = z.object({
  assignee: z.union(
    [
      z.null(),
      z.string().refine((value) => mongoose.isValidObjectId(value), {
        error: 'Assignee must be a user id or null',
      }),
    ],
    { error: 'Assignee must be a user id or null' },
  ),
});

// Unknown keys (author, createdAt, ticket, ...) are stripped: the server sets those.
const createCommentSchema = z.object({
  body: z
    .string({ error: 'Comment is required' })
    .trim()
    .min(1, { error: 'Comment is required' })
    .max(2000, { error: 'Comment must be at most 2000 characters' }),
  internal: z.boolean({ error: 'Internal must be true or false' }).default(false),
});

// Comment authors also show their role (for the "Agent" / "Customer" label); never email.
const COMMENT_AUTHOR_FIELDS = 'name role';

function serializeComment(comment) {
  const { author } = comment;
  return {
    id: comment._id.toString(),
    ticket: comment.ticket.toString(),
    author: author ? { id: author._id.toString(), name: author.name, role: author.role } : null,
    body: comment.body,
    internal: comment.internal,
    createdAt: comment.createdAt,
  };
}

const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};
const STAFF_ROLES = ['agent', 'admin'];

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

// Customers see their own tickets; agents and admins see all (docs/ticket-list.md).
// Checks, in order: 400 bad query -> 403 customer filters by assignee. The customer scope
// is part of the filter, so filters and search only ever narrow it; the count and the
// page use the same filter.
router.get('/', async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const query = parsed.data;
  if (query.assignee !== undefined && !STAFF_ROLES.includes(request.user.role)) {
    return response.status(403).json(FORBIDDEN);
  }

  const { page, limit } = query;
  const filter = buildListFilter(query, request.user);

  const [rows, total] = await Promise.all([
    Ticket.aggregate(buildListPipeline(filter, query)),
    Ticket.countDocuments(filter),
  ]);
  const tickets = await Ticket.populate(rows, [
    { path: 'createdBy', select: PUBLIC_USER_FIELDS },
    { path: 'assignee', select: PUBLIC_USER_FIELDS },
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
      return response.status(403).json(FORBIDDEN);
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

// Assignment (docs/assignment.md). Checks, in order:
// 404 not visible -> 403 customer -> 400 bad body -> 400 assignee is not an active agent or
// admin -> 403 agent assigning someone else (or releasing a ticket that is not theirs) ->
// 409 ticket is closed.
router.patch('/:id/assignee', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(NOT_FOUND);

  const { user } = request;
  if (!STAFF_ROLES.includes(user.role)) return response.status(403).json(FORBIDDEN);

  const parsed = assigneeChangeSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const nextAssigneeId = parsed.data.assignee;

  if (nextAssigneeId !== null) {
    const assignee = await User.findById(nextAssigneeId).select('role isActive').lean();
    if (!assignee || !assignee.isActive || !STAFF_ROLES.includes(assignee.role)) {
      return response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [{ field: 'assignee', message: 'Assignee must be an active agent or admin' }],
        },
      });
    }
  }

  const currentAssigneeId = ticket.assignee?._id?.toString() ?? null;

  // Agents may only claim a ticket for themselves or release their own assignment.
  if (user.role === 'agent') {
    const isClaim = nextAssigneeId === user.id;
    const isRelease = nextAssigneeId === null && currentAssigneeId === user.id;
    if (!isClaim && !isRelease) return response.status(403).json(FORBIDDEN);
  }

  if (ticket.status === 'closed') {
    return response.status(409).json({
      error: { code: 'TICKET_CLOSED', message: 'A closed ticket cannot be reassigned' },
    });
  }

  // Only applies if nobody changed the assignee (or closed the ticket) since we read it.
  const updated = await withPublicUsers(
    Ticket.findOneAndUpdate(
      { _id: ticket._id, assignee: currentAssigneeId, status: { $ne: 'closed' } },
      { $set: { assignee: nextAssigneeId } },
      { returnDocument: 'after', runValidators: true },
    ),
  );

  if (!updated) {
    return response.status(409).json({
      error: {
        code: 'ASSIGNEE_CONFLICT',
        message: 'The ticket was changed by someone else. Reload the ticket and try again.',
      },
    });
  }

  return response.json({ ticket: serializeTicketFor(updated, user) });
});

// Comment thread (docs/comments.md). Same visibility rule as the ticket itself.
router.get('/:id/comments', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(NOT_FOUND);

  // Customers never receive internal notes: they are filtered out by the query itself.
  const filter = { ticket: ticket._id };
  if (!STAFF_ROLES.includes(request.user.role)) filter.internal = false;

  const comments = await Comment.find(filter)
    .sort({ createdAt: 1, _id: 1 })
    .populate('author', COMMENT_AUTHOR_FIELDS)
    .lean();

  return response.json({ items: comments.map(serializeComment) });
});

// Checks, in order: 404 not visible -> 400 bad body -> 403 customer asks for an internal
// note -> 409 ticket is closed.
router.post('/:id/comments', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(NOT_FOUND);

  const parsed = createCommentSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const { user } = request;
  const isStaff = STAFF_ROLES.includes(user.role);
  if (parsed.data.internal && !isStaff) return response.status(403).json(FORBIDDEN);

  if (ticket.status === 'closed') {
    return response.status(409).json({
      error: { code: 'TICKET_CLOSED', message: 'A closed ticket does not accept comments' },
    });
  }

  const created = await Comment.create({
    ticket: ticket._id,
    author: user.id,
    body: parsed.data.body,
    internal: parsed.data.internal,
  });

  // The first public staff reply starts the SLA clock (CD-22). The filter makes this a
  // no-op once firstResponseAt is set, even with two replies at the same time.
  if (isStaff && !created.internal) {
    await Ticket.findOneAndUpdate(
      { _id: ticket._id, firstResponseAt: null },
      { $set: { firstResponseAt: created.createdAt } },
    );
  }

  const comment = await Comment.findById(created._id)
    .populate('author', COMMENT_AUTHOR_FIELDS)
    .lean();

  return response.status(201).json({ comment: serializeComment(comment) });
});

module.exports = router;
