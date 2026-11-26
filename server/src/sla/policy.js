// SLA targets per ticket priority, in calendar hours (docs/sla.md).
//
// The targets live in code, not in env vars: changing them is a reviewed commit, and there
// is no second place that could disagree with this one. A ticket stores its own due dates
// when it is created (slaSnapshot), so changing a target here never changes existing tickets.
const { PRIORITIES } = require('../models/Ticket');

const HOUR_MS = 60 * 60 * 1000;

const SLA_POLICY = Object.freeze({
  urgent: Object.freeze({ firstResponseHours: 1, resolutionHours: 4 }),
  high: Object.freeze({ firstResponseHours: 4, resolutionHours: 24 }),
  normal: Object.freeze({ firstResponseHours: 8, resolutionHours: 72 }),
  low: Object.freeze({ firstResponseHours: 24, resolutionHours: 120 }),
});

// Fails at require time (so at startup and in every test run) if a priority has no target.
for (const priority of PRIORITIES) {
  if (!Object.hasOwn(SLA_POLICY, priority)) {
    throw new Error(`SLA_POLICY has no targets for priority "${priority}"`);
  }
}

// The due dates stored on a new ticket: createdAt + the targets for its priority.
function slaSnapshot(priority, createdAt, policy = SLA_POLICY) {
  const targets = policy[priority];
  const start = createdAt.getTime();
  return {
    slaFirstResponseDueAt: new Date(start + targets.firstResponseHours * HOUR_MS),
    slaResolutionDueAt: new Date(start + targets.resolutionHours * HOUR_MS),
  };
}

module.exports = { SLA_POLICY, HOUR_MS, slaSnapshot };
