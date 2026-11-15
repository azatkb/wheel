/**
 * QuestionnaireEdit.jsx
 * Edit Focus Test answers (e.g., user stopped smoking).
 * Separate page/modal reachable from Focus Test section.
 */
import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://wheelttt.xyz';

const FIELDS = [
  { key: 'illness', label: 'Illness', desc: 'How much does illness affect your daily life?' },
  { key: 'loneliness', label: 'Loneliness', desc: 'How often do you feel lonely?' },
  { key: 'sleep', label: 'Sleep', desc: 'How well do you sleep on average?' },
  { key: 'homeostasis', label: 'Homeostasis', desc: 'How balanced does your body feel?' },
  { key: 'stimulants', label: 'Stimulants', desc: 'How often do you use stimulants (coffee, nicotine, etc.)?' },
  { key: 'digital', label: 'Digital', desc: 'How much time do you spend on screens daily?' },
  { key: 'breathing', label: 'Breathing', desc: 'How is your breathing quality?' },
  { key: 'emotions', label: 'Emotions', desc: 'How stable are your emotions?' },
];

const OPTIONS = [
  { value: 1, label: '1 — Very low / None' },
  { value: 2, label: '2 — Low' },
  { value: 3, label: '3 — Moderate' },
  { value: 4, label: '4 — High' },
  { value: 5, label: '5 — Very high' },
];

export default function QuestionnaireEdit({ email, onSaved, onCancel }) {
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`${API}/questionnaire/my?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(data => {
        if (data.length > 0) {
          const latest = data[0];
          const a = {};
          FIELDS.forEach(f => { a[f.key] = latest[f.key] || 0; });
          setAnswers(a);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [email]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API}/questionnaire/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...answers })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setSuccess(true);
      setTimeout(() => onSaved?.(), 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p style={{ color: '#aaa' }}>Loading your answers...</p>;

  return (
    <div style={{
      background: '#1a1a2e', borderRadius: 12, padding: 24,
      border: '1px solid #2a2a4a', maxWidth: 560
    }}>
      <h3 style={{ color: '#fff', margin: '0 0 4px' }}>✏️ Edit Focus Test Answers</h3>
      <p style={{ color: '#aaa', fontSize: 13, marginBottom: 20 }}>
        Update your answers if your lifestyle has changed (e.g., you stopped smoking).
      </p>

      {FIELDS.map(f => (
        <div key={f.key} style={{ marginBottom: 16 }}>
          <label style={{ color: '#ccc', fontSize: 14, fontWeight: 500 }}>
            {f.label}
          </label>
          <p style={{ color: '#888', fontSize: 12, margin: '2px 0 6px' }}>{f.desc}</p>
          <select
            value={answers[f.key] || 0}
            onChange={e => setAnswers(prev => ({ ...prev, [f.key]: parseInt(e.target.value) }))}
            style={{
              width: '100%', background: '#0d0d1a', border: '1px solid #333',
              borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 14
            }}
          >
            <option value={0}>— Not answered —</option>
            {OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}

      {error && <p style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</p>}
      {success && <p style={{ color: '#6bff6b', fontSize: 13 }}>✅ Saved successfully!</p>}

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button onClick={onCancel} style={{
          flex: 1, background: '#333', color: '#aaa', border: 'none',
          padding: '10px', borderRadius: 8, cursor: 'pointer'
        }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, background: '#4a90d9', color: '#fff', border: 'none',
          padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600
        }}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
