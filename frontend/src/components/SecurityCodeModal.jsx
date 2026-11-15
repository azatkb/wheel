/**
 * SecurityCodeModal.jsx
 * Shows Personal Security Code to user on first login.
 * IMPORTANT: Code shown only ONCE. User must save it.
 */
import { useState } from 'react';

export default function SecurityCodeModal({ code, onClose }) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{
        background: '#1a1a2e', borderRadius: 16, padding: 32,
        maxWidth: 480, width: '90%', color: '#fff', textAlign: 'center'
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, color: '#fff' }}>
          Your Personal Security Code
        </h2>
        <p style={{ color: '#aaa', fontSize: 14, marginBottom: 20 }}>
          This code is shown <strong style={{ color: '#ff6b6b' }}>only once</strong>.
          Save it in a safe place. You can use it to delete your data
          even if you no longer have your Lajtner Scope.
        </p>

        <div style={{
          background: '#0d0d1a', border: '2px dashed #4a90d9',
          borderRadius: 12, padding: '20px 24px', margin: '16px 0',
          fontFamily: 'monospace', fontSize: 28, letterSpacing: 4,
          color: '#4a90d9', userSelect: 'all'
        }}>
          {code}
        </div>

        <button onClick={handleCopy} style={{
          background: 'transparent', border: '1px solid #4a90d9',
          color: '#4a90d9', padding: '8px 20px', borderRadius: 8,
          cursor: 'pointer', fontSize: 14, marginBottom: 20
        }}>
          {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
        </button>

        <div style={{
          background: '#2a1a1a', border: '1px solid #ff6b6b33',
          borderRadius: 8, padding: 12, margin: '16px 0', textAlign: 'left'
        }}>
          <label style={{ display: 'flex', gap: 10, cursor: 'pointer', fontSize: 13, color: '#ccc' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I have saved my Personal Security Code. I understand it will
              <strong style={{ color: '#ff6b6b' }}> not be shown again</strong>.
            </span>
          </label>
        </div>

        <button
          onClick={onClose}
          disabled={!confirmed}
          style={{
            background: confirmed ? '#4a90d9' : '#333',
            color: confirmed ? '#fff' : '#666',
            border: 'none', padding: '12px 32px', borderRadius: 8,
            cursor: confirmed ? 'pointer' : 'not-allowed',
            fontSize: 16, fontWeight: 600, width: '100%'
          }}
        >
          I've Saved My Code — Continue
        </button>
      </div>
    </div>
  );
}
