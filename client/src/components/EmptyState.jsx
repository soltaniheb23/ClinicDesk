import './states.css';

function EmptyState({ title, message, action }) {
  return (
    <section className="state state-empty" aria-label={title}>
      <h2 className="state-title">{title}</h2>
      {message && <p className="state-message">{message}</p>}
      {action && <div className="state-action">{action}</div>}
    </section>
  );
}

export default EmptyState;
