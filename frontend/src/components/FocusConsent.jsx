/**
 * FocusConsent.jsx
 * GDPR consent for Focus Test health data (smoking, drug use = special category).
 * Must be shown BEFORE user can access Focus Test questionnaire.
 */
import { useState, useEffect } from 'react';

import { API } from '../config'

export default function FocusConsent({ email, onConsented }) {
  const [status, setStatus] = useState(null); // null=loading, obj=loaded
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!email) return;
    fetch(`${API}/questionnaire/consent-status?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => {
        setStatus(d);
        if (d.consent) onConsented?.(true);
      })
      .catch(() => setStatus({ consent: false, withdrawn: false }));
  }, [email]);

  const handleConsent = async (give) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/questionnaire/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, consent: give })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setStatus({ consent: give, withdrawn: !give });
      onConsented?.(give);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (status === null) return <p style={{ color: '#aaa' }}>Loading...</p>;

  // Already consented
  if (status.consent) {
    return (
      <div style={{
        background: '#1a2a1a', border: '1px solid #2a4a2a',
        borderRadius: 12, padding: 16, marginBottom: 16
      }}>
        <p style={{ color: '#6bff6b', margin: 0, fontSize: 14 }}>
          ✅ You have given consent for Focus Test data storage.
        </p>
        <button onClick={() => handleConsent(false)} disabled={loading} style={{
          background: 'transparent', color: '#ff6b6b', border: '1px solid #ff6b6b33',
          padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
          fontSize: 12, marginTop: 10
        }}>
          Withdraw Consent
        </button>
        <p style={{ color: '#666', fontSize: 11, marginTop: 6, marginBottom: 0 }}>
          Withdrawing consent will delete all your Focus Test data and you will no longer be able to use this feature.
        </p>
      </div>
    );
  }

  // Withdrawn
  if (status.withdrawn) {
    return (
      <div style={{
        background: '#2a1a1a', border: '1px solid #4a2a2a',
        borderRadius: 12, padding: 16, marginBottom: 16
      }}>
        <p style={{ color: '#ff6b6b', margin: '0 0 8px', fontWeight: 600 }}>
          ⚠️ Consent Withdrawn
        </p>
        <p style={{ color: '#aaa', fontSize: 13, margin: 0 }}>
          You have withdrawn your consent. The Focus Test feature is no longer available.
          Your previous Focus Test data has been deleted.
        </p>
      </div>
    );
  }

  // Need consent
  return (
    <div style={{
      background: '#1a1a2e', border: '1px solid #4a90d9',
      borderRadius: 12, padding: 20, marginBottom: 16
    }}>
      <h3 style={{ color: '#fff', margin: '0 0 12px', fontSize: 18 }}>
        🔒 Focus Test — Data Consent Required
      </h3>
      <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.6 }}>
        The Focus Test collects 8 data points about your lifestyle and health habits,
        including questions about illness, sleep, stimulant use, and emotional state.
        Under GDPR, this qualifies as <strong style={{ color: '#4a90d9' }}>special category data</strong> and
        requires your explicit consent before we can store it.
      </p>

      <div style={{
        background: '#0d0d1a', borderRadius: 8, padding: 14, margin: '16px 0'
      }}>
        <label style={{ display: 'flex', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            style={{ marginTop: 3, accentColor: '#4a90d9' }}
          />
          <span style={{ color: '#ccc', fontSize: 13, lineHeight: 1.6 }}>
            Yes, I consent to Lajtner Code storing the 8 data points I provide
            in the Focus Test. I understand that I can withdraw my consent at any time,
            which will result in the deletion of my Focus Test data.
          </span>
        </label>
      </div>

      {error && <p style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</p>}

      <button
        onClick={() => handleConsent(true)}
        disabled={!agreed || loading}
        style={{
          background: agreed ? '#4a90d9' : '#333',
          color: agreed ? '#fff' : '#666',
          border: 'none', padding: '12px 24px', borderRadius: 8,
          cursor: agreed ? 'pointer' : 'not-allowed',
          fontSize: 14, fontWeight: 600
        }}
      >
        {loading ? 'Saving...' : 'Give Consent & Continue'}
      </button>
    </div>
  );
}