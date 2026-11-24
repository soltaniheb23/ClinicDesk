import { Link } from 'react-router-dom';

function NotFoundPage() {
  return (
    <main>
      <section className="welcome-card">
        <h1>Page not found</h1>
        <p className="description">
          The page you are looking for does not exist. <Link to="/tickets">Go to tickets</Link>
        </p>
      </section>
    </main>
  );
}

export default NotFoundPage;
