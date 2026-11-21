/**
 * DataExport.jsx
 * GDPR: Download all personal data as JSON file.
 * Goes in Settings/Account page.
 */
import { useState } from 'react';

import { API } from '../config'

export default function DataExport({ email }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/export-my-data?email=${encodeURIComponent(email)}`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Export failed');
      }
      const data = await res.json();

      // Download as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lajtner-code-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: '#1a1a2e', borderRadius: 12, padding: 20,
      border: '1px solid #2a2a4a', marginBottom: 16
    }}>
      <h3 style={{ color: '#fff', margin: '0 0 8px', fontSize: 16 }}>
        📥 Export My Data
      </h3>
      <p style={{ color: '#aaa', fontSize: 13, margin: '0 0 12px' }}>
        Download all your data as required by GDPR. Includes: measurements
        (Lajtner Time, Point, Jerk, Resonance, energy in Joules and eV),
        Focus Test answers, and account information.
      </p>
      {error && <p style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</p>}
      <button onClick={handleExport} disabled={loading} style={{
        background: '#4a90d9', color: '#fff', border: 'none',
        padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
        fontSize: 14, fontWeight: 500
      }}>
        {loading ? 'Preparing export...' : '📥 Download My Data (JSON)'}
      </button>
    </div>
  );
}