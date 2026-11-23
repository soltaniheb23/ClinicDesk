const { getStartupErrors } = require('../src/config');

describe('getStartupErrors', () => {
  it('requires MONGODB_URI', () => {
    expect(getStartupErrors({ JWT_SECRET: 'x' })).toEqual([
      expect.stringContaining('MONGODB_URI is not set'),
    ]);
  });

  it('refuses to start in production without JWT_SECRET', () => {
    expect(getStartupErrors({ MONGODB_URI: 'mongodb://db', NODE_ENV: 'production' })).toEqual([
      expect.stringContaining('JWT_SECRET is not set'),
    ]);
  });

  it('allows a missing JWT_SECRET outside production', () => {
    expect(getStartupErrors({ MONGODB_URI: 'mongodb://db', NODE_ENV: 'development' })).toEqual([]);
  });

  it('passes with all required variables in production', () => {
    expect(
      getStartupErrors({ MONGODB_URI: 'mongodb://db', JWT_SECRET: 'x', NODE_ENV: 'production' }),
    ).toEqual([]);
  });
});
