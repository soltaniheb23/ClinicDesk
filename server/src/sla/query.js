// MongoDB form of getSlaState (state.js) for the ticket list filter ?sla=breached|at_risk.
//
// It is a $expr, so the same condition works in the aggregation that reads a page and in
// countDocuments, and it follows getSlaState case by case. tests/slaQuery.test.js checks
// both against each other on the same tickets. `now` is set by the server (a Date), never
// taken from the request.
const { AT_RISK_RATIO } = require('./state');

const CREATED = '$createdAt';
const FIRST_DUE = '$slaFirstResponseDueAt';
const RESOLUTION_DUE = '$slaResolutionDueAt';
const RESOLVED = '$resolvedAt';
// A ticket resolved without a public staff reply counts as answered at resolvedAt.
const RESPONDED = { $ifNull: ['$firstResponseAt', RESOLVED] };

const isSet = (field) => ({ $ne: [{ $ifNull: [field, null] }, null] });
const isUnset = (field) => ({ $eq: [{ $ifNull: [field, null] }, null] });
const isDate = (field) => ({ $eq: [{ $type: field }, 'date'] });

// Tickets created before CD-22 have no due dates and never match.
const HAS_SLA = [isDate(CREATED), isDate(FIRST_DUE), isDate(RESOLUTION_DUE)];

function breachedExpression(now) {
  return {
    $and: [
      ...HAS_SLA,
      {
        $or: [
          // First response missed (stays breached).
          { $and: [isSet(RESPONDED), { $gt: [RESPONDED, FIRST_DUE] }] },
          // Still waiting for a first response, past the due date.
          { $and: [isUnset(RESPONDED), { $gt: [now, FIRST_DUE] }] },
          // Resolved late.
          { $and: [isSet(RESOLVED), { $gt: [RESOLVED, RESOLUTION_DUE] }] },
          // Answered, not resolved, past the resolution due date.
          { $and: [isSet(RESPONDED), isUnset(RESOLVED), { $gt: [now, RESOLUTION_DUE] }] },
        ],
      },
    ],
  };
}

// Running, not past the due date, and at least AT_RISK_RATIO of the time used.
function nearDue(now, due) {
  return {
    $and: [
      { $lte: [now, due] },
      {
        $gte: [
          { $subtract: [now, CREATED] },
          { $multiply: [AT_RISK_RATIO, { $subtract: [due, CREATED] }] },
        ],
      },
    ],
  };
}

function atRiskExpression(now) {
  return {
    $and: [
      ...HAS_SLA,
      {
        $or: [
          { $and: [isUnset(RESPONDED), nearDue(now, FIRST_DUE)] },
          {
            $and: [
              isSet(RESPONDED),
              { $lte: [RESPONDED, FIRST_DUE] },
              isUnset(RESOLVED),
              nearDue(now, RESOLUTION_DUE),
            ],
          },
        ],
      },
    ],
  };
}

const EXPRESSIONS = { breached: breachedExpression, at_risk: atRiskExpression };

// A $expr value for one of FILTER_STATES at the time `now`.
function slaFilterExpression(state, now) {
  return EXPRESSIONS[state](now);
}

module.exports = { slaFilterExpression };
