// SLA state of one ticket (docs/sla.md): a pure function of the ticket and the time, so the
// API, the list filter tests and the unit tests share one definition. `now` is passed in;
// nothing here reads the clock.
//
// Timers, from the snapshot stored at creation (slaFirstResponseDueAt, slaResolutionDueAt):
// - first_response runs until the first public staff reply (firstResponseAt). A ticket that
//   is resolved without one counts as answered at resolvedAt.
// - resolution runs after that until resolvedAt is set (resolved or closed). Reopening
//   clears resolvedAt, so the resolution timer runs again against the same due date.
// A missed target stays breached: a late first response is never shown as "on track" again.

const STATES = Object.freeze(['ok', 'at_risk', 'breached', 'met']);
// The filter values GET /tickets accepts (?sla=...): the states that need action.
const FILTER_STATES = Object.freeze(['breached', 'at_risk']);
// At risk once this share of the time between createdAt and the due date has passed.
const AT_RISK_RATIO = 0.75;

const NO_SLA = Object.freeze({ state: null, dueAt: null, kind: null });

function time(value) {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function result(state, kind, dueMs) {
  return { state, kind, dueAt: new Date(dueMs) };
}

function runningState(kind, createdMs, dueMs, nowMs) {
  if (nowMs > dueMs) return result('breached', kind, dueMs);
  if (nowMs - createdMs >= AT_RISK_RATIO * (dueMs - createdMs)) {
    return result('at_risk', kind, dueMs);
  }
  return result('ok', kind, dueMs);
}

// Returns { state, dueAt, kind }: state is ok, at_risk, breached, met or null (no SLA, for
// tickets created before CD-22); kind is first_response or resolution; dueAt is a Date.
function getSlaState(ticket, now) {
  const createdMs = time(ticket.createdAt);
  const firstDueMs = time(ticket.slaFirstResponseDueAt);
  const resolutionDueMs = time(ticket.slaResolutionDueAt);
  if (createdMs === null || firstDueMs === null || resolutionDueMs === null) return { ...NO_SLA };

  const nowMs = time(now);
  const resolvedMs = time(ticket.resolvedAt);
  const respondedMs = time(ticket.firstResponseAt) ?? resolvedMs;

  if (respondedMs === null) {
    return runningState('first_response', createdMs, firstDueMs, nowMs);
  }
  if (respondedMs > firstDueMs) return result('breached', 'first_response', firstDueMs);

  if (resolvedMs !== null) {
    return result(resolvedMs > resolutionDueMs ? 'breached' : 'met', 'resolution', resolutionDueMs);
  }
  return runningState('resolution', createdMs, resolutionDueMs, nowMs);
}

module.exports = { STATES, FILTER_STATES, AT_RISK_RATIO, getSlaState };
