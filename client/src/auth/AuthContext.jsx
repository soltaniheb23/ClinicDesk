import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Token storage trade-off:
// The token lives in React state (memory) and is mirrored to sessionStorage so a page
// refresh does not log the user out. Any script running on the page (for example after an
// XSS bug) can read sessionStorage just like localStorage, so neither is safe against XSS.
// sessionStorage is still the smaller risk: it is scoped to one browser tab and cleared when
// the tab closes, while localStorage keeps the token on disk until it expires. That matters on
// shared clinic computers. A future option is an httpOnly cookie set by the API, which page
// scripts cannot read at all.
const STORAGE_KEY = 'clinicdesk.auth';

const AuthContext = createContext(null);

function readStoredAuth() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored.token === 'string') {
      return { token: stored.token, user: stored.user ?? null };
    }
  } catch {
    // Missing, corrupt or blocked storage: start logged out.
  }
  return { token: null, user: null };
}

function writeStoredAuth(value) {
  try {
    if (value.token) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory state still works.
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth);

  const login = useCallback((token, user = null) => {
    const next = { token, user };
    writeStoredAuth(next);
    setAuth(next);
  }, []);

  const logout = useCallback(() => {
    const next = { token: null, user: null };
    writeStoredAuth(next);
    setAuth(next);
  }, []);

  const value = useMemo(
    () => ({ token: auth.token, user: auth.user, login, logout }),
    [auth, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
