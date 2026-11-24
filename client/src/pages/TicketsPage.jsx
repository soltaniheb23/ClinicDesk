import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

// Placeholder until the ticket list screen.
function TicketsPage() {
  const { user, logout } = useAuth();

  return (
    <main>
      <section className="welcome-card">
        <h1>Tickets</h1>
        {user?.name && <p className="description">Signed in as {user.name}</p>}
        <EmptyState
          title="No tickets yet"
          message="Tickets you create will appear here."
          action={<Link to="/health-check">Check the API connection</Link>}
        />
        <button type="button" className="button" onClick={logout}>
          Log out
        </button>
      </section>
    </main>
  );
}

export default TicketsPage;
