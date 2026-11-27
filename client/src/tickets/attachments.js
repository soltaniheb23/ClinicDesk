// Attachment limits and checks in the browser (CD-18, docs/attachments.md). These mirror
// server/src/attachments/limits.js so people get a clear message before uploading; the
// server checks everything again and decides the type from the file's content.
export const ATTACHMENT_LIMITS = Object.freeze({
  maxFileSize: 2 * 1024 * 1024,
  maxFilesPerRequest: 3,
  maxFilesPerTicket: 5,
});

const TYPES = Object.freeze({
  'image/png': { label: 'PNG', extensions: ['.png'] },
  'image/jpeg': { label: 'JPEG', extensions: ['.jpg', '.jpeg'] },
  'application/pdf': { label: 'PDF', extensions: ['.pdf'] },
});

// For <input type="file" accept>: the extensions and the types.
export const ACCEPT = [
  ...Object.values(TYPES).flatMap((type) => type.extensions),
  ...Object.keys(TYPES),
].join(',');

export const LIMITS_HINT = `PNG, JPEG or PDF, up to 2 MB each. At most ${ATTACHMENT_LIMITS.maxFilesPerRequest} files at a time and ${ATTACHMENT_LIMITS.maxFilesPerTicket} per ticket.`;

export function typeLabel(type) {
  return TYPES[type]?.label ?? 'File';
}

// "512 B", "120 KB", "1.5 MB".
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

function hasAllowedType(file) {
  const name = file.name.toLowerCase();
  const byType = TYPES[file.type];
  if (byType) return byType.extensions.some((extension) => name.endsWith(extension));
  // Some systems send no type at all; then the extension decides (the server re-checks).
  return (
    file.type === '' &&
    Object.values(TYPES).some(({ extensions }) => extensions.some((ext) => name.endsWith(ext)))
  );
}

// Returns a list of messages, empty when the selection may be uploaded. `existingCount` is
// how many attachments the ticket already has.
export function checkFiles(files, existingCount) {
  const messages = [];
  const left = ATTACHMENT_LIMITS.maxFilesPerTicket - existingCount;

  if (files.length > ATTACHMENT_LIMITS.maxFilesPerRequest) {
    messages.push(
      `Choose at most ${ATTACHMENT_LIMITS.maxFilesPerRequest} files at a time (you chose ${files.length}).`,
    );
  }
  if (files.length > left) {
    messages.push(
      left <= 0
        ? `This ticket already has ${ATTACHMENT_LIMITS.maxFilesPerTicket} attachments, the maximum.`
        : `This ticket can take ${left} more file${left === 1 ? '' : 's'} (at most ${ATTACHMENT_LIMITS.maxFilesPerTicket} per ticket).`,
    );
  }
  for (const file of files) {
    if (!hasAllowedType(file)) {
      messages.push(`"${file.name}" is not a PNG, JPEG or PDF file.`);
    } else if (file.size > ATTACHMENT_LIMITS.maxFileSize) {
      messages.push(`"${file.name}" is ${formatSize(file.size)}; the limit is 2 MB.`);
    } else if (file.size === 0) {
      messages.push(`"${file.name}" is empty.`);
    }
  }
  return messages;
}

// Hands a downloaded Blob to the browser as a file. A blob: URL on a temporary link with
// the download attribute: no CSP change is needed (it is a navigation, not a fetch).
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
