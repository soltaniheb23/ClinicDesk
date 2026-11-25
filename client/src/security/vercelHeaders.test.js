// Security headers for the deployed client (CD-24, docs/security-review.md). vercel.json is
// JSON and cannot hold comments, so the rules for it live here:
// - connect-src must list the API origin the production build talks to (VITE_API_URL on
//   Vercel). If the Render URL changes, update connect-src in vercel.json, or every API call
//   is blocked by the browser.
// - The build only loads its own files: fonts are self-hosted (@fontsource), there are no
//   inline scripts or styles, so 'unsafe-inline' and 'unsafe-eval' are never needed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The real Render service URL (VITE_API_URL on Vercel). When the Render service URL
// changes, change connect-src in client/vercel.json and this constant together.
const API_ORIGIN = 'https://clinicdesk-api-2uh0.onrender.com';

const vercel = JSON.parse(readFileSync(join(import.meta.dirname, '../../vercel.json'), 'utf8'));
const rule = vercel.headers.find((entry) => entry.source === '/(.*)');
const headers = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
const csp = Object.fromEntries(
  headers['Content-Security-Policy'].split(';').map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }),
);

describe('vercel.json security headers', () => {
  it('applies to every route and keeps the SPA rewrite', () => {
    expect(rule).toBeTruthy();
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('sets the basic headers', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(headers['Permissions-Policy']).toContain(`${feature}=()`);
    }
  });

  it('only allows the app itself to load scripts, styles, fonts and images', () => {
    for (const directive of ['default-src', 'script-src', 'style-src', 'font-src', 'img-src']) {
      expect(csp[directive]).toEqual(["'self'"]);
    }
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
  });

  it('lets the app call itself and the API origin, nothing else', () => {
    expect(csp['connect-src']).toEqual(["'self'", API_ORIGIN]);
  });

  it('allows no wildcard in connect-src (no "*", no scheme-only source)', () => {
    for (const source of csp['connect-src']) {
      expect(source).not.toContain('*');
      expect(source).not.toMatch(/^[a-z]+:$/);
    }
  });

  it('never uses wildcards, unsafe-inline, unsafe-eval or third-party font hosts', () => {
    const policy = headers['Content-Security-Policy'];
    expect(policy).not.toMatch(/\*|unsafe-inline|unsafe-eval|data:|fonts\.(googleapis|gstatic)/);
  });
});
