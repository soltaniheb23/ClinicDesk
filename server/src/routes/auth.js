const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const { hashPassword, verifyPassword } = require('../auth/password');
const { signToken } = require('../auth/token');
const { authenticate, unauthenticated } = require('../auth/authenticate');
const { EMAIL_TAKEN, email, loginPassword, name, newPassword } = require('../auth/userFields');
const { auditEmail, recordAudit } = require('../audit/record');
const { validationError } = require('../validation');

const router = express.Router();

const INVALID_CREDENTIALS = 'Invalid email or password';

const registerSchema = z.object({ name, email, password: newPassword });

const loginSchema = z.object({ email, password: loginPassword });

router.post('/register', async (request, response) => {
  // Unknown keys such as "role" are stripped, so new accounts are always customers.
  const parsed = registerSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const { name: userName, email: userEmail, password } = parsed.data;

  try {
    const user = await User.create({
      name: userName,
      email: userEmail,
      passwordHash: await hashPassword(password),
      role: 'customer',
    });

    return response.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json(EMAIL_TAKEN);
    }

    throw error;
  }
});

router.post('/login', async (request, response) => {
  const parsed = loginSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const { email: userEmail, password } = parsed.data;
  const user = await User.findOne({ email: userEmail }).select('+passwordHash');
  const passwordMatches = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordMatches || !user.isActive) {
    // Only the attempted email is kept: never the password, and not whether the account
    // exists or is deactivated (the answer is the same for all three).
    await recordAudit({
      action: 'auth.login_failed',
      entityType: 'user',
      metadata: { email: auditEmail(userEmail) },
    });
    return response.status(401).json({
      error: { code: 'INVALID_CREDENTIALS', message: INVALID_CREDENTIALS },
    });
  }

  const token = signToken(user);
  await recordAudit({
    actor: user._id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user._id,
  });
  return response.json({ token, user });
});

router.get('/me', authenticate, async (request, response) => {
  const user = await User.findById(request.user.id);

  // The user could be deleted between authenticate() and this lookup.
  if (!user) return unauthenticated(response);

  return response.json({ user });
});

module.exports = router;
