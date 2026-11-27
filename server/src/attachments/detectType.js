// Decides a file's type from its first bytes (CD-18, docs/attachments.md). The client's
// Content-Type and the file extension are never trusted: a text file named .png or an .exe
// renamed .pdf is rejected because its content does not start with an allowed signature.
const SIGNATURES = Object.freeze([
  // PNG: \x89 P N G \r \n \x1a \n
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG: start of image marker followed by the next marker's 0xFF.
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  // PDF: "%PDF-"
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
]);

// Returns 'image/png', 'image/jpeg' or 'application/pdf', or null for anything else
// (including an empty file or a buffer shorter than the signature).
function detectFileType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const match = SIGNATURES.find(
    ({ bytes }) =>
      buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte),
  );
  return match ? match.type : null;
}

module.exports = { detectFileType };
