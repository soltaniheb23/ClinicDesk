import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

// Placeholder until the real login screen (CD-34). Once login() is called the user is sent
// back to the page ProtectedRoute remembered, or to /tickets.
function LoginPage() {
  const { token } = useAuth();
  const location = useLocation();

  if (token) {
    const from = location.state?.from;
    const target = from ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : '/tickets';
    return <Navigate to={target} replace />;
  }

  return (
    <main>
      <section className="welcome-card">
        <h1>Log in</h1>
        <p className="description">The login form arrives in CD-34.</p>
        <p className="description">
          No account? <Link to="/register">Create one</Link>
        </p>
      </section>
    </main>
  );
}

export default LoginPage;
