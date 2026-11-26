const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { authenticate } = require('../auth/authenticate');
const { canAccessOwnedResource } = require('../auth/authorize');
const { recordAudit } = require('../audit/record');
const { validationError } = require('../validation');
const {
  STATUSES,
  allowedNextStatuses,
  canTransition,
  isWorkflowTransition,
} = require('../tickets/statusWorkflow');
const { buildListFilter, buildListPipeline, listQuerySchema } = require('../tickets/listQuery');
const { slaSnapshot } = require('../sla/policy');
const { getSlaState } = require('../sla/state');

const router = express.Router();

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
// Only these user fields ever leave the server inside a ticket (never email or passwordHash).
const PUBLIC_USER_FIELDS = 'name';

function publicUser(user) {
  return user ? { id: user._id.toString(), name: user.name } : null;
}

const STAFF_ROLES = ['agent', 'admin'];

// Builds the API shape from a lean, populated ticket, field by field. The SLA due dates are
// never sent as fields; agents and admins get the computed `sla` object, customers get no
// SLA data at all (docs/sla.md, docs/roles-and-permissions.md).
function serializeTicket(ticket, user, now = new Date()) {
  const serialized = {
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
  if (STAFF_ROLES.includes(user.role)) serialized.sla = getSlaState(ticket, now);
  return serialized;
}

// Detail-style response: the ticket plus the statuses this user may move it to next.
function serializeTicketFor(ticket, user) {
  return {
    ...serializeTicket(ticket, user),
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

  // The SLA due dates are a snapshot of the policy now (CD-22): createdAt is set here, not by
  // Mongoose, so both come from the same instant.
  const createdAt = new Date();
  const created = await Ticket.create({
    ...parsed.data,
    createdBy: request.user.id,
    createdAt,
    ...slaSnapshot(parsed.data.priority, createdAt),
  });
  const ticket = await withPublicUsers(Ticket.findById(created._id));

  // After the write, not awaited: the email never delays or changes the response (CD-21).
  request.app.get('notifier').notifyTicketCreated({
    ticket: { id: ticket._id.toString(), title: ticket.title, description: ticket.description },
    author: { id: request.user.id, name: ticket.createdBy?.name },
  });

  return response.status(201).json({ ticket: serializeTicket(ticket, request.user) });
});

// Customers see their own tickets; agents and admins see all (docs/ticket-list.md).
// Checks, in order: 400 bad query -> 403 customer filters by assignee or SLA. The customer
// scope is part of the filter, so filters and search only ever narrow it; the count and the
// page use the same filter.
router.get('/', async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const query = parsed.data;
  const isStaff = STAFF_ROLES.includes(request.user.role);
  if ((query.assignee !== undefined || query.sla !== undefined) && !isStaff) {
    return response.status(403).json(FORBIDDEN);
  }

  const { page, limit } = query;
  // One instant for the SLA filter and the SLA state of every ticket on the page.
  const now = new Date();
  const filter = buildListFilter(query, request.user, now);

  const [rows, total] = await Promise.all([
    Ticket.aggregate(buildListPipeline(filter, query)),
    Ticket.countDocuments(filter),
  ]);
  const tickets = await Ticket.populate(rows, [
    { path: 'createdBy', select: PUBLIC_USER_FIELDS },
    { path: 'assignee', select: PUBLIC_USER_FIELDS },
  ]);

  return response.json({
    items: tickets.map((ticket) => serializeTicket(ticket, request.user, now)),
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

  // resolvedAt stops the SLA resolution timer (CD-22): set on resolved, kept on closed (or
  // set there if it is missing), cleared on reopen. The status condition below makes this
  // one guarded update, so it never applies on top of someone else's change.
  const update = { status: nextStatus };
  if (nextStatus === 'resolved') update.resolvedAt = new Date();
  if (nextStatus === 'closed' && !ticket.resolvedAt) update.resolvedAt = new Date();
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

  await recordAudit({
    actor: request.user.id,
    action: 'ticket.status_changed',
    entityType: 'ticket',
    entityId: ticket._id,
    metadata: { from: currentStatus, to: nextStatus },
  });

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

  // Names are a snapshot at the time of the change ({ id, name } or null = unassigned).
  await recordAudit({
    actor: user.id,
    action: 'ticket.assignee_changed',
    entityType: 'ticket',
    entityId: ticket._id,
    metadata: { from: publicUser(ticket.assignee), to: publicUser(updated.assignee) },
  });

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

  // The first public staff reply stops the SLA first-response timer (CD-14, CD-22). The
  // filter makes this a no-op once firstResponseAt is set, even with two replies at once.
  if (isStaff && !created.internal) {
    await Ticket.findOneAndUpdate(
      { _id: ticket._id, firstResponseAt: null },
      { $set: { firstResponseAt: created.createdAt } },
    );
  }

  const comment = await Comment.findById(created._id)
    .populate('author', COMMENT_AUTHOR_FIELDS)
    .lean();

  // After the write, not awaited (CD-21). Internal notes never send an email.
  request.app.get('notifier').notifyReply({
    ticket: {
      id: ticket._id.toString(),
      title: ticket.title,
      createdBy: ticket.createdBy,
      assignee: ticket.assignee,
    },
    comment: { body: comment.body, internal: comment.internal },
    author: { id: user.id, name: comment.author?.name, role: user.role },
  });

  return response.status(201).json({ comment: serializeComment(comment) });
});

module.exports = router;
