// Ticket attachments (CD-18, docs/attachments.md). Mounted at
// /api/v1/tickets/:ticketId/attachments, before the tickets router (app.js).
//
// Every route uses the ticket's access rule: agents and admins see every ticket, a customer
// only their own, and an invalid id, an unknown ticket and another customer's ticket all
// answer the same 404. Files never touch the disk: multer keeps them in memory (at most
// maxFileSize each, cut off while reading) and they go straight to GridFS.
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Attachment = require('../models/Attachment');
const Ticket = require('../models/Ticket');
const { authenticate } = require('../auth/authenticate');
const { canAccessOwnedResource } = require('../auth/authorize');
const { recordAudit } = require('../audit/record');
const { ATTACHMENT_LIMITS } = require('../attachments/limits');
const { detectFileType } = require('../attachments/detectType');
const { sanitizeFilename } = require('../attachments/filename');
const { deleteFile, openFile, saveFile } = require('../attachments/storage');

const router = express.Router({ mergeParams: true });

const FIELD_NAME = 'files';
const MAX_MB = ATTACHMENT_LIMITS.maxFileSize / (1024 * 1024);
const TICKET_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ticket not found' } };
const ATTACHMENT_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Attachment not found' } };
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
};

function sendError(response, status, code, message) {
  return response.status(status).json({ error: { code, message } });
}

// Memory storage only: multer never writes to disk. busboy stops reading a file at
// maxFileSize + 1 byte and multer answers LIMIT_FILE_SIZE, so an oversized body is never
// fully buffered. Filenames from the client are read as UTF-8 (browsers send them so).
const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: {
    fileSize: ATTACHMENT_LIMITS.maxFileSize,
    files: ATTACHMENT_LIMITS.maxFilesPerRequest,
    fields: 5,
    fieldSize: 1024,
    fieldNameSize: 100,
    headerPairs: 100,
  },
}).array(FIELD_NAME, ATTACHMENT_LIMITS.maxFilesPerRequest);

function readFiles(request, response) {
  return new Promise((resolve, reject) => {
    upload(request, response, (error) => (error ? reject(error) : resolve(request.files ?? [])));
  });
}

// The uniform error answer for a failed multipart read.
function uploadError(response, error) {
  switch (error instanceof multer.MulterError ? error.code : null) {
    case 'LIMIT_FILE_SIZE':
      return sendError(response, 413, 'FILE_TOO_LARGE', `Each file must be at most ${MAX_MB} MB.`);
    case 'LIMIT_FILE_COUNT':
      return tooManyInRequest(response);
    case 'LIMIT_UNEXPECTED_FILE':
      if (error.field === FIELD_NAME) return tooManyInRequest(response);
      return sendError(
        response,
        400,
        'VALIDATION_ERROR',
        `Send the files in the form field "${FIELD_NAME}".`,
      );
    default:
      return sendError(
        response,
        400,
        'VALIDATION_ERROR',
        `Send the files as multipart/form-data in the field "${FIELD_NAME}".`,
      );
  }
}

function tooManyInRequest(response) {
  return sendError(
    response,
    400,
    'TOO_MANY_FILES',
    `Upload at most ${ATTACHMENT_LIMITS.maxFilesPerRequest} files at a time.`,
  );
}

function ticketFull(response, existing) {
  return sendError(
    response,
    409,
    'ATTACHMENT_LIMIT',
    `A ticket can have at most ${ATTACHMENT_LIMITS.maxFilesPerTicket} attachments; this one has ${existing}.`,
  );
}

// The ticket if this user may see it, otherwise null (the same 404 for every reason).
async function findVisibleTicket(request) {
  const { ticketId } = request.params;
  if (!mongoose.isValidObjectId(ticketId)) return null;
  const ticket = await Ticket.findById(ticketId).select('createdBy status').lean();
  if (!ticket || !canAccessOwnedResource(request.user, ticket.createdBy)) return null;
  return ticket;
}

async function findAttachment(ticket, attachmentId) {
  if (!mongoose.isValidObjectId(attachmentId)) return null;
  return Attachment.findOne({ _id: attachmentId, ticket: ticket._id })
    .populate('uploadedBy', 'name')
    .lean();
}

// The API shape, field by field: never gridFsId or any other storage detail.
function serializeAttachment(attachment) {
  const { uploadedBy } = attachment;
  return {
    id: attachment._id.toString(),
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    createdAt: attachment.createdAt,
    uploadedBy: uploadedBy?._id ? { id: uploadedBy._id.toString(), name: uploadedBy.name } : null,
  };
}

router.use(authenticate);

