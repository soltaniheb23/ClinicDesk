const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const { authenticate } = require('../auth/authenticate');
const { canAccessOwnedResource } = require('../auth/authorize');
const { validationError } = require('../validation');

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

// An invalid id, an unknown ticket and another customer's ticket all get the same 404, so
// the response never reveals that a ticket exists.
router.get('/:id', async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    return response.status(404).json(NOT_FOUND);
  }

  const ticket = await withPublicUsers(Ticket.findById(request.params.id));
  const ownerId = ticket?.createdBy?._id;

  if (!ticket || !canAccessOwnedResource(request.user, ownerId)) {
    return response.status(404).json(NOT_FOUND);
  }

  return response.json({ ticket: serializeTicket(ticket) });
});

module.exports = router;
