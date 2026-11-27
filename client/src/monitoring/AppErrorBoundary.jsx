// Catches render errors anywhere in the app (CD-25, docs/monitoring.md). Sentry's boundary
// reports the error when monitoring is on and does nothing extra when it is off; either way
// the user sees a short message and a reload button instead of a blank page.
import { ErrorBoundary } from '@sentry/react';
import '../components/states.css';

function reloadPage() {
  window.location.reload();
}

// `onReload` is for the tests; the app always reloads the page.
export function ErrorFallback({ onReload = reloadPage }) {
  return (
    <main>
      <div className="state state-error" role="alert">
        <h1 className="state-title">Something went wrong</h1>
        <p className="state-message">
          ClinicDesk hit an unexpected error. Reload the page to continue.
        </p>
        <button type="button" className="button" onClick={() => onReload()}>
          Reload
        </button>
      </div>
    </main>
  );
}

function AppErrorBoundary({ children, onReload }) {
  return <ErrorBoundary fallback={<ErrorFallback onReload={onReload} />}>{children}</ErrorBoundary>;
}

export default AppErrorBoundary;
