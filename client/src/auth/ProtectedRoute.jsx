import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Sends logged-out users to /login and remembers where they were going, so the login
// page can send them back there afterwards (see LoginPage).
// With `roles`, a logged-in user whose role is not listed goes to /tickets instead. This
// only hides pages: the API checks the role again on every request.
function ProtectedRoute({ roles, children }) {
  const { token, user } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && !roles.includes(user?.role)) {
    return <Navigate to="/tickets" replace />;
  }

  return children;
}

export default ProtectedRoute;
