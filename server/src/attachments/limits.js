// Attachment limits and allowed types (CD-18, docs/attachments.md). One place for every
// number: the routes, the multer limits and the docs all follow this object. Kept small on
// purpose: files live in MongoDB GridFS, and Atlas M0 has 512 MB in total
// (docs/decisions/CD-18-attachment-storage.md).
const MB = 1024 * 1024;

const ATTACHMENT_LIMITS = Object.freeze({
  // Per file, checked while the upload is read (multer stops reading past it).
  maxFileSize: 2 * MB,
  // Files in one POST request.
  maxFilesPerRequest: 3,
  // Files on one ticket, in total.
  maxFilesPerTicket: 5,
  // Stored filename, after sanitising (filename.js).
  maxNameLength: 100,
  // The detected types that are accepted, with the extension a stored name must end in.
  types: Object.freeze({
    'image/png': Object.freeze(['.png']),
    'image/jpeg': Object.freeze(['.jpg', '.jpeg']),
    'application/pdf': Object.freeze(['.pdf']),
  }),
});

const ALLOWED_TYPES = Object.freeze(Object.keys(ATTACHMENT_LIMITS.types));

module.exports = { ALLOWED_TYPES, ATTACHMENT_LIMITS };
