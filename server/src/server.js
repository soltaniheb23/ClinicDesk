require('dotenv').config();

// Error monitoring first, before Express and the routes are loaded (CD-25,
// docs/monitoring.md). Does nothing without SENTRY_DSN; an invalid one stops startup below.
require('./monitoring/sentry').initSentry(process.env);

const crypto = require('node:crypto');
const app = require('./app');
const { getStartupErrors } = require('./config');
const { connectDB } = require('./db');

const port = process.env.PORT || 3000;

async function start() {
  const errors = getStartupErrors(process.env);

  if (errors.length > 0) {
    errors.forEach((message) => console.error(`Startup error: ${message}`));
    process.exit(1);
  }

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn(
      'JWT_SECRET is not set; using a random secret. Tokens will stop working when the server restarts.',
    );
  }

  try {
    await connectDB(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error(`Startup error: could not connect to MongoDB (${error.message}).`);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`ClinicDesk API listening on port ${port}`);
  });
}

start();
