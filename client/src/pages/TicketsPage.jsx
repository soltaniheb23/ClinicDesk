import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';

// Placeholder until the ticket list screen.
function TicketsPage() {
  return (
    <section>
      <h1 className="page-title">Tickets</h1>
      <EmptyState
        title="No tickets yet"
        message="Tickets you create will appear here."
        action={<Link to="/health-check">Check the API connection</Link>}
      />
    </section>
  );
}

export default TicketsPage;
