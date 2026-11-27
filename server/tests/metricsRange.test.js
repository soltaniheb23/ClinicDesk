// Pure metrics helpers (CD-23, docs/metrics.md).
const {
  DEFAULT_RANGE,
  RANGES,
  averageHours,
  hoursFromMs,
  rangeStart,
} = require('../src/metrics/range');

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-12-15T12:00:00.000Z');

describe('rangeStart', () => {
  it('knows the four ranges, 30d by default', () => {
    expect(RANGES).toEqual(['7d', '30d', '90d', 'all']);
    expect(DEFAULT_RANGE).toBe('30d');
  });

  it.each([
    ['7d', '2026-12-08T12:00:00.000Z'],
    ['30d', '2026-11-15T12:00:00.000Z'],
    ['90d', '2026-09-16T12:00:00.000Z'],
  ])('starts %s whole days before now', (range, expected) => {
    expect(rangeStart(range, NOW).toISOString()).toBe(expected);
  });

  it('has no start for "all" and refuses an unknown range', () => {
    expect(rangeStart('all', NOW)).toBeNull();
    expect(() => rangeStart('1y', NOW)).toThrow('Unknown metrics range "1y"');
  });
});

describe('hoursFromMs and averageHours', () => {
  it('rounds to one decimal', () => {
    expect(hoursFromMs(90 * 60 * 1000)).toBe(1.5);
    expect(hoursFromMs(HOUR + 3 * 60 * 1000)).toBe(1.1); // 1.05 h rounds up
    expect(hoursFromMs(HOUR + 2 * 60 * 1000)).toBe(1); // 1.033 h
    expect(hoursFromMs(0)).toBe(0);
  });

  it('gives null, never NaN or 0, for no data', () => {
    expect(averageHours(0, 0)).toBeNull();
    expect(averageHours(null, 0)).toBeNull();
    expect(averageHours(5 * HOUR, undefined)).toBeNull();
    expect(hoursFromMs(NaN)).toBeNull();
    expect(hoursFromMs(Infinity)).toBeNull();
    expect(hoursFromMs(null)).toBeNull();
  });

  it('averages the durations', () => {
    expect(averageHours(3 * HOUR + 2 * HOUR, 2)).toBe(2.5);
    expect(averageHours(10 * HOUR, 3)).toBe(3.3);
  });
});
