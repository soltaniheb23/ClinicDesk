import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SlaBadge } from './Badges.jsx';
import { formatLocaleDateTime } from './format.js';

const DUE = '2026-12-01T10:00:00.000Z';

afterEach(cleanup);

describe('SlaBadge', () => {
  it.each([
    ['ok', 'On track', 'first_response', 'First response due'],
    ['at_risk', 'Due soon', 'first_response', 'First response due'],
    ['breached', 'Breached', 'resolution', 'Resolution was due'],
    ['met', 'Met', 'resolution', 'Resolution due'],
  ])('shows %s as the text "%s" with the due time', (state, label, kind, prefix) => {
    const { container } = render(<SlaBadge sla={{ state, kind, dueAt: DUE }} locale="en-GB" />);

    const badge = container.querySelector('.badge');
    expect(badge.className).toBe(`badge badge-sla-${state}`);
    expect(badge.textContent).toBe(`SLA: ${label}`);

    const time = container.querySelector('time');
    expect(time.getAttribute('dateTime')).toBe(DUE);
    expect(time.textContent).toBe(`${prefix} ${formatLocaleDateTime(DUE, 'en-GB')}`);
  });

  it('formats the due time in the given locale', () => {
    render(<SlaBadge sla={{ state: 'ok', kind: 'resolution', dueAt: DUE }} locale="de-DE" />);

    const expected = new Date(DUE).toLocaleString('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(screen.getByText(`Resolution due ${expected}`)).toBeTruthy();
  });

  it('renders nothing without an SLA (old ticket) or without an sla object (customer)', () => {
    const { container: legacy } = render(
      <SlaBadge sla={{ state: null, dueAt: null, kind: null }} />,
    );
    const { container: missing } = render(<SlaBadge sla={undefined} />);

    expect(legacy.innerHTML).toBe('');
    expect(missing.innerHTML).toBe('');
  });
});