// Checks, in order: 401 -> 404 ticket not visible -> 409 ticket closed -> 409 ticket full ->
// 413 file too large / 400 too many files or bad multipart -> 400 no file -> 400 a file is
// not PNG, JPEG or PDF by content -> 409 too many for the ticket. Nothing is stored unless
// every file passes.
router.post('/', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(TICKET_NOT_FOUND);

  if (ticket.status === 'closed') {
    return sendError(response, 409, 'TICKET_CLOSED', 'A closed ticket does not accept files.');
  }

  // Before the body is read, so a full ticket costs no upload.
  const existing = await Attachment.countDocuments({ ticket: ticket._id });
  if (existing >= ATTACHMENT_LIMITS.maxFilesPerTicket) return ticketFull(response, existing);

  let files;
  try {
    files = await readFiles(request, response);
  } catch (error) {
    return uploadError(response, error);
  }

  if (files.length === 0) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      `Choose at least one file (field "${FIELD_NAME}").`,
    );
  }

  // The type comes from the content only; the client's mimetype and extension are ignored.
  const checked = files.map((file) => ({ file, type: detectFileType(file.buffer) }));
  const rejected = checked.find(({ type }) => type === null);
  if (rejected) {
    const shownName = sanitizeFilename(rejected.file.originalname, null);
    return sendError(
      response,
      400,
      'UNSUPPORTED_FILE_TYPE',
      `"${shownName}" is not a PNG, JPEG or PDF file. Only these types are allowed.`,
    );
  }

  if (existing + files.length > ATTACHMENT_LIMITS.maxFilesPerTicket) {
    return ticketFull(response, existing);
  }

  const stored = [];
  try {
    for (const { file, type } of checked) {
      const gridFsId = await saveFile(file.buffer);
      stored.push({
        ticket: ticket._id,
        uploadedBy: request.user.id,
        name: sanitizeFilename(file.originalname, type),
        type,
        size: file.size,
        gridFsId,
      });
    }
    const created = await Attachment.insertMany(stored);
    stored.length = 0;

    for (const attachment of created) {
      await recordAudit({
        actor: request.user.id,
        action: 'ticket.attachment_added',
        entityType: 'ticket',
        entityId: ticket._id,
        metadata: { name: attachment.name },
      });
    }

    const items = await Attachment.find({ _id: { $in: created.map(({ _id }) => _id) } })
      .sort({ createdAt: 1, _id: 1 })
      .populate('uploadedBy', 'name')
      .lean();
    return response.status(201).json({ items: items.map(serializeAttachment) });
  } finally {
    // Something failed after some files were saved: remove them, so no orphan uses quota.
    await Promise.all(stored.map(({ gridFsId }) => deleteFile(gridFsId).catch(() => {})));
  }
});

// The ticket's attachments, oldest first.
router.get('/', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(TICKET_NOT_FOUND);

  const attachments = await Attachment.find({ ticket: ticket._id })
    .sort({ createdAt: 1, _id: 1 })
    .populate('uploadedBy', 'name')
    .lean();
  return response.json({ items: attachments.map(serializeAttachment) });
});

// Always a download, never shown inline: Content-Disposition attachment, the stored
// (detected) type, nosniff, and no caching. Helmet's CSP (default-src 'none') applies too.
router.get('/:attachmentId', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(TICKET_NOT_FOUND);

  const attachment = await findAttachment(ticket, request.params.attachmentId);
  if (!attachment) return response.status(404).json(ATTACHMENT_NOT_FOUND);

  // attachment() writes a quoted ASCII filename plus filename*=UTF-8''… for other names.
  response.attachment(attachment.name);
  response.set({
    'Content-Type': attachment.type,
    'Content-Length': String(attachment.size),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });

  await new Promise((resolve, reject) => {
    const file = openFile(attachment.gridFsId);
    file.once('error', (error) => {
      // Before the first byte the error handler can still answer 500; after it, the only
      // honest thing left is to cut the connection.
      if (!response.headersSent) {
        response.removeHeader('Content-Disposition');
        response.removeHeader('Content-Length');
        reject(error);
      } else {
        response.destroy(error);
        resolve();
      }
    });
    file.once('end', resolve);
    file.pipe(response);
  });
});

// Only the uploader or an admin (an agent can delete only their own files). Removes the
// metadata first, then the GridFS file.
router.delete('/:attachmentId', async (request, response) => {
  const ticket = await findVisibleTicket(request);
  if (!ticket) return response.status(404).json(TICKET_NOT_FOUND);

  const attachment = await findAttachment(ticket, request.params.attachmentId);
  if (!attachment) return response.status(404).json(ATTACHMENT_NOT_FOUND);

  const isUploader = attachment.uploadedBy?._id?.toString() === request.user.id;
  if (!isUploader && request.user.role !== 'admin') return response.status(403).json(FORBIDDEN);

  // findOneAndDelete: if two deletes race, only one of them removes it and writes the audit.
  const removed = await Attachment.findOneAndDelete({ _id: attachment._id }).lean();
  if (!removed) return response.status(404).json(ATTACHMENT_NOT_FOUND);

  try {
    await deleteFile(removed.gridFsId);
  } catch (error) {
    // The attachment is gone for users; only the bytes are left behind. Logged, not fatal.
    console.error(`Could not delete GridFS file for attachment ${removed._id}:`, error);
  }

  await recordAudit({
    actor: request.user.id,
    action: 'ticket.attachment_removed',
    entityType: 'ticket',
    entityId: ticket._id,
    metadata: { name: removed.name },
  });

  return response.status(204).end();
});

module.exports = router;
