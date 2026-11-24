import './states.css';

function ErrorMessage({ message, onRetry }) {
  return (
    <div className="state state-error" role="alert">
      <p className="state-message">{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export default ErrorMessage;
