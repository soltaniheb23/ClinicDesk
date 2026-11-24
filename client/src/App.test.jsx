import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.pushState({}, '', '/health-check');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'Hello from ClinicDesk API' }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App health check page', () => {
  it('renders the ClinicDesk welcome heading', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'ClinicDesk' })).toBeTruthy();
    expect(await screen.findByText('Hello from ClinicDesk API')).toBeTruthy();
  });

  it('shows an error message when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    render(<App />);

    expect(await screen.findByText('Could not reach the ClinicDesk API.')).toBeTruthy();
  });
});

describe('App routing', () => {
  it('redirects / to the login page when logged out', async () => {
    window.history.pushState({}, '', '/');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
  });

  it('shows a not found page for unknown paths', () => {
    window.history.pushState({}, '', '/does-not-exist');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});
