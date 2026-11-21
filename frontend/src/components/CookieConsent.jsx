/**
 * CookieConsent.jsx
 * GDPR Cookie Consent Banner — tiered consent system.
 *
 * Two cookie categories:
 *   1. Essential (required) — authentication, security, session. Without these
 *      the app CANNOT be used at all. User MUST accept to proceed.
 *   2. Analytics & Improvement (optional) — usage analytics, performance
 *      monitoring. Can be declined, but some features may be limited.
 *
 * Behavior:
 *   - First visit: full-screen overlay, cannot be dismissed without choosing.
 *   - "Accept All" → both categories enabled.
 *   - "Essential Only" → only essential cookies; analytics disabled; some
 *     features (statistics, focus-test correlation) may be limited.
 *   - User CANNOT refuse essential cookies and still use the app.
 *   - Consent stored in localStorage + optionally in backend (audit trail).
 *   - Settings can be changed later from the Settings page.
 *
 * Reusable: also works standalone on lajtner.com (without React, via
 *   the companion cookie-consent.js script that Tamas can embed).
 */
import { useState, useEffect } from 'react'

const CONSENT_KEY = 'laj_cookie_consent'
const CONSENT_VERSION = 1  // bump to re-ask after policy changes

// Read stored consent
export function getConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.version !== CONSENT_VERSION) return null
    return parsed
  } catch { return null }
}

// Check if user has given essential consent
export function hasEssentialConsent() {
  const c = getConsent()
  return c?.essential === true
}

// Check if user accepted analytics
export function hasAnalyticsConsent() {
  const c = getConsent()
  return c?.analytics === true
}

