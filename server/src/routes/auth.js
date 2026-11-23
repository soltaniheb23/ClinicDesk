const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const { hashPassword, verifyPassword } = require('../auth/password');
const { signToken } = require('../auth/token');

const router = express.Router();

const INVALID_CREDENTIALS = 'Invalid email or password';

const email = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.email({ error: 'Enter a valid email address' }).max(254, { error: 'Email is too long' }),
);

// bcrypt only uses the first 72 bytes of a password.
const passwordMaxBytes = (value) => Buffer.byteLength(value, 'utf8') <= 72;

const registerSchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(1, { error: 'Name is required' })
    .max(80, { error: 'Name must be at most 80 characters' }),
  email,
  password: z
    .string({ error: 'Password is required' })
    .min(8, { error: 'Password must be at least 8 characters' })
    .refine(passwordMaxBytes, { error: 'Password must be at most 72 bytes' }),
});

const loginSchema = z.object({
  email,
  password: z
    .string({ error: 'Password is required' })
    .min(1, { error: 'Password is required' })
    .refine(passwordMaxBytes, { error: 'Password must be at most 72 bytes' }),
});

function validationError(response, zodError) {
  return response.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Some fields are invalid',
      details: zodError.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    },
  });
}

router.post('/register', async (request, response) => {
  // Unknown keys such as "role" are stripped, so new accounts are always customers.
  const parsed = registerSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return validationError(response, parsed.error);
  }

  const { name, email: userEmail, password } = parsed.data;

  try {
    const user = await User.create({
      name,
      email: userEmail,
      passwordHash: await hashPassword(password),
      role: 'customer',
    });

    return response.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({
        error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' },
      });
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
    return response.status(401).json({
      error: { code: 'INVALID_CREDENTIALS', message: INVALID_CREDENTIALS },
    });
  }

  return response.json({ token: signToken(user), user });
});

module.exports = router;
