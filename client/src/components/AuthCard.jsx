import './forms.css';

// Centered card used by the login and register screens (wireframe 01-login).
function AuthCard({ title, subtitle, children }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </section>
    </main>
  );
}

export default AuthCard;
