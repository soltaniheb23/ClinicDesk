// Query parameter rules shared by the paginated list endpoints (GET /tickets, GET /users).
const { z } = require('zod');

const SEARCH_MAX_LENGTH = 100;

const pageNumber = z.coerce
  .number({ error: 'Page must be a whole number of at least 1' })
  .int({ error: 'Page must be a whole number of at least 1' })
  .min(1, { error: 'Page must be a whole number of at least 1' })
  .default(1);

const pageLimit = z.coerce
  .number({ error: 'Limit must be a whole number from 1 to 50' })
  .int({ error: 'Limit must be a whole number from 1 to 50' })
  .min(1, { error: 'Limit must be a whole number from 1 to 50' })
  .max(50, { error: 'Limit must be a whole number from 1 to 50' })
  .default(10);

// Free-text search, 1 to 100 characters after trimming.
const searchText = z
  .string({ error: 'Search must be text' })
  .trim()
  .min(1, { error: `Search must be 1 to ${SEARCH_MAX_LENGTH} characters` })
  .max(SEARCH_MAX_LENGTH, { error: `Search must be 1 to ${SEARCH_MAX_LENGTH} characters` })
  .optional();

// An object schema for `shape` in which unknown keys, including bracket forms such as
// role[$ne] or role.$ne, are a 400 with the key as the field, never ignored or passed on.
function strictQuerySchema(shape) {
  return z
    .object(shape)
    .catchall(z.unknown())
    .superRefine((data, context) => {
      for (const key of Object.keys(data)) {
        if (!Object.hasOwn(shape, key)) {
          context.addIssue({ code: 'custom', path: [key], message: 'Unknown query parameter' });
        }
      }
    });
}

// Escapes every character with a meaning in a regular expression, so the search is plain
// text: ".*" matches a literal ".*", "(" cannot break the pattern, and the escaped pattern
// has no nested quantifiers (no ReDoS).
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

// The paging fields of a list response.
function pageInfo({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

module.exports = {
  SEARCH_MAX_LENGTH,
  pageNumber,
  pageLimit,
  searchText,
  strictQuerySchema,
  escapeRegex,
  pageInfo,
};
