import { useEffect, useState } from 'react';
import { useApi } from '../api/useApi.js';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Loading from '../components/Loading.jsx';

// Staging proof from CD-6: shows that the frontend can reach the deployed API.
function HealthCheckPage() {
  const api = useApi();
  const [greeting, setGreeting] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    api
      .get('/api/v1/hello', { signal: controller.signal })
      .then((data) => setGreeting(data.message))
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message);
      });

    return () => controller.abort();
  }, [api]);

  return (
    <main>
      <section className="welcome-card">
        <p className="eyebrow">Your clinic workspace</p>
        <h1>ClinicDesk</h1>
        <div className="description">
          {error ? (
            <ErrorMessage message={error} />
          ) : greeting ? (
            <p>{greeting}</p>
          ) : (
            <Loading label="Connecting to the API..." />
          )}
        </div>
      </section>
    </main>
  );
}

export default HealthCheckPage;
