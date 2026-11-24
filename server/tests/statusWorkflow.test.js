const {
  STATUSES,
  TRANSITIONS,
  allowedNextStatuses,
  canTransition,
  isWorkflowTransition,
} = require('../src/tickets/statusWorkflow');
const Ticket = require('../src/models/Ticket');

const ALLOWED = [
  ['open', 'in_progress'],
  ['in_progress', 'waiting'],
  ['in_progress', 'resolved'],
  ['waiting', 'in_progress'],
  ['waiting', 'resolved'],
  ['resolved', 'closed'],
  ['resolved', 'in_progress'],
];
const allPairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to]));
const isAllowed = ([from, to]) => ALLOWED.some(([a, b]) => a === from && b === to);

describe('statusWorkflow', () => {
  it('uses the same statuses as the Ticket model', () => {
    expect(Ticket.STATUSES).toEqual(STATUSES);
    expect(Object.keys(TRANSITIONS)).toEqual(STATUSES);
  });

  it.each(allPairs)('%s -> %s matches the agreed workflow', (from, to) => {
    expect(isWorkflowTransition(from, to)).toBe(isAllowed([from, to]));
  });

  it.each(['agent', 'admin'])('lets an %s perform every workflow transition', (role) => {
    for (const [from, to] of allPairs) {
      expect(canTransition(from, to, role)).toBe(isAllowed([from, to]));
    }
  });

  it('lets a customer only close a resolved ticket', () => {
    for (const [from, to] of allPairs) {
      expect(canTransition(from, to, 'customer')).toBe(from === 'resolved' && to === 'closed');
    }
  });

  it('lists allowed next statuses per role', () => {
    expect(allowedNextStatuses('resolved', 'agent')).toEqual(['closed', 'in_progress']);
    expect(allowedNextStatuses('resolved', 'customer')).toEqual(['closed']);
    expect(allowedNextStatuses('open', 'customer')).toEqual([]);
    expect(allowedNextStatuses('closed', 'admin')).toEqual([]);
  });

  it('allows nothing for unknown roles or statuses', () => {
    expect(allowedNextStatuses('open', 'guest')).toEqual([]);
    expect(allowedNextStatuses('archived', 'admin')).toEqual([]);
    expect(canTransition('open', 'in_progress', undefined)).toBe(false);
  });

  it('cannot be changed by callers', () => {
    allowedNextStatuses('open', 'agent').push('closed');
    expect(allowedNextStatuses('open', 'agent')).toEqual(['in_progress']);
    expect(Object.isFrozen(TRANSITIONS.open)).toBe(true);
  });
});
