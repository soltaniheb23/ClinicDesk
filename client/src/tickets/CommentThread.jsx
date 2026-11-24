import { useEffect, useState } from 'react';
import { addComment, getComments } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import FormField from '../components/FormField.jsx';
import Loading from '../components/Loading.jsx';
import { formatDateTime } from './format.js';
import { COMMENT_MAX_LENGTH, ROLE_LABELS } from './options.js';

// Comment text is rendered as a plain React text node (escaped), never as HTML; the CSS
// keeps line breaks with white-space: pre-wrap.
function CommentItem({ comment }) {
  const { author } = comment;
  return (
    <li className={comment.internal ? 'comment comment-internal' : 'comment'}>
      <div className="comment-header">
        <span className="comment-author">{author?.name ?? 'Deleted user'}</span>
        {author && <span className="comment-role">{ROLE_LABELS[author.role] ?? author.role}</span>}
        {comment.internal && <span className="badge badge-internal">Internal note</span>}
        <time className="comment-time" dateTime={comment.createdAt}>
          {formatDateTime(comment.createdAt)}
        </time>
      </div>
      <p className="comment-body">{comment.body}</p>
    </li>
  );
}

function CommentForm({ ticketId, isStaff, onAdded }) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (saving) return;

    if (body.trim() === '') {
      setError('Write a comment first.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { comment } = await addComment(ticketId, { body, internal: isStaff && internal });
      onAdded(comment);
      setBody('');
      setInternal(false);
    } catch (requestError) {
      setError(requestError.details?.[0]?.message ?? requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const describedBy = ['comment-body-count', error && 'comment-error'].filter(Boolean).join(' ');

  return (
    <form className="comment-form" aria-label="Add a comment" onSubmit={submit} noValidate>
      <FormField
        id="comment-body"
        as="textarea"
        label="Add a comment"
        rows={4}
        maxLength={COMMENT_MAX_LENGTH}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={saving}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : undefined}
      />
      <p className="field-hint comment-counter" id="comment-body-count">
        {body.length} / {COMMENT_MAX_LENGTH}
      </p>
      {isStaff && (
        <label className="comment-internal-toggle">
          <input
            type="checkbox"
            checked={internal}
            onChange={(event) => setInternal(event.target.checked)}
            disabled={saving}
          />
          Internal note (only agents and admins see it)
        </label>
      )}
      {error && (
        <p className="form-error" id="comment-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={saving} aria-busy={saving}>
        {saving ? 'Posting...' : 'Post comment'}
      </button>
    </form>
  );
}

// The ticket's comment thread, oldest first, with the form to add one. Customers never
// receive internal notes from the API, so the list shows whatever the server sends.
function CommentThread({ ticket }) {
  const { user } = useAuth();
  const isStaff = user?.role === 'agent' || user?.role === 'admin';
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    const controller = new AbortController();
    getComments(ticket.id, { signal: controller.signal })
      .then((data) => setResult({ key: reloadCount, items: data.items }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setResult({ key: reloadCount, error: error.message });
      });
    return () => controller.abort();
  }, [ticket.id, reloadCount]);

  function handleAdded(comment) {
    setResult((previous) => ({ ...previous, items: [...previous.items, comment] }));
  }

  let content;
  if (result.key !== reloadCount) {
    content = <Loading label="Loading comments..." />;
  } else if (result.error) {
    content = (
      <ErrorMessage message={result.error} onRetry={() => setReloadCount((count) => count + 1)} />
    );
  } else if (result.items.length === 0) {
    content = <p className="comments-empty">No comments yet.</p>;
  } else {
    content = (
      <ol className="comment-list">
        {result.items.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </ol>
    );
  }

  const canPost = result.key === reloadCount && !result.error;

  return (
    <section className="comments" aria-labelledby="comments-heading">
      <h2 id="comments-heading">Comments</h2>
      {content}
      {ticket.status === 'closed' ? (
        <p className="comments-closed">
          This ticket is closed, so it does not accept new comments.
        </p>
      ) : (
        canPost && <CommentForm ticketId={ticket.id} isStaff={isStaff} onAdded={handleAdded} />
      )}
    </section>
  );
}

export default CommentThread;
