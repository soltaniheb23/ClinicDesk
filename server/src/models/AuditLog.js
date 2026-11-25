const mongoose = require('mongoose');

// Who did what and when (CD-20, docs/audit-log.md). Append-only: entries are created and
// read, never changed or deleted.
const ACTIONS = Object.freeze([
  'auth.login',
  'auth.login_failed',
  'ticket.status_changed',
  'ticket.assignee_changed',
  'user.created',
  'user.role_changed',
  'user.active_changed',
]);
const ENTITY_TYPES = Object.freeze(['user', 'ticket']);

const auditLogSchema = new mongoose.Schema(
  {
    // The logged-in user who acted; null for a failed login (nobody is logged in).
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, enum: ACTIONS, required: true },
    entityType: { type: String, enum: ENTITY_TYPES, required: true },
    // The user or ticket acted on; null for a failed login.
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // A small object built by the route from known fields ({ from, to }, { role },
    // { email }). Never passwords, hashes, tokens or request bodies.
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    // Mixed paths are not minimized away when empty, so {} stays {}.
    minimize: false,
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

// The admin list: newest first, optionally narrowed to one actor or one action. _id is the
// tie-breaker the list always sorts by, so a page can be read straight from the index.
auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1, _id: -1 });
auditLogSchema.index({ action: 1, createdAt: -1, _id: -1 });

// Append-only: every Mongoose path that changes or removes an entry throws. Only create()
// and insertMany() write. (Model.bulkWrite and the raw driver bypass middleware; the app
// never uses them on this collection.)
class AuditLogImmutableError extends Error {
  constructor() {
    super('Audit log entries cannot be changed or deleted');
    this.name = 'AuditLogImmutableError';
  }
}

function refuse() {
  throw new AuditLogImmutableError();
}

const QUERY_WRITES = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
];
for (const operation of QUERY_WRITES) {
  auditLogSchema.pre(operation, { document: false, query: true }, refuse);
}
// entry.deleteOne() and entry.updateOne() on a loaded document.
auditLogSchema.pre(['deleteOne', 'updateOne'], { document: true, query: false }, refuse);
// save() is allowed only for a new entry.
auditLogSchema.pre('save', function blockResave() {
  if (!this.isNew) refuse();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
module.exports.ACTIONS = ACTIONS;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
module.exports.AuditLogImmutableError = AuditLogImmutableError;
