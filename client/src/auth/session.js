// Current session (token + user), shared by AuthContext and the API client.
//
// Token storage trade-off:
// The token lives in memory and is mirrored to sessionStorage so a page refresh does not log
// the user out. Any script running on the page (for example after an XSS bug) can read
// sessionStorage just like localStorage, so neither is safe against XSS. sessionStorage is
// still the smaller risk: it is scoped to one browser tab and cleared when the tab closes,
// while localStorage keeps the token on disk until it expires. That matters on shared clinic
// computers. A future option is an httpOnly cookie set by the API, which page scripts cannot
// read at all.
const STORAGE_KEY = 'clinicdesk.auth';

export const EMPTY_SESSION = Object.freeze({ token: null, user: null });

let current = EMPTY_SESSION;

function readStoredSession() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored.token === 'string' && stored.token) {
      return { token: stored.token, user: stored.user ?? null };
    }
  } catch {
    // Missing, corrupt or blocked storage: start logged out.
  }
  return EMPTY_SESSION;
}

// Reads the session from storage (on app start) and makes it the current one.
export function loadSession() {
  current = readStoredSession();
  return current;
}

// Replaces the current session; an empty token clears it.
export function saveSession({ token, user = null }) {
  current = token ? { token, user } : EMPTY_SESSION;
  try {
    if (current.token) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory session still works.
  }
  return current;
}

export function getSessionToken() {
  return current.token;
}
