// The numbers behind GET /api/v1/metrics (CD-23, docs/metrics.md). Everything is counted in
// MongoDB: two ticket aggregations and one user query, whatever the number of agents (no
// query per agent, no tickets loaded into memory). Only counts, averages, user ids and
// names leave this module: never ticket text or customer data.
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { STATUSES } = require('../tickets/statusWorkflow');
const { slaFilterExpression } = require('../sla/query');
const { averageHours, rangeStart } = require('./range');

// "Open" means not finished: every status except resolved and closed
// (docs/status-workflow.md), so open, in_progress and waiting.
const DONE_STATUSES = Object.freeze(['resolved', 'closed']);
const OPEN_STATUSES = Object.freeze(STATUSES.filter((status) => !DONE_STATUSES.includes(status)));
const STAFF_ROLES = Object.freeze(['agent', 'admin']);

function countOf(facet) {
  return facet[0]?.count ?? 0;
}

// Map of assignee id (string) to count; unassigned tickets are under the key null.
function countsByAssignee(rows) {
  return new Map(rows.map(({ _id, count }) => [_id ? _id.toString() : null, count]));
}

// Open tickets, whatever the range: by status, by assignee, and their SLA state now. The
// first $match uses the { status, createdAt, _id } index. The SLA conditions are the same
// $expr as the ?sla= list filter (src/sla/query.js), so the counts always agree with it;
// tickets without SLA data (created before CD-22) never match them.
async function openTicketStats(now) {
  const [stats] = await Ticket.aggregate([
    { $match: { status: { $in: OPEN_STATUSES } } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byAssignee: [{ $group: { _id: '$assignee', count: { $sum: 1 } } }],
        breached: [
          { $match: { $expr: slaFilterExpression('breached', now) } },
          { $count: 'count' },
        ],
        atRisk: [{ $match: { $expr: slaFilterExpression('at_risk', now) } }, { $count: 'count' }],
      },
    },
  ]);

  const byStatus = Object.fromEntries(OPEN_STATUSES.map((status) => [status, 0]));
  for (const { _id, count } of stats.byStatus) byStatus[_id] = count;

  return {
    total: OPEN_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
    byStatus,
    byAssignee: countsByAssignee(stats.byAssignee),
    breached: countOf(stats.breached),
    atRisk: countOf(stats.atRisk),
  };
}

// Tickets whose resolvedAt is inside the range [from, now] ("all": up to now). resolvedAt is
// set on resolved (kept on closed) and cleared on reopen, so a reopened ticket counts once,
// by its latest resolvedAt. The $match uses the { resolvedAt } index (models/Ticket.js).
async function resolvedStats(from, now) {
  const resolvedAt = from ? { $gte: from, $lte: now } : { $lte: now };
  const [stats] = await Ticket.aggregate([
    { $match: { resolvedAt } },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalMs: { $sum: { $subtract: ['$resolvedAt', '$createdAt'] } },
            },
          },
        ],
        byAssignee: [{ $group: { _id: '$assignee', count: { $sum: 1 } } }],
      },
    },
  ]);

  const overall = stats.overall[0] ?? { count: 0, totalMs: 0 };
  return {
    count: overall.count,
    averageHours: averageHours(overall.totalMs, overall.count),
    byAssignee: countsByAssignee(stats.byAssignee),
  };
}

function byOpenThenName(a, b) {
  return (
    b.openAssigned - a.openAssigned ||
    (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  );
}

// One row per active agent and admin (zeros included), plus anyone else who still holds
// open tickets: a deactivated user, a former agent whose role changed, or a deleted user
// (name null). Those rows are marked inactive unless the user is still active.
async function perAgentRows(open, resolved) {
  const holders = [...open.byAssignee.keys()].filter(Boolean);
  const users = await User.find({
    $or: [{ role: { $in: STAFF_ROLES }, isActive: true }, { _id: { $in: holders } }],
  })
    .select('name role isActive')
    .lean();

  const rows = new Map();
  for (const user of users) {
    const id = user._id.toString();
    rows.set(id, {
      id,
      name: user.name,
      openAssigned: open.byAssignee.get(id) ?? 0,
      resolvedInRange: resolved.byAssignee.get(id) ?? 0,
      inactive: !user.isActive,
    });
  }
  for (const id of holders) {
    if (!rows.has(id)) {
      rows.set(id, {
        id,
        name: null,
        openAssigned: open.byAssignee.get(id),
        resolvedInRange: resolved.byAssignee.get(id) ?? 0,
        inactive: true,
      });
    }
  }
  return [...rows.values()].sort(byOpenThenName);
}

// `now` is the server's time (the route's injectable clock); it is the end of the range and
// the moment the SLA state is taken.
async function computeMetrics({ range, now }) {
  const from = rangeStart(range, now);
  const [open, resolved] = await Promise.all([openTicketStats(now), resolvedStats(from, now)]);
  const perAgent = await perAgentRows(open, resolved);

  return {
    range,
    from: from ? from.toISOString() : null,
    generatedAt: now.toISOString(),
    openTickets: { total: open.total, byStatus: open.byStatus },
    resolution: { averageHours: resolved.averageHours, resolvedCount: resolved.count },
    perAgent,
    unassigned: { open: open.byAssignee.get(null) ?? 0 },
    sla: { breachedOpen: open.breached, atRiskOpen: open.atRisk },
  };
}

module.exports = { OPEN_STATUSES, computeMetrics };
