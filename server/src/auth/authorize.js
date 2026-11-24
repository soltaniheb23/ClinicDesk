const { unauthenticated } = require('./authenticate');

const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};

// Use after authenticate(): lets the request through only for the given roles.
function requireRole(...roles) {
  if (roles.length === 0) {
    throw new Error('requireRole needs at least one role');
  }

  return function checkRole(request, response, next) {
    if (!request.user) {
      // authenticate() did not run; refuse rather than guess.
      return unauthenticated(response);
    }

    if (!roles.includes(request.user.role)) {
      return response.status(403).json(FORBIDDEN);
    }

    return next();
  };
}

// Agents and admins can access any resource; a customer only their own.
// ownerId may be a string or an ObjectId.
function canAccessOwnedResource(user, ownerId) {
  if (!user) return false;
  if (user.role === 'agent' || user.role === 'admin') return true;
  if (user.role !== 'customer' || ownerId == null || !user.id) return false;
  return String(ownerId) === String(user.id);
}

module.exports = { requireRole, canAccessOwnedResource };
