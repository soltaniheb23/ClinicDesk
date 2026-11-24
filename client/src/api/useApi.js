import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { createApiClient } from './client.js';

// API client bound to the current session: sends its token and logs out on a 401.
export function useApi() {
  const { token, logout } = useAuth();

  return useMemo(
    () => createApiClient({ getToken: () => token, onUnauthorized: logout }),
    [token, logout],
  );
}
