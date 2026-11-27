import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AppErrorBoundary from './monitoring/AppErrorBoundary.jsx';
import { initMonitoring } from './monitoring/sentry.js';
import '@fontsource/fraunces/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import './tokens.css';
import './style.css';

// Before the first render, so errors during startup are reported too. Off without
// VITE_SENTRY_DSN (docs/monitoring.md).
initMonitoring();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
