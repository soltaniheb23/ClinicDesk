const mongoose = require('mongoose');
const { ALLOWED_TYPES, ATTACHMENT_LIMITS } = require('../attachments/limits');

// A file attached to a ticket (CD-18, docs/attachments.md). The bytes are in GridFS
// (src/attachments/storage.js); this document holds what the API shows and checks. Every
// field is set by the route from the authenticated user and the file's content, never from
// the request: `type` is the detected type and `name` the sanitised name.
const attachmentSchema = new mongoose.Schema(
  {
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: ATTACHMENT_LIMITS.maxNameLength },
    type: { type: String, enum: ALLOWED_TYPES, required: true },
    size: { type: Number, required: true, min: 1, max: ATTACHMENT_LIMITS.maxFileSize },
    // The GridFS file id. Internal: never sent to a client.
    gridFsId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// A ticket's attachments, oldest first (the list and the per-ticket count).
attachmentSchema.index({ ticket: 1, createdAt: 1, _id: 1 });

module.exports = mongoose.model('Attachment', attachmentSchema);
