import { useEffect, useState } from 'react';

function App() {
  const [greeting, setGreeting] = useState('Connecting to the API...');

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = import.meta.env.VITE_API_URL || '';

    fetch(`${apiUrl}/api/v1/hello`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API request failed');
        return response.json();
      })
      .then((data) => setGreeting(data.message))
      .catch((error) => {
        if (error.name !== 'AbortError') setGreeting('Could not reach the ClinicDesk API.');
      });

    return () => controller.abort();
  }, []);

  return (
    <main>
      <section className="welcome-card">
        <p className="eyebrow">Your clinic workspace</p>
        <h1>ClinicDesk</h1>
        <p className="description">{greeting}</p>
      </section>
    </main>
  );
}

export default App;
