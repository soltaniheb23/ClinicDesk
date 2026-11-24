// Ticket status workflow: a pure module (no database code) so routes, tests and the audit
// log (CD-20) share one source of truth. See docs/status-workflow.md.
//
// open -> in_progress -> waiting <-> in_progress -> resolved -> closed
//                                     resolved -> in_progress (reopen)

const STATUSES = Object.freeze(['open', 'in_progress', 'waiting', 'resolved', 'closed']);

// Every transition the workflow allows (for agents and admins).
const TRANSITIONS = Object.freeze({
  open: Object.freeze(['in_progress']),
  in_progress: Object.freeze(['waiting', 'resolved']),
  waiting: Object.freeze(['in_progress', 'resolved']),
  resolved: Object.freeze(['closed', 'in_progress']),
  closed: Object.freeze([]), // final
});

// The subset a customer may perform. Ownership of the ticket is checked by the route.
const CUSTOMER_TRANSITIONS = Object.freeze({
  resolved: Object.freeze(['closed']),
});

const STAFF_ROLES = new Set(['agent', 'admin']);

function isWorkflowTransition(currentStatus, nextStatus) {
  return (TRANSITIONS[currentStatus] ?? []).includes(nextStatus);
}

// The statuses this role may move a ticket to from currentStatus, in workflow order.
function allowedNextStatuses(currentStatus, role) {
  if (STAFF_ROLES.has(role)) return [...(TRANSITIONS[currentStatus] ?? [])];
  if (role === 'customer') return [...(CUSTOMER_TRANSITIONS[currentStatus] ?? [])];
  return [];
}

function canTransition(currentStatus, nextStatus, role) {
  return allowedNextStatuses(currentStatus, role).includes(nextStatus);
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  CUSTOMER_TRANSITIONS,
  isWorkflowTransition,
  allowedNextStatuses,
  canTransition,
};
