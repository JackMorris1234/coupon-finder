import { useRef, useState } from 'react';

// Shared fetch-state for every search surface: run(url) -> result/loading/error.
// Only the latest run() updates state, so a slow earlier response can never
// overwrite a newer one.
export default function useSearch() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const run = async (url) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (id !== seq.current) return null; // superseded by a newer search
      setResult(data);
      return data;
    } catch (err) {
      if (id !== seq.current) return null;
      setError(err.message);
      setResult(null);
      return null;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  return { result, loading, error, run };
}
