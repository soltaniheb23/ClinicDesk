import { useEffect, useRef, useState } from 'react';
import {
  deleteAttachment,
  downloadAttachment,
  getAttachments,
  uploadAttachments,
} from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';
import {
  ACCEPT,
  ATTACHMENT_LIMITS,
  LIMITS_HINT,
  checkFiles,
  formatSize,
  saveBlob,
  typeLabel,
} from './attachments.js';
import { formatDateTime } from './format.js';

function serverMessage(error) {
  return error.details?.[0]?.message ?? error.message;
}

function AttachmentItem({ attachment, canDelete, busy, onDownload, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const { name } = attachment;

  return (
    <li className="attachment">
      <div className="attachment-info">
        <span className="attachment-name">{name}</span>
        <span className="attachment-meta">
          {typeLabel(attachment.type)} · {formatSize(attachment.size)} ·{' '}
          <time dateTime={attachment.createdAt}>{formatDateTime(attachment.createdAt)}</time> ·{' '}
          {attachment.uploadedBy?.name ?? 'Deleted user'}
        </span>
      </div>
      <div className="attachment-actions">
        {confirming ? (
          <>
            <span className="attachment-confirm" id={`confirm-${attachment.id}`}>
              Delete this file?
            </span>
            <button
              type="button"
              className="button-secondary button-danger"
              aria-describedby={`confirm-${attachment.id}`}
              aria-label={`Yes, delete ${name}`}
              disabled={busy}
              onClick={() => onDelete(attachment)}
            >
              Yes, delete
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button-secondary"
              aria-label={`Download ${name}`}
              disabled={busy}
              onClick={() => onDownload(attachment)}
            >
              Download
            </button>
            {canDelete && (
              <button
                type="button"
                className="button-secondary"
                aria-label={`Delete ${name}`}
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

// Attachments of one ticket (CD-18, docs/attachments.md): the list with download and delete,
// and the upload form. Files are checked here first (type, size, count) for a quick message;
// the server checks them again and has the last word.
function AttachmentsSection({ ticket }) {
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState({ key: null });
  const [selected, setSelected] = useState([]);
  const [problems, setProblems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getAttachments(ticket.id, { signal: controller.signal })
      .then((data) => setResult({ key: reloadCount, items: data.items }))
      .catch((requestError) => {
        if (requestError.name === 'AbortError') return;
        setResult({ key: reloadCount, error: requestError.message });
      });
    return () => controller.abort();
  }, [ticket.id, reloadCount]);

  const loaded = result.key === reloadCount && !result.error;
  const items = loaded ? result.items : [];
  const isClosed = ticket.status === 'closed';
  const isFull = items.length >= ATTACHMENT_LIMITS.maxFilesPerTicket;

  function canDelete(attachment) {
    return user?.role === 'admin' || attachment.uploadedBy?.id === user?.id;
  }

  function clearSelection() {
    setSelected([]);
    setProblems([]);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleSelect(event) {
    const files = Array.from(event.target.files ?? []);
    setSelected(files);
    setProblems(checkFiles(files, items.length));
    setError('');
    setNotice('');
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (uploading) return;
    if (selected.length === 0) {
      setProblems(['Choose a file first.']);
      return;
    }
    const found = checkFiles(selected, items.length);
    if (found.length > 0) {
      setProblems(found);
      return;
    }

    setUploading(true);
    setError('');
    setNotice('');
    try {
      const data = await uploadAttachments(ticket.id, selected);
      setResult((previous) => ({ ...previous, items: [...previous.items, ...data.items] }));
      setNotice(
        data.items.length === 1
          ? `Uploaded ${data.items[0].name}.`
          : `Uploaded ${data.items.length} files.`,
      );
      clearSelection();
    } catch (requestError) {
      setError(serverMessage(requestError));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(attachment) {
    setBusyId(attachment.id);
    setError('');
    try {
      const blob = await downloadAttachment(ticket.id, attachment.id);
      saveBlob(blob, attachment.name);
    } catch (requestError) {
      setError(serverMessage(requestError));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(attachment) {
    setBusyId(attachment.id);
    setError('');
    setNotice('');
    try {
      await deleteAttachment(ticket.id, attachment.id);
      setResult((previous) => ({
        ...previous,
        items: previous.items.filter((item) => item.id !== attachment.id),
      }));
      setNotice(`Deleted ${attachment.name}.`);
    } catch (requestError) {
      setError(serverMessage(requestError));
    } finally {
      setBusyId(null);
    }
  }

  let list;
  if (result.key !== reloadCount) {
    list = <Loading label="Loading attachments..." />;
  } else if (result.error) {
    list = (
      <ErrorMessage message={result.error} onRetry={() => setReloadCount((count) => count + 1)} />
    );
  } else if (items.length === 0) {
    list = <p className="attachments-empty">No attachments yet.</p>;
  } else {
    list = (
      <ul className="attachment-list">
        {items.map((attachment) => (
          <AttachmentItem
            key={attachment.id}
            attachment={attachment}
            canDelete={canDelete(attachment)}
            busy={busyId === attachment.id}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        ))}
      </ul>
    );
  }

  const describedBy = ['attachment-hint', problems.length > 0 && 'attachment-problems']
    .filter(Boolean)
    .join(' ');

  let form = null;
  if (loaded && isClosed) {
    form = <p className="attachments-closed">This ticket is closed; no files can be added.</p>;
  } else if (loaded && isFull) {
    form = (
      <p className="attachments-closed">
        This ticket has {ATTACHMENT_LIMITS.maxFilesPerTicket} attachments, the maximum. Delete one
        to add another.
      </p>
    );
  } else if (loaded) {
    form = (
      <form className="attachment-form" aria-label="Add attachments" onSubmit={handleUpload}>
        <label className="field-label" htmlFor="attachment-files">
          Add files
        </label>
        <input
          ref={inputRef}
          id="attachment-files"
          className="attachment-input"
          type="file"
          multiple
          accept={ACCEPT}
          onChange={handleSelect}
          disabled={uploading}
          aria-describedby={describedBy}
          aria-invalid={problems.length > 0 ? 'true' : undefined}
        />
        <p className="field-hint" id="attachment-hint">
          {LIMITS_HINT}
        </p>
        {problems.length > 0 && (
          <ul className="form-error attachment-problems" id="attachment-problems" role="alert">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <button
          type="submit"
          className="button-primary"
          disabled={uploading || problems.length > 0}
          aria-busy={uploading}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </form>
    );
  }

  return (
    <section className="attachments" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">Attachments</h2>
      {list}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {form}
    </section>
  );
}

export default AttachmentsSection;
