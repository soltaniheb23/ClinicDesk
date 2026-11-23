import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

beforeEach(() => {
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

describe('App', () => {
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