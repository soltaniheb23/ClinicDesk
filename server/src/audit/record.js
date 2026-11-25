const AuditLog = require('../models/AuditLog');

const EMAIL_MAX_LENGTH = 254;

// Normalizes the attempted email of a failed login: lowercase, trimmed, at most 254
// characters. It is the only free text a client can put into the log.
function auditEmail(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .slice(0, EMAIL_MAX_LENGTH);
}

// Writes one audit entry. Never throws: the user's action has already succeeded, so a
// failed write is logged with console.error and the request carries on. Callers pass only
// known, small fields in `metadata` (never passwords, hashes, tokens or request bodies).
async function recordAudit({ actor = null, action, entityType, entityId = null, metadata = {} }) {
  try {
    await AuditLog.create({ actor, action, entityType, entityId, metadata });
  } catch (error) {
    console.error(`Could not write audit entry "${action}":`, error);
  }
}

module.exports = { recordAudit, auditEmail };
