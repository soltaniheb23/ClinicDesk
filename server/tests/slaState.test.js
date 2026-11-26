const { getSlaState } = require('../src/sla/state');

// A "normal" ticket: first response due after 8h, resolution after 72h.
const CREATED = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const FIRST_DUE = new Date(CREATED + 8 * HOUR);
const RESOLUTION_DUE = new Date(CREATED + 72 * HOUR);

function ticket(fields = {}) {
  return {
    createdAt: new Date(CREATED),
    slaFirstResponseDueAt: FIRST_DUE,
    slaResolutionDueAt: RESOLUTION_DUE,
    firstResponseAt: null,
    resolvedAt: null,
    ...fields,
  };
}

// The injected clock: hours after createdAt.
const at = (hours) => new Date(CREATED + hours * HOUR);

describe('getSlaState: no SLA', () => {
  it('returns state null for a ticket created before CD-22 (no due dates)', () => {
    const legacy = { createdAt: new Date(CREATED), firstResponseAt: null, resolvedAt: null };
    expect(getSlaState(legacy, at(1))).toEqual({ state: null, dueAt: null, kind: null });
  });

  it('returns state null when only one due date is stored', () => {
    expect(getSlaState(ticket({ slaResolutionDueAt: undefined }), at(1)).state).toBeNull();
  });
});

describe('getSlaState: first response timer', () => {
  it('is ok before 75% of the time has passed', () => {
    expect(getSlaState(ticket(), at(5.9))).toEqual({
      state: 'ok',
      kind: 'first_response',
      dueAt: FIRST_DUE,
    });
  });

  it('is at_risk from exactly 75% of the time (6h of 8h)', () => {
    expect(getSlaState(ticket(), at(6)).state).toBe('at_risk');
    expect(getSlaState(ticket(), at(8)).state).toBe('at_risk');
  });

  it('is breached after the due date', () => {
    expect(getSlaState(ticket(), new Date(FIRST_DUE.getTime() + 1))).toEqual({
      state: 'breached',
      kind: 'first_response',
      dueAt: FIRST_DUE,
    });
  });

  it('does not depend on the real clock', () => {
    jest.useFakeTimers({ now: CREATED + 1000 * HOUR });
    try {
      expect(getSlaState(ticket(), at(1)).state).toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('getSlaState: resolution timer', () => {
  const answered = ticket({ firstResponseAt: at(2) });

  it('switches to the resolution timer after the first response', () => {
    expect(getSlaState(answered, at(10))).toEqual({
      state: 'ok',
      kind: 'resolution',
      dueAt: RESOLUTION_DUE,
    });
  });

  it('is at_risk from 75% of the resolution time (54h of 72h)', () => {
    expect(getSlaState(answered, at(53.9)).state).toBe('ok');
    expect(getSlaState(answered, at(54)).state).toBe('at_risk');
  });

  it('is breached after the resolution due date', () => {
    expect(getSlaState(answered, at(73))).toMatchObject({ state: 'breached', kind: 'resolution' });
  });

  it('keeps a late first response breached', () => {
    const late = ticket({ firstResponseAt: at(9) });
    expect(getSlaState(late, at(10))).toEqual({
      state: 'breached',
      kind: 'first_response',
      dueAt: FIRST_DUE,
    });
    expect(getSlaState({ ...late, resolvedAt: at(20) }, at(30)).state).toBe('breached');
  });

  it('counts a response exactly at the due date as on time', () => {
    expect(getSlaState(ticket({ firstResponseAt: FIRST_DUE }), at(10)).kind).toBe('resolution');
  });
});

describe('getSlaState: met', () => {
  it('is met when both targets were met, at any later time', () => {
    const done = ticket({ firstResponseAt: at(2), resolvedAt: at(30) });
    expect(getSlaState(done, at(31))).toEqual({
      state: 'met',
      kind: 'resolution',
      dueAt: RESOLUTION_DUE,
    });
    expect(getSlaState(done, at(10000)).state).toBe('met');
  });

  it('is breached when resolved after the resolution due date', () => {
    const late = ticket({ firstResponseAt: at(2), resolvedAt: at(80) });
    expect(getSlaState(late, at(81))).toMatchObject({ state: 'breached', kind: 'resolution' });
  });

  it('treats a ticket resolved without a public reply as answered at resolvedAt', () => {
    expect(getSlaState(ticket({ resolvedAt: at(3) }), at(4)).state).toBe('met');
    expect(getSlaState(ticket({ resolvedAt: at(9) }), at(10))).toMatchObject({
      state: 'breached',
      kind: 'first_response',
    });
  });

  it('runs the resolution timer again after a reopen (resolvedAt cleared)', () => {
    const reopened = ticket({ firstResponseAt: at(2), resolvedAt: null });
    expect(getSlaState(reopened, at(60))).toMatchObject({ state: 'at_risk', kind: 'resolution' });
  });

  it('accepts ISO strings as well as dates', () => {
    const fromJson = JSON.parse(JSON.stringify(ticket({ firstResponseAt: at(2) })));
    expect(getSlaState(fromJson, at(10)).state).toBe('ok');
  });
});
