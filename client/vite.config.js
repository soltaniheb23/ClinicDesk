import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Sentry release and environment tags (CD-25, docs/monitoring.md). VITE_SENTRY_RELEASE and
  // VITE_SENTRY_ENVIRONMENT (from the shell or a .env file) win; otherwise Vercel's
  // VERCEL_GIT_COMMIT_SHA and VERCEL_ENV are used. Without any of them the release is left out.
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const sentryRelease = env.VITE_SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || '';
  const sentryEnvironment = env.VITE_SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || '';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(sentryRelease),
      'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(sentryEnvironment),
    },
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
    },
  };
});