export default function CookieConsent({ onConsented, termsUrl = 'https://lajtner.com/terms-privacy.html' }) {
  const [visible, setVisible] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    const consent = getConsent()
    if (!consent) {
      setVisible(true)
    } else {
      onConsented?.(consent)
    }
  }, [])

  const saveConsent = (essential, analytics) => {
    const consent = {
      essential,
      analytics,
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
    }
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent))
    } catch { /* private browsing fallback — consent lives in memory only */ }
    setVisible(false)
    onConsented?.(consent)
  }

  const acceptAll = () => saveConsent(true, true)
  const essentialOnly = () => saveConsent(true, false)

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: '#16162a', border: '1px solid #2a2a4a',
        borderRadius: 16, maxWidth: 520, width: '100%',
        padding: '2rem', color: '#e0e0e0',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🍪</div>
          <h2 style={{ color: '#fff', margin: '0 0 .5rem', fontSize: '1.3rem' }}>
            Cookie Consent
          </h2>
          <p style={{ color: '#aaa', fontSize: '.88rem', margin: 0, lineHeight: 1.6 }}>
            Lajtner Code uses cookies to provide essential functionality and improve your experience.
            You must accept essential cookies to use the app.
          </p>
        </div>

        {/* Cookie categories */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginBottom: '1.5rem' }}>
          {/* Essential — always on */}
          <div style={{
            background: '#1a2a1a', border: '1px solid #2a4a2a',
            borderRadius: 10, padding: '.85rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, color: '#fff', fontSize: '.92rem' }}>
                  🔒 Essential Cookies
                </span>
                <span style={{
                  fontSize: '.65rem', fontWeight: 600, color: '#6bff6b',
                  background: 'rgba(0,255,0,.1)', border: '1px solid rgba(0,255,0,.2)',
                  borderRadius: 4, padding: '.1rem .4rem', marginLeft: '.5rem',
                }}>REQUIRED</span>
              </div>
              <div style={{
                fontSize: '.72rem', color: '#6bff6b', fontWeight: 600,
              }}>Always on</div>
            </div>
            {showDetails && (
              <div style={{ marginTop: '.5rem', fontSize: '.78rem', color: '#aaa', lineHeight: 1.6 }}>
                Authentication, session management, security tokens, CSRF protection,
                user preferences (theme, language). Without these cookies, you cannot
                log in or use any features of Lajtner Code.
              </div>
            )}
          </div>

          {/* Analytics — optional */}
          <div style={{
            background: '#1a1a2e', border: '1px solid #2a2a4a',
            borderRadius: 10, padding: '.85rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, color: '#fff', fontSize: '.92rem' }}>
                  📊 Analytics & Improvement
                </span>
                <span style={{
                  fontSize: '.65rem', fontWeight: 600, color: '#4a90d9',
                  background: 'rgba(74,144,217,.1)', border: '1px solid rgba(74,144,217,.2)',
                  borderRadius: 4, padding: '.1rem .4rem', marginLeft: '.5rem',
                }}>OPTIONAL</span>
              </div>
            </div>
            {showDetails && (
              <div style={{ marginTop: '.5rem', fontSize: '.78rem', color: '#aaa', lineHeight: 1.6 }}>
                Usage analytics (which features are used, session duration), performance
                monitoring, error reporting. Helps us improve the app. If declined,
                some features like aggregated statistics and cross-measurement correlations
                may be limited.
              </div>
            )}
          </div>
        </div>

        {/* Show/hide details */}
        <button onClick={() => setShowDetails(d => !d)} style={{
          background: 'none', border: 'none', color: '#4a90d9',
          cursor: 'pointer', fontSize: '.8rem', marginBottom: '1rem',
          padding: 0, textDecoration: 'underline',
        }}>
          {showDetails ? 'Hide details' : 'Show cookie details'}
        </button>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <button onClick={acceptAll} style={{
            background: '#4a90d9', color: '#fff', border: 'none',
            padding: '.85rem', borderRadius: 10, fontSize: '.95rem',
            fontWeight: 700, cursor: 'pointer',
            transition: 'background .15s',
          }}>
            ✓ Accept All Cookies
          </button>
          <button onClick={essentialOnly} style={{
            background: '#2a2a3e', color: '#ccc', border: '1px solid #3a3a5a',
            padding: '.75rem', borderRadius: 10, fontSize: '.85rem',
            fontWeight: 600, cursor: 'pointer',
          }}>
            Essential Only (limited features)
          </button>
        </div>

        {/* Footer links */}
        <div style={{
          marginTop: '1rem', textAlign: 'center',
          fontSize: '.72rem', color: '#666', lineHeight: 1.8,
        }}>
          By using Lajtner Code you agree to our{' '}
          <a href={termsUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: '#4a90d9', textDecoration: 'none' }}>
            Terms & Privacy Policy
          </a>.
          <br />You can change your cookie preferences anytime in Settings.
        </div>
      </div>
    </div>
  )
}

/**
 * CookieGate — wraps the app. If essential cookies not accepted, blocks everything.
 * Usage in App.jsx:
 *   <CookieGate>
 *     <Routes>...</Routes>
 *   </CookieGate>
 */
export function CookieGate({ children }) {
  const [consent, setConsent] = useState(() => getConsent())

  if (!consent?.essential) {
    return <CookieConsent onConsented={setConsent} />
  }
  return children
}

/**
 * CookieSettings — small component for the Settings page to manage consent.
 */
export function CookieSettings() {
  const [consent, setConsent] = useState(() => getConsent())

  const toggleAnalytics = () => {
    const updated = {
      ...consent,
      analytics: !consent.analytics,
      timestamp: new Date().toISOString(),
    }
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(updated))
    } catch {}
    setConsent(updated)
  }

  const resetConsent = () => {
    try { localStorage.removeItem(CONSENT_KEY) } catch {}
    window.location.reload()
  }

  if (!consent) return null

  return (
    <div style={{
      background: 'var(--bg2)', borderRadius: 12, padding: '1rem',
      border: '1px solid var(--border)', marginBottom: '1rem',
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: '.75rem' }}>
        🍪 Cookie Preferences
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '.5rem .7rem', borderRadius: 6, background: 'var(--bg3)', fontSize: '.88rem',
        }}>
          <span style={{ color: 'var(--text)' }}>🔒 Essential cookies</span>
          <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '.75rem' }}>Always on</span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '.5rem .7rem', borderRadius: 6, background: 'var(--bg3)', fontSize: '.88rem',
        }}>
          <span style={{ color: 'var(--text)' }}>📊 Analytics cookies</span>
          <button onClick={toggleAnalytics} style={{
            background: consent.analytics ? 'var(--green)' : 'var(--bg)',
            color: consent.analytics ? '#000' : 'var(--muted)',
            border: `1px solid ${consent.analytics ? 'var(--green)' : 'var(--border)'}`,
            padding: '.2rem .6rem', borderRadius: 4, fontSize: '.75rem',
            fontWeight: 600, cursor: 'pointer',
          }}>
            {consent.analytics ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      <div style={{ marginTop: '.75rem', fontSize: '.72rem', color: 'var(--dim)' }}>
        Consent given: {new Date(consent.timestamp).toLocaleDateString()}
        <button onClick={resetConsent} style={{
          background: 'none', border: 'none', color: 'var(--red)',
          cursor: 'pointer', fontSize: '.72rem', marginLeft: '.75rem',
          textDecoration: 'underline',
        }}>
          Reset all cookie preferences
        </button>
      </div>
    </div>
  )
}
