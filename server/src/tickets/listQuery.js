// Query parameters, filter and sort for GET /api/v1/tickets (docs/ticket-list.md).
//
// Every value that reaches MongoDB is built here by the server: enum values come from the
// fixed lists, ids are converted to ObjectIds, and the title search is an escaped literal.
// No request value is ever used as a key or an operator.
const mongoose = require('mongoose');
const { z } = require('zod');
const { CATEGORIES, PRIORITIES } = require('../models/Ticket');
const { STATUSES } = require('./statusWorkflow');
const {
  escapeRegex,
  pageLimit,
  pageNumber,
  searchText,
  strictQuerySchema,
} = require('../queryParams');

const SORT_FIELDS = ['createdAt', 'updatedAt', 'priority', 'status'];
const ORDERS = ['asc', 'desc'];
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

// Sorted by meaning, not alphabetically: the position in these lists is the rank.
// PRIORITIES runs low -> urgent and STATUSES follows the workflow (open -> closed).
const RANKS = { priority: PRIORITIES, status: STATUSES };

// One value or a comma-separated list ("open,in_progress"); every part must be valid.
// A repeated parameter (?status=a&status=b) arrives as an array and is rejected.
function enumList(values, name) {
  const message = `${name} must be one or more of: ${values.join(', ')} (comma-separated)`;
  return z.string({ error: message }).transform((value, context) => {
    const parts = value.split(',').map((part) => part.trim());
    if (parts.some((part) => !values.includes(part))) {
      context.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return [...new Set(parts)];
  });
}

const assigneeMessage = 'Assignee must be a user id, "me" or "unassigned"';

const listShape = {
  page: pageNumber,
  limit: pageLimit,
  status: enumList(STATUSES, 'Status').optional(),
  priority: enumList(PRIORITIES, 'Priority').optional(),
  category: enumList(CATEGORIES, 'Category').optional(),
  assignee: z
    .string({ error: assigneeMessage })
    .refine((value) => value === 'me' || value === 'unassigned' || OBJECT_ID_PATTERN.test(value), {
      error: assigneeMessage,
    })
    .optional(),
  q: searchText,
  sort: z
    .enum(SORT_FIELDS, { error: `Sort must be one of: ${SORT_FIELDS.join(', ')}` })
    .default('createdAt'),
  order: z.enum(ORDERS, { error: 'Order must be asc or desc' }).default('desc'),
};

// Unknown keys, including bracket forms such as status[$ne] or status.$ne, are a 400 with
// the key as the field, never ignored or passed on.
const listQuerySchema = strictQuerySchema(listShape);

function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

// The customer scope is spread last, so no filter can replace or widen it. Ids are real
// ObjectIds because the same filter is used in an aggregation, which does not cast.
function buildListFilter(query, user) {
  const filter = {};

  if (query.status) filter.status = { $in: query.status };
  if (query.priority) filter.priority = { $in: query.priority };
  if (query.category) filter.category = { $in: query.category };

  if (query.assignee === 'me') filter.assignee = toObjectId(user.id);
  else if (query.assignee === 'unassigned') filter.assignee = null;
  else if (query.assignee) filter.assignee = toObjectId(query.assignee);

  if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: 'i' };

  const scope = user.role === 'customer' ? { createdBy: toObjectId(user.id) } : {};
  return { ...filter, ...scope };
}

// Aggregation stages for one page. Date sorts use the fields directly (and the indexes);
// priority and status sort by their rank, newest first within the same rank. _id is always
// the last key, so tickets with equal values keep a stable order across pages.
function buildListPipeline(filter, { sort, order, page, limit }) {
  const direction = order === 'asc' ? 1 : -1;
  const stages = [{ $match: filter }];

  if (RANKS[sort]) {
    stages.push({ $addFields: { sortRank: { $indexOfArray: [RANKS[sort], `$${sort}`] } } });
    stages.push({ $sort: { sortRank: direction, createdAt: -1, _id: -1 } });
  } else {
    stages.push({ $sort: { [sort]: direction, _id: direction } });
  }

  stages.push({ $skip: (page - 1) * limit }, { $limit: limit });
  return stages;
}

module.exports = {
  listQuerySchema,
  buildListFilter,
  buildListPipeline,
  escapeRegex,
  SORT_FIELDS,
};
