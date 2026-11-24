import { Link } from 'react-router-dom';

// Placeholder until the real registration screen.
function RegisterPage() {
  return (
    <main>
      <section className="welcome-card">
        <h1>Create account</h1>
        <p className="description">The registration form is coming soon.</p>
        <p className="description">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </section>
    </main>
  );
}

export default RegisterPage;
