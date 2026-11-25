// Field rules shared by POST /auth/register, POST /auth/login and POST /users, so an
// account created by an admin follows exactly the same rules as a self-registered one.
const { z } = require('zod');

// bcrypt only uses the first 72 bytes of a password.
const passwordMaxBytes = (value) => Buffer.byteLength(value, 'utf8') <= 72;

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, { error: 'Name is required' })
  .max(80, { error: 'Name must be at most 80 characters' });

const email = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.email({ error: 'Enter a valid email address' }).max(254, { error: 'Email is too long' }),
);

// A password for a new account.
const newPassword = z
  .string({ error: 'Password is required' })
  .min(8, { error: 'Password must be at least 8 characters' })
  .refine(passwordMaxBytes, { error: 'Password must be at most 72 bytes' });

// A password typed at login: any non-empty value that bcrypt can compare.
const loginPassword = z
  .string({ error: 'Password is required' })
  .min(1, { error: 'Password is required' })
  .refine(passwordMaxBytes, { error: 'Password must be at most 72 bytes' });

// The 409 for a duplicate email (MongoDB error 11000 on the unique email index).
const EMAIL_TAKEN = Object.freeze({
  error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' },
});

module.exports = { name, email, newPassword, loginPassword, EMAIL_TAKEN };
