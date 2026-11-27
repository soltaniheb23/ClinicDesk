// Metrics formatting (CD-23).
import { describe, expect, it } from 'vitest';
import { formatHours, rangeFromSearch, rangeLabel } from './format.js';

describe('formatHours', () => {
  it.each([
    [0, '0 h', '0 hours'],
    [0.5, '0.5 h', '0.5 hours'],
    [1, '1 h', '1 hour'],
    [5.5, '5.5 h', '5.5 hours'],
    [47.9, '47.9 h', '47.9 hours'],
    [48, '48 h', '48 hours'],
  ])('shows %s hours as hours', (hours, short, long) => {
    expect(formatHours(hours)).toEqual({ short, long });
  });

  it.each([
    [48.1, '2 d', '2 days'],
    [49, '2 d 1 h', '2 days 1 hour'],
    [76, '3 d 4 h', '3 days 4 hours'],
    [76.4, '3 d 4 h', '3 days 4 hours'],
    [95.6, '4 d', '4 days'],
    [120, '5 d', '5 days'],
    [745.2, '31 d 1 h', '31 days 1 hour'],
  ])('shows %s hours as days and hours above 48 hours', (hours, short, long) => {
    expect(formatHours(hours)).toEqual({ short, long });
  });

  it.each([null, undefined, NaN, Infinity, -1, '5'])('gives null for %s', (value) => {
    expect(formatHours(value)).toBeNull();
  });
});

describe('range in the URL', () => {
  it('reads a known range and falls back to 30 days', () => {
    expect(rangeFromSearch(new URLSearchParams('range=7d'))).toBe('7d');
    expect(rangeFromSearch(new URLSearchParams('range=all'))).toBe('all');
    expect(rangeFromSearch(new URLSearchParams('range=1y'))).toBe('30d');
    expect(rangeFromSearch(new URLSearchParams(''))).toBe('30d');
    expect(rangeLabel('90d')).toBe('90 days');
  });
});
