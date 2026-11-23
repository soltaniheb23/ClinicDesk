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

    expect(response.headers['access-control-allow-origin']).toBe(
      'https://clinicdesk.vercel.app',
    );
  });

  it('does not allow other frontend origins', async () => {
    const response = await request(app)
      .get('/api/v1/hello')
      .set('Origin', 'https://untrusted.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
