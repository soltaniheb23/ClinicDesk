const request = require('supertest');
process.env.CLIENT_ORIGIN = 'https://clinicdesk.vercel.app';
const app = require('../src/app');

describe('GET /health', () => {
  it('returns an ok status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/v1/hello', () => {
  it('returns a greeting for the frontend', async () => {
    const response = await request(app).get('/api/v1/hello');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Hello from ClinicDesk API' });
  });

  it('allows the configured frontend origin', async () => {
    const response = await request(app)
      .get('/api/v1/hello')
      .set('Origin', 'https://clinicdesk.vercel.app');

    expect(response.headers['access-control-allow-origin']).toBe('https://clinicdesk.vercel.app');
  });

  it('does not allow other frontend origins', async () => {
    const response = await request(app)
      .get('/api/v1/hello')
      .set('Origin', 'https://untrusted.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS preflight', () => {
  it('allows the methods and headers the frontend needs for the configured origin', async () => {
    const response = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://clinicdesk.vercel.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://clinicdesk.vercel.app');
    expect(response.headers['access-control-allow-methods']).toBe(
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
    expect(response.headers.vary).toMatch(/Origin/);
  });

  it('does not allow a preflight from other origins', async () => {
    const response = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
  });
});

describe('POST /api/v1/auth/login CORS', () => {
  it('returns the allowed origin header for the configured frontend', async () => {
    // An empty body fails validation before any database lookup, so no DB is needed here.
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://clinicdesk.vercel.app')
      .send({});

    expect(response.status).toBe(400);
    expect(response.headers['access-control-allow-origin']).toBe('https://clinicdesk.vercel.app');
  });
});
