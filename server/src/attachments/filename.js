// Makes the client's filename safe to store and to send back in Content-Disposition
// (CD-18, docs/attachments.md). The name is only ever metadata: files are stored in GridFS
// under a random id, and the name is never used as a path.
const { ATTACHMENT_LIMITS } = require('./limits');

const FALLBACK_NAME = 'attachment';
// C0 and C1 control characters, DEL, and the Unicode bidi controls (which can make
// "invoice‮fdp.exe" look like "invoiceexe.pdf").
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
// Characters Windows refuses in filenames, plus the quote used by Content-Disposition.
const RESERVED_CHARACTERS = /[<>:"|?*]/g;

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

// Cuts the name to `max` characters (whole code points), keeping the extension.
function truncate(name, extension, max) {
  const characters = [...name];
  if (characters.length <= max) return name;
  const extensionLength = [...extension].length;
  return (
    characters
      .slice(0, max - extensionLength)
      .join('')
      .trimEnd() + extension
  );
}

// Returns a safe name for a file of the detected `type`:
// - only the part after the last "/" or "\" (no directories);
// - no control or bidi characters, no reserved characters, whitespace collapsed;
// - no leading dots or spaces (no hidden files, no "..");
// - ends in an extension that matches the detected type (".png" is added to "photo.exe"
//   holding a PNG), so the saved file never opens as another kind of file;
// - at most 100 characters, extension included; "attachment.<ext>" when nothing is left.
function sanitizeFilename(original, type) {
  const allowedExtensions = ATTACHMENT_LIMITS.types[type] ?? [];
  const max = ATTACHMENT_LIMITS.maxNameLength;

  let name = String(original ?? '')
    .normalize('NFC')
    .split(/[/\\]/)
    .pop()
    .replace(UNSAFE_CHARACTERS, '')
    .replace(RESERVED_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();

  const extension = extensionOf(name);
  if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
    name = `${name.replace(/[.\s]+$/, '') || FALLBACK_NAME}${allowedExtensions[0]}`;
  }
  if (name === '') name = `${FALLBACK_NAME}${allowedExtensions[0] ?? ''}`;

  return truncate(name, extensionOf(name), max);
}

module.exports = { FALLBACK_NAME, sanitizeFilename };
