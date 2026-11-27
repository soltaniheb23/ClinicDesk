// Error monitoring in the browser (CD-25, docs/monitoring.md). The Sentry SDK is never
// initialised for real here: init is skipped without a DSN, and the tests that need it pass
// a mocked SDK, so nothing is sent over the network.
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import { scrubBreadcrumb, scrubEvent } from './scrub.js';
import { initMonitoring, sentryOptions } from './sentry.js';

// A made-up DSN in Sentry's format; never contacted.
const DSN = 'https://publickey@o0.ingest.de.sentry.io/0';

function mockSdk() {
  return { init: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initMonitoring', () => {
  it('is skipped without VITE_SENTRY_DSN', () => {
    const sdk = mockSdk();

    expect(initMonitoring({ env: { MODE: 'production' }, sdk })).toBe(false);
    expect(initMonitoring({ env: { MODE: 'production', VITE_SENTRY_DSN: ' ' }, sdk })).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('is skipped in this test run with the real import.meta.env and SDK', () => {
    expect(initMonitoring()).toBe(false);
  });

  it('is skipped in a test run without a mocked SDK, even with a DSN', () => {
    expect(initMonitoring({ env: { MODE: 'test', VITE_SENTRY_DSN: DSN } })).toBe(false);
  });

  it('is skipped with a warning for a DSN that is not https', () => {
    const sdk = mockSdk();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      initMonitoring({ env: { VITE_SENTRY_DSN: 'http://key@o0.ingest.sentry.io/0' }, sdk }),
    ).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not an https URL'));
  });

  it('initialises with no default PII, the scrubbers and the release and environment tags', () => {
    const sdk = mockSdk();
    const env = {
      MODE: 'production',
      VITE_SENTRY_DSN: DSN,
      VITE_SENTRY_RELEASE: '3f2c1ab',
      VITE_SENTRY_ENVIRONMENT: 'preview',
    };

    expect(initMonitoring({ env, sdk })).toBe(true);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    const options = sdk.init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: DSN,
      release: '3f2c1ab',
      environment: 'preview',
      sampleRate: 1,
      sendDefaultPii: false,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
    });
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.integrations).toBeUndefined();
  });

  it('omits the release when the build has no commit SHA', () => {
    const options = sentryOptions({ MODE: 'production', VITE_SENTRY_RELEASE: '' }, DSN);
    expect(options).not.toHaveProperty('release');
    expect(options.environment).toBe('production');
  });
});

describe('scrubEvent', () => {
  it('removes bodies, cookies, query strings, the Authorization header and user data', () => {
    const scrubbed = scrubEvent({
      message: 'Could not save ticket for mara@example.com',
      request: {
        url: 'https://clinicdesk.vercel.app/tickets?q=printer#c1',
        query_string: 'q=printer',
        data: '{"password":"a-long-password"}',
        cookies: { a: 'b' },
        headers: { Authorization: 'Bearer abc', 'User-Agent': 'jsdom' },
      },
      user: { id: 'u1', email: 'mara@example.com', username: 'Mara' },
      extra: {
        form: { title: 'Printer', description: 'Room 3', password: 'x', priority: 'high' },
        session: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln' },
      },
    });

    expect(scrubbed).toEqual({
      message: 'Could not save ticket for [email]',
      request: {
        url: 'https://clinicdesk.vercel.app/tickets',
        headers: { 'User-Agent': 'jsdom' },
      },
      user: { id: 'u1' },
      extra: { form: { priority: 'high' }, session: {} },
    });
  });

  it('replaces tokens inside free text and passes non-objects through', () => {
    expect(scrubEvent({ message: 'header Bearer abc.def and eyJa.eyJb.sig' }).message).toBe(
      'header Bearer [Filtered] and [Filtered]',
    );
    expect(scrubEvent(null)).toBeNull();
  });
});

describe('scrubBreadcrumb', () => {
  it('cuts query strings off fetch and navigation URLs', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: { url: '/api/v1/tickets?q=mara@example.com', method: 'GET', status_code: 500 },
      }),
    ).toEqual({
      category: 'fetch',
      data: { url: '/api/v1/tickets', method: 'GET', status_code: 500 },
    });
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/login?next=x', to: '/tickets?q=y' },
      }),
    ).toEqual({ category: 'navigation', data: { from: '/login', to: '/tickets' } });
  });

  it('drops UI input breadcrumbs and scrubs console messages', () => {
    expect(scrubBreadcrumb({ category: 'ui.input', message: 'input[name="email"]' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'console', message: 'login mara@example.com' })).toEqual({
      category: 'console',
      message: 'login [email]',
    });
    expect(scrubBreadcrumb(undefined)).toBeUndefined();
  });
});

describe('AppErrorBoundary', () => {
  function Broken() {
    throw new Error('render failed');
  }

  it('renders the app while nothing fails', () => {
    render(
      <AppErrorBoundary>
        <p>ClinicDesk</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('ClinicDesk')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the fallback message and reloads the page from the button', () => {
    // React logs the caught error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();

    render(
      <AppErrorBoundary onReload={reload}>
        <Broken />
      </AppErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    expect(alert.textContent).not.toContain('render failed');

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
