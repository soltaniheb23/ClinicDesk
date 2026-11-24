import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setUnauthorizedHandler } from '../api/index.js';
import { EMPTY_SESSION, loadSession, saveSession } from './session.js';

// See session.js for where the token is kept and why.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadSession);

  const login = useCallback((token, user = null) => {
    setAuth(saveSession({ token, user }));
  }, []);

  const logout = useCallback(() => {
    setAuth(saveSession(EMPTY_SESSION));
  }, []);

  // A 401 on a call that carried the token means the session is no longer valid.
  useEffect(() => setUnauthorizedHandler(logout), [logout]);

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
