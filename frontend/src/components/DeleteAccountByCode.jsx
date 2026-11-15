/**
 * DeleteAccountByCode.jsx
 * Allows users to delete their data using Personal Security Code.
 * Accessible without being logged in (for users who lost their device).
 */
import { useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://wheelttt.xyz';

export default function DeleteAccountByCode() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1=form, 2=confirm, 3=done

  const handleSubmit = async () => {
    if (step === 1) {
      if (!email || !code) { setError('Please enter both email and security code.'); return; }
      setStep(2);
      return;
    }
    // Step 2 — actually delete
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/delete-by-security-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, security_code: code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to delete data');
      setResult(data.message);
      setStep(3);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 3) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h2 style={{ color: '#4a90d9' }}>Data Deleted</h2>
        <p style={{ color: '#aaa' }}>{result}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
      <h2 style={{ color: '#fff', marginBottom: 8 }}>🗑️ Delete My Data</h2>
      <p style={{ color: '#aaa', fontSize: 14, marginBottom: 24 }}>
        Enter your email and Personal Security Code to permanently delete all your data.
        This action cannot be undone.
      </p>

      {step === 2 && (
        <div style={{
          background: '#2a1a1a', border: '1px solid #ff6b6b',
          borderRadius: 8, padding: 16, marginBottom: 20
        }}>
          <p style={{ color: '#ff6b6b', fontWeight: 600, margin: 0 }}>
            ⚠️ Are you sure? This will permanently delete:
          </p>
          <ul style={{ color: '#ccc', fontSize: 13, paddingLeft: 20, marginBottom: 0 }}>
            <li>All measurement data (Lajtner Time, Point, Jerk, Resonance)</li>
            <li>All Focus Test answers</li>
            <li>All forum posts and comments</li>
            <li>Your account settings</li>
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={step === 2}
          style={{
            background: '#1a1a2e', border: '1px solid #333',
            borderRadius: 8, padding: '10px 14px', color: '#fff', fontSize: 14
          }}
        />
        <input
          type="text"
          placeholder="Personal Security Code (XXXX-XXXX-XXXX)"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          disabled={step === 2}
          style={{
            background: '#1a1a2e', border: '1px solid #333',
            borderRadius: 8, padding: '10px 14px', color: '#fff',
            fontSize: 14, fontFamily: 'monospace', letterSpacing: 2
          }}
        />
      </div>

      {error && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        {step === 2 && (
          <button onClick={() => setStep(1)} style={{
            flex: 1, background: '#333', color: '#aaa', border: 'none',
            padding: '12px', borderRadius: 8, cursor: 'pointer'
          }}>
            Cancel
          </button>
        )}
        <button onClick={handleSubmit} disabled={loading} style={{
          flex: 1, background: step === 2 ? '#ff4444' : '#4a90d9',
          color: '#fff', border: 'none', padding: '12px',
          borderRadius: 8, cursor: 'pointer', fontWeight: 600
        }}>
          {loading ? 'Deleting...' : step === 2 ? '⚠️ Yes, Delete Everything' : 'Delete My Data'}
        </button>
      </div>
    </div>
  );
}
