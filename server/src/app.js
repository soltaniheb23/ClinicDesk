const express = require('express');

const app = express();
const clientOrigin = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '');

app.use((request, response, next) => {
  if (clientOrigin && request.get('origin') === clientOrigin) {
    response.set('Access-Control-Allow-Origin', clientOrigin);
    response.vary('Origin');

    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type');
      return response.sendStatus(204);
    }
  }

  next();
});

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/v1/hello', (_request, response) => {
  response.json({ message: 'Hello from ClinicDesk API' });
});

module.exports = app;
