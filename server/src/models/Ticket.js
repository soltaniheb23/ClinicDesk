const mongoose = require('mongoose');
const { STATUSES } = require('../tickets/statusWorkflow');

const CATEGORIES = ['it', 'facility', 'account', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const ticketSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    category: { type: String, enum: CATEGORIES, default: 'other' },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    status: { type: String, enum: STATUSES, default: 'open' },
    // Set from the authenticated user by the route, never from the request body.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Set once by the first public agent/admin reply (CD-14), never by the request body.
    firstResponseAt: { type: Date, default: null },
    // Set when the ticket is resolved (or closed), cleared when it is reopened.
    resolvedAt: { type: Date, default: null },
    // SLA snapshot (CD-22, docs/sla.md): createdAt + the policy targets at creation time.
    // Never recalculated, so a policy change does not move existing tickets. Tickets created
    // before CD-22 do not have these fields and have no SLA.
    slaFirstResponseDueAt: { type: Date },
    slaResolutionDueAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returned) {
        returned.id = returned._id.toString();
        delete returned._id;
        delete returned.__v;
        return returned;
      },
    },
  },
);

// "My tickets" (createdBy, newest first) and the full list sorted by date.
ticketSchema.index({ createdBy: 1, createdAt: -1 });
ticketSchema.index({ createdAt: -1 });
// The most common list filters (CD-17, docs/ticket-list.md): the queue by status ("open")
// and "my tickets" / "unassigned" for agents, newest first. The equality field comes first
// and the sort fields follow, with _id as the tie-breaker the list always sorts by, so
// MongoDB can read one page straight from the index without sorting in memory.
// The title search is a case-insensitive regex and scans the matched tickets; that is fine
// at ClinicDesk's size (one clinic, thousands of tickets), and a text index can follow later.
ticketSchema.index({ status: 1, createdAt: -1, _id: -1 });
ticketSchema.index({ assignee: 1, createdAt: -1, _id: -1 });
// Metrics (CD-23, docs/metrics.md): "resolved in the range" matches on resolvedAt only. The
// indexes above all start with another field, so without this one the query reads every
// ticket. Tickets that are not resolved have resolvedAt null and sit at one end of it.
ticketSchema.index({ resolvedAt: 1 });

module.exports = mongoose.model('Ticket', ticketSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUSES = STATUSES;
