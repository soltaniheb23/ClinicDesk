import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import './AppLayout.css';

const ROLE_LABELS = { customer: 'Customer', agent: 'Agent', admin: 'Admin' };

// Layout for logged-in pages: top bar with the app name, the admin's "Users", "Audit log"
// and "Metrics" links, the user and a Log out button.
function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="app-name" to="/tickets">
          ClinicDesk
        </Link>
        {user?.role === 'admin' && (
          <nav className="app-nav" aria-label="Admin">
            <NavLink className="app-nav-link" to="/admin/users">
              Users
            </NavLink>
            <NavLink className="app-nav-link" to="/audit-log">
              Audit log
            </NavLink>
            <NavLink className="app-nav-link" to="/metrics">
              Metrics
            </NavLink>
          </nav>
        )}
        <div className="app-user">
          {user && (
            <p className="app-user-info">
              <span className="app-user-name">{user.name}</span>
              {user.role && (
                <span className="app-user-role">{ROLE_LABELS[user.role] ?? user.role}</span>
              )}
            </p>
          )}
          <button type="button" className="app-logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
