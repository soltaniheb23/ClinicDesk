import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Sentry release and environment tags (CD-25, docs/monitoring.md). On Vercel the build sees
// VERCEL_GIT_COMMIT_SHA and VERCEL_ENV; VITE_SENTRY_RELEASE and VITE_SENTRY_ENVIRONMENT
// override them. Without any of them the release is left out.
const sentryRelease = process.env.VITE_SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || '';
const sentryEnvironment = process.env.VITE_SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || '';

export default defineConfig({
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
});
