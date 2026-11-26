// The ?sla= filter (src/sla/query.js) must select exactly the tickets that getSlaState
// (src/sla/state.js) puts in that state. Both run here on the same tickets and clock.
const os = require('node:os');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Ticket = require('../src/models/Ticket');
const { HOUR_MS } = require('../src/sla/policy');
const { slaFilterExpression } = require('../src/sla/query');
const { FILTER_STATES, getSlaState } = require('../src/sla/state');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { runtimeAdapters: { os } });
  await Ticket.init();
}, 120000);

afterAll(async () => {
  await Ticket.deleteMany({});
  await mongoose.disconnect();
  await mongoServer.stop();
});

const NOW = new Date('2026-12-10T12:00:00.000Z');
const at = (hours) => new Date(NOW.getTime() + hours * HOUR_MS);

// Every combination of age, first response (none, on time, late, exactly on the due date)
// and resolution (none, on time, late), on a ticket with an 8h / 72h SLA. Boundaries are
// included: exactly 75% of the time used, exactly the due date.
function cases() {
  const owner = new mongoose.Types.ObjectId();
  const rows = [];
  for (const ageHours of [0, 1, 5.99, 6, 7, 8, 8.01, 30, 54, 60, 72, 73, 200]) {
    const createdAt = at(-ageHours);
    const firstDue = new Date(createdAt.getTime() + 8 * HOUR_MS);
    const resolutionDue = new Date(createdAt.getTime() + 72 * HOUR_MS);
    const responses = [null, at(-ageHours + 1), firstDue, at(-ageHours + 9)].filter(
      (value) => value === null || value <= NOW,
    );
    for (const firstResponseAt of responses) {
      const resolutions = [null, at(-ageHours + 2), resolutionDue, at(-ageHours + 80)].filter(
        (value) => value === null || value <= NOW,
      );
      for (const resolvedAt of resolutions) {
        rows.push({
          title: `case ${rows.length}`,
          description: 'SLA case',
          createdBy: owner,
          createdAt,
          slaFirstResponseDueAt: firstDue,
          slaResolutionDueAt: resolutionDue,
          firstResponseAt,
          resolvedAt,
        });
      }
    }
  }
  rows.push({ title: 'legacy', description: 'No SLA', createdBy: owner, createdAt: at(-500) });
  return rows;
}

describe('slaFilterExpression', () => {
  beforeAll(async () => {
    await Ticket.insertMany(cases());
  });

  it('covers every state in the fixtures', async () => {
    const all = await Ticket.find({}).lean();
    const states = new Set(all.map((ticket) => getSlaState(ticket, NOW).state));
    expect([...states].sort()).toEqual(['at_risk', 'breached', 'met', 'ok', null].sort());
  });

  it.each(FILTER_STATES)('selects exactly the %s tickets', async (state) => {
    const all = await Ticket.find({}).lean();
    const expected = all
      .filter((ticket) => getSlaState(ticket, NOW).state === state)
      .map((ticket) => ticket.title)
      .sort();

    const matched = await Ticket.find({ $expr: slaFilterExpression(state, NOW) }).lean();
    const aggregated = await Ticket.aggregate([
      { $match: { $expr: slaFilterExpression(state, NOW) } },
    ]);

    expect(expected.length).toBeGreaterThan(0);
    expect(matched.map((ticket) => ticket.title).sort()).toEqual(expected);
    expect(aggregated.map((ticket) => ticket.title).sort()).toEqual(expected);
  });
});
