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
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
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

// "My tickets" (createdBy, newest first) and the upcoming full list sorted by date.
ticketSchema.index({ createdBy: 1, createdAt: -1 });
ticketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUSES = STATUSES;
