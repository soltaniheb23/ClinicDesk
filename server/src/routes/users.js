// User routes. GET /agents is for agents and admins; everything else is admin user
// management (CD-19, docs/user-management.md).
//
// Order of checks on every admin route: 401 (authenticate) -> 403 not an admin
// (requireRole) -> 400 bad query or body -> 404 unknown user -> 409 safeguard or conflict.
const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const { authenticate } = require('../auth/authenticate');
const { requireRole } = require('../auth/authorize');
const { hashPassword } = require('../auth/password');
const { EMAIL_TAKEN, email, name, newPassword } = require('../auth/userFields');
const {
  escapeRegex,
  pageInfo,
  pageLimit,
  pageNumber,
  searchText,
  strictQuerySchema,
} = require('../queryParams');
const { validationError } = require('../validation');

const router = express.Router();

const { ROLES } = User;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const ROLE_MESSAGE = `Role must be one of: ${ROLES.join(', ')}`;

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'User not found' } };
const CANNOT_CHANGE_SELF = {
  error: {
    code: 'CANNOT_CHANGE_SELF',
    message: 'You cannot change your own role or deactivate your own account',
  },
};
const LAST_ADMIN = {
  error: {
    code: 'LAST_ADMIN',
    message: 'The last active admin cannot be demoted or deactivated',
  },
};
const USER_CONFLICT = {
  error: {
    code: 'USER_CONFLICT',
    message: 'The user was changed by someone else. Reload the list and try again.',
  },
};

// Sorting by name ignores case ("anna" next to "Anton"); _id keeps equal names stable
// across pages.
const NAME_COLLATION = { locale: 'en', strength: 2 };

// The only user fields admin routes return. Built field by field, so passwordHash (and
// anything added to the model later) never leaves the server by accident.
function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

const roleSchema = z.enum(ROLES, { error: ROLE_MESSAGE });

const listQuerySchema = strictQuerySchema({
  page: pageNumber,
  limit: pageLimit,
  role: roleSchema.optional(),
  isActive: z
    .enum(['true', 'false'], { error: 'isActive must be true or false' })
    .transform((value) => value === 'true')
    .optional(),
  q: searchText,
});

// Same rules as /auth/register, plus the role. Unknown keys (isActive, passwordHash, ...)
// are stripped: new accounts are always active.
const createUserSchema = z.object({
  name,
  email,
  password: newPassword,
  role: roleSchema,
});

const updateUserSchema = z
  .object({
    role: roleSchema.optional(),
    isActive: z.boolean({ error: 'isActive must be true or false' }).optional(),
  })
  .refine((data) => data.role !== undefined || data.isActive !== undefined, {
    error: 'Send role, isActive or both',
  });

router.use(authenticate);

// Active agents and admins, for the admin's assignee select. Only id and name leave the
// server (never email, role or passwordHash).
router.get('/agents', requireRole('agent', 'admin'), async (_request, response) => {
  const users = await User.find({ role: { $in: ['agent', 'admin'] }, isActive: true })
    .select('name')
    .sort({ name: 1, _id: 1 })
    .lean();

  return response.json({
    items: users.map((user) => ({ id: user._id.toString(), name: user.name })),
  });
});

router.get('/', requireRole('admin'), async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const query = parsed.data;
  // Every value is built here: the role comes from the fixed list, isActive is a boolean
  // and the search is an escaped literal, so no request value becomes an operator.
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.q) {
    const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .collation(NAME_COLLATION)
      .sort({ name: 1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return response.json({ items: users.map(serializeUser), ...pageInfo(query, total) });
});

router.post('/', requireRole('admin'), async (request, response) => {
  const parsed = createUserSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const { password, ...fields } = parsed.data;

  try {
    const user = await User.create({ ...fields, passwordHash: await hashPassword(password) });
    return response.status(201).json({ user: serializeUser(user) });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json(EMAIL_TAKEN);
    throw error;
  }
});

function isActiveAdmin(user) {
  return user.role === 'admin' && user.isActive;
}

// Change a user's role and/or active state. Safeguards (409): an admin cannot change their
// own account, and the last active admin can never be demoted or deactivated.
router.patch('/:id', requireRole('admin'), async (request, response) => {
  const parsed = updateUserSchema.safeParse(request.body ?? {});
  if (!parsed.success) return validationError(response, parsed.error);

  const { id } = request.params;
  if (!OBJECT_ID_PATTERN.test(id)) return response.status(404).json(NOT_FOUND);

  const target = await User.findById(id).lean();
  if (!target) return response.status(404).json(NOT_FOUND);

  if (id.toLowerCase() === request.user.id) return response.status(409).json(CANNOT_CHANGE_SELF);

  const changes = parsed.data;
  const before = { role: target.role, isActive: target.isActive };
  const after = { ...before, ...changes };

  // Only applies if nobody changed this user's role or active state since we read them,
  // so the checks above always describe the document that is written.
  const updated = await User.findOneAndUpdate(
    { _id: target._id, ...before },
    { $set: changes },
    { returnDocument: 'after', runValidators: true, lean: true },
  );
  if (!updated) return response.status(409).json(USER_CONFLICT);

  // The caller is an active admin and not the target, so outside a race there is always
  // another active admin. The race is two admins demoting or deactivating each other at
  // the same time: each write is checked against other documents only after it is made,
  // and a write that left no active admin is undone. Of two such requests at least one is
  // undone, so there is never a lasting state without an active admin.
  if (isActiveAdmin(before) && !isActiveAdmin(after)) {
    const activeAdmins = await User.countDocuments({ role: 'admin', isActive: true });
    if (activeAdmins === 0) {
      await User.findOneAndUpdate({ _id: target._id, ...after }, { $set: before });
      return response.status(409).json(LAST_ADMIN);
    }
  }

  return response.json({ user: serializeUser(updated) });
});

module.exports = router;
