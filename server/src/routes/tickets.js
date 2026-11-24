const express = require('express');
const { z } = require('zod');
const Ticket = require('../models/Ticket');
const { authenticate } = require('../auth/authenticate');
const { validationError } = require('../validation');

const router = express.Router();

const MY_TICKETS_LIMIT = 50;

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

  const ticket = await Ticket.create({ ...parsed.data, createdBy: request.user.id });

  return response.status(201).json({ ticket });
});

// Minimal "my tickets" read for CD-10; filters, pagination and detail come in CD-11.
router.get('/mine', async (request, response) => {
  const tickets = await Ticket.find({ createdBy: request.user.id })
    .sort({ createdAt: -1, _id: -1 })
    .limit(MY_TICKETS_LIMIT);

  return response.json({ items: tickets });
});

module.exports = router;
