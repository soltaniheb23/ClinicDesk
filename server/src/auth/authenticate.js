const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};

function unauthenticated(response) {
  response.set('WWW-Authenticate', 'Bearer');
  return response.status(401).json(UNAUTHENTICATED);
}

function readBearerToken(request) {
  const header = request.get('authorization');
  if (!header) return null;

  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// Requires a valid "Authorization: Bearer <token>" for an active user and sets
// request.user = { id, role }. Missing, malformed, expired or wrongly signed tokens, and
// tokens for deactivated or deleted users, all get the same 401.
// The role is read from the database, not the token, so role changes and deactivation apply
// immediately, even to tokens issued earlier.
async function authenticate(request, response, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // A server misconfiguration, not the client's fault: let the error handler answer 500.
    throw new Error('JWT_SECRET is not set');
  }

  const token = readBearerToken(request);
  if (!token) return unauthenticated(response);

  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return unauthenticated(response);
  }

  if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
    return unauthenticated(response);
  }

  const user = await User.findById(payload.sub).select('role isActive').lean();
  if (!user || !user.isActive) return unauthenticated(response);

  request.user = { id: user._id.toString(), role: user.role };
  return next();
}

module.exports = { authenticate, unauthenticated };
