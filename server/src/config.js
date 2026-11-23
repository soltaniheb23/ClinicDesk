// Returns a list of problems that must stop the server from starting.
function getStartupErrors(env) {
  const errors = [];

  if (!env.MONGODB_URI) {
    errors.push(
      'MONGODB_URI is not set. Add your MongoDB connection string to server/.env (see .env.example).',
    );
  }

  if (!env.JWT_SECRET && env.NODE_ENV === 'production') {
    errors.push('JWT_SECRET is not set. The server refuses to start in production without it.');
  }

  return errors;
}

module.exports = { getStartupErrors };
