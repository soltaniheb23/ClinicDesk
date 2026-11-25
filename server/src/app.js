const express = require('express');
const auditLogsRouter = require('./routes/auditLogs');
const authRouter = require('./routes/auth');
const ticketsRouter = require('./routes/tickets');
const usersRouter = require('./routes/users');

const app = express();
const clientOrigin = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');

app.use((request, response, next) => {
  if (clientOrigin && request.get('origin') === clientOrigin) {
    response.set('Access-Control-Allow-Origin', clientOrigin);
    response.vary('Origin');

    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return response.sendStatus(204);
    }
  }

  next();
});

// Room for a 5000-character ticket description in multi-byte scripts (up to 4 bytes each).
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/v1/hello', (_request, response) => {
  response.json({ message: 'Hello from ClinicDesk API' });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/tickets', ticketsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/audit-logs', auditLogsRouter);

// eslint-disable-next-line no-unused-vars
app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
    });
  }

  if (error.type === 'entity.too.large') {
    return response.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
  }

  console.error(error);
  return response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
});

module.exports = app;
