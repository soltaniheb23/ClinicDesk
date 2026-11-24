import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import EmptyState from './EmptyState.jsx';
import ErrorMessage from './ErrorMessage.jsx';
import Loading from './Loading.jsx';

afterEach(() => {
  cleanup();
});

describe('shared state components', () => {
  it('Loading renders a status with its label', () => {
    render(<Loading label="Loading tickets..." />);

    expect(screen.getByRole('status').textContent).toContain('Loading tickets...');
  });

  it('EmptyState renders a title, message and optional action', () => {
    render(
      <EmptyState
        title="No tickets yet"
        message="Tickets you create will appear here."
        action={<button type="button">New ticket</button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No tickets yet' })).toBeTruthy();
    expect(screen.getByText('Tickets you create will appear here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New ticket' })).toBeTruthy();
  });

  it('EmptyState works without an action', () => {
    render(<EmptyState title="Nothing here" message="Try another filter." />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ErrorMessage renders an alert', () => {
    render(<ErrorMessage message="Could not load tickets." />);

    expect(screen.getByRole('alert').textContent).toContain('Could not load tickets.');
  });
});
