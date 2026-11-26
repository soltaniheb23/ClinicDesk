const { PRIORITIES } = require('../src/models/Ticket');
const { SLA_POLICY, slaSnapshot } = require('../src/sla/policy');

describe('SLA_POLICY', () => {
  it('has first response and resolution targets for every priority', () => {
    expect(Object.keys(SLA_POLICY).sort()).toEqual([...PRIORITIES].sort());
    for (const priority of PRIORITIES) {
      const { firstResponseHours, resolutionHours } = SLA_POLICY[priority];
      expect(firstResponseHours).toBeGreaterThan(0);
      expect(resolutionHours).toBeGreaterThan(firstResponseHours);
    }
  });

  it('uses the documented targets (docs/sla.md)', () => {
    expect(SLA_POLICY).toEqual({
      urgent: { firstResponseHours: 1, resolutionHours: 4 },
      high: { firstResponseHours: 4, resolutionHours: 24 },
      normal: { firstResponseHours: 8, resolutionHours: 72 },
      low: { firstResponseHours: 24, resolutionHours: 120 },
    });
  });

  it('is frozen, including each priority', () => {
    expect(Object.isFrozen(SLA_POLICY)).toBe(true);
    for (const priority of PRIORITIES) expect(Object.isFrozen(SLA_POLICY[priority])).toBe(true);
  });

  it('gives stricter targets to more urgent priorities', () => {
    const ordered = ['low', 'normal', 'high', 'urgent'].map((priority) => SLA_POLICY[priority]);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index].firstResponseHours).toBeLessThan(ordered[index - 1].firstResponseHours);
      expect(ordered[index].resolutionHours).toBeLessThan(ordered[index - 1].resolutionHours);
    }
  });
});

describe('slaSnapshot', () => {
  const createdAt = new Date('2026-12-01T09:00:00.000Z');

  it.each([
    ['urgent', '2026-12-01T10:00:00.000Z', '2026-12-01T13:00:00.000Z'],
    ['high', '2026-12-01T13:00:00.000Z', '2026-12-02T09:00:00.000Z'],
    ['normal', '2026-12-01T17:00:00.000Z', '2026-12-04T09:00:00.000Z'],
    ['low', '2026-12-02T09:00:00.000Z', '2026-12-06T09:00:00.000Z'],
  ])('adds the %s targets to createdAt (calendar hours)', (priority, firstDue, resolutionDue) => {
    expect(slaSnapshot(priority, createdAt)).toEqual({
      slaFirstResponseDueAt: new Date(firstDue),
      slaResolutionDueAt: new Date(resolutionDue),
    });
  });

  it('uses the policy it is given, so a later change does not move stored dates', () => {
    const before = slaSnapshot('urgent', createdAt);
    const changed = { urgent: { firstResponseHours: 2, resolutionHours: 8 } };

    expect(slaSnapshot('urgent', createdAt, changed).slaFirstResponseDueAt).toEqual(
      new Date('2026-12-01T11:00:00.000Z'),
    );
    expect(before.slaFirstResponseDueAt).toEqual(new Date('2026-12-01T10:00:00.000Z'));
  });
});
