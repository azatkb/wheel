/**
 * CookieConsent.jsx  —  v2.1
 * GDPR Cookie Consent — per Tamas spec (Nov 2026).
 *
 * Strictly necessary cookies row has Accept / Refuse buttons.
 *   - Refuse → popup: "you won't be able to use the Lajtner Code"
 *     with "Go back" (returns to main banner) and "Continue anyway"
 *     (confirms rejection, locks app).
 *
 * Optional cookies (Preference, Forum) each have Accept / Refuse toggles.
 *
 * Bottom buttons:
 *   - "Accept All" → everything on.
 *   - "Reject Optional" → essential accepted, optionals off.
 *   - "Reject All" → same refuse flow as the essential Refuse button.
 */
import { useState, useEffect } from 'react'

const CONSENT_KEY = 'laj_cookie_consent'
const CONSENT_VERSION = 2

// ── Read / check consent ──────────────────────────────────────────────────────
export function getConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.version !== CONSENT_VERSION) return null
    return parsed
  } catch { return null }
}

export function hasEssentialConsent() {
  const c = getConsent()
  return c?.essential === true
}

export function hasPreferenceConsent() {
  const c = getConsent()
  return c?.preference === true
}

export function hasForumConsent() {
  const c = getConsent()
  return c?.forum === true
}

export function isFullyRejected() {
  const c = getConsent()
  return c !== null && c.essential === false
}

// ── Main Banner ───────────────────────────────────────────────────────────────
export default function CookieConsent({ onConsented, termsUrl = 'https://lajtner.com/terms-privacy.html' }) {
  const [visible, setVisible] = useState(false)
  const [showRefusePopup, setShowRefusePopup] = useState(false)
  // Per-category choices (before final save)
  const [prefAccepted, setPrefAccepted] = useState(true)
  const [forumAccepted, setForumAccepted] = useState(true)

  useEffect(() => {
    const consent = getConsent()
    if (!consent) {
      setVisible(true)
    } else {
      onConsented?.(consent)
    }
  }, [])

  const saveConsent = (essential, preference, forum) => {
    const consent = {
      essential,
      preference,
      forum,
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
    }
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent))
    } catch {}
    setVisible(false)
    setShowRefusePopup(false)
    onConsented?.(consent)
  }

  // Accept essential + current optional choices
  const acceptEssential = () => saveConsent(true, prefAccepted, forumAccepted)
  const acceptAll       = () => saveConsent(true, true, true)
  const rejectOptional  = () => saveConsent(true, false, false)

  // Refuse essential → show warning popup
  const refuseEssential = () => setShowRefusePopup(true)
  const goBack          = () => setShowRefusePopup(false)
  const continueAnyway  = () => saveConsent(false, false, false)

  if (!visible) return null

  // ── Refuse popup ──
  if (showRefusePopup) {
    return (
      <div style={overlayStyle}>
        <div style={{ ...panelStyle, maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>⚠️</div>
          <h2 style={{ color: '#fff', margin: '0 0 .75rem', fontSize: '1.15rem' }}>
            Cookie required
          </h2>
          <p style={{ color: '#ccc', fontSize: '.9rem', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
            If you refuse the strictly necessary cookies, you will not be able
            to use the Lajtner Code. The shop and support remain available.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center' }}>
            <button onClick={goBack} style={{
              background: '#4a90d9', color: '#fff', border: 'none',
              padding: '.7rem 1.5rem', borderRadius: 10, fontSize: '.9rem',
              fontWeight: 600, cursor: 'pointer', minWidth: 110,
            }}>
              Go back
            </button>
            <button onClick={continueAnyway} style={{
              background: '#1a1a1a', color: '#ff6b6b', border: '1px solid #3a2020',
              padding: '.7rem 1.5rem', borderRadius: 10, fontSize: '.9rem',
              fontWeight: 600, cursor: 'pointer', minWidth: 150,
            }}>
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main cookie banner ──
  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🔒</div>
          <h2 style={{ color: '#fff', margin: '0 0 .6rem', fontSize: '1.2rem' }}>
            We value your privacy
          </h2>
          <p style={{ color: '#bbb', fontSize: '.85rem', margin: 0, lineHeight: 1.65 }}>
            We use cookies to make the Lajtner Code work, to improve your browsing
            experience and to show you personalized content. We never share your data
            with third parties, and we do not use cookies for advertising or to track
            your shopping habits.
          </p>
        </div>

        {/* Cookie categories */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', marginBottom: '1.25rem' }}>

          {/* ── Strictly necessary ── */}
          <div style={categoryBox('#1a2a1a', '#2a4a2a')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '.9rem' }}>
                🔒 Strictly necessary cookies
              </span>
              <div style={{ display: 'flex', gap: '.35rem' }}>
                <button onClick={acceptEssential} style={inlineBtn('#1a3a1a', '#2a6a2a', '#6bff6b')}>
                  Accept
                </button>
                <button onClick={refuseEssential} style={inlineBtn('#3a1a1a', '#6a2a2a', '#ff6b6b')}>
                  Refuse
                </button>
              </div>
            </div>
            <p style={descStyle}>
              These keep you logged in, verify your chip and keep the Lajtner Code secure.
              The Lajtner Code cannot work without them.
            </p>
          </div>

          {/* ── Preference cookies ── */}
          <div style={categoryBox('#1a1a2e', '#2a2a4a')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '.9rem' }}>
                ⚙️ Preference cookies
              </span>
              <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                <span style={optionalBadge}>OPTIONAL</span>
                <button onClick={() => setPrefAccepted(true)}
                  style={inlineBtn(
                    prefAccepted ? '#1a3a1a' : '#1a1a2e',
                    prefAccepted ? '#2a6a2a' : '#2a2a4a',
                    prefAccepted ? '#6bff6b' : '#888',
                  )}>Accept</button>
                <button onClick={() => setPrefAccepted(false)}
                  style={inlineBtn(
                    !prefAccepted ? '#3a1a1a' : '#1a1a2e',
                    !prefAccepted ? '#6a2a2a' : '#2a2a4a',
                    !prefAccepted ? '#ff6b6b' : '#888',
                  )}>Refuse</button>
              </div>
            </div>
            <p style={descStyle}>
              Remember your settings, such as dark or light mode, and personalize the
              content you see.
            </p>
          </div>

          {/* ── Forum cookies ── */}
          <div style={categoryBox('#1a1a2e', '#2a2a4a')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '.9rem' }}>
                💬 Forum cookies
              </span>
              <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                <span style={optionalBadge}>OPTIONAL</span>
                <button onClick={() => setForumAccepted(true)}
                  style={inlineBtn(
                    forumAccepted ? '#1a3a1a' : '#1a1a2e',
                    forumAccepted ? '#2a6a2a' : '#2a2a4a',
                    forumAccepted ? '#6bff6b' : '#888',
                  )}>Accept</button>
                <button onClick={() => setForumAccepted(false)}
                  style={inlineBtn(
                    !forumAccepted ? '#3a1a1a' : '#1a1a2e',
                    !forumAccepted ? '#6a2a2a' : '#2a2a4a',
                    !forumAccepted ? '#ff6b6b' : '#888',
                  )}>Refuse</button>
              </div>
            </div>
            <p style={descStyle}>
              Remember which forum posts you have already read.
            </p>
          </div>
        </div>

        {/* Explanation */}
        <p style={{
          color: '#999', fontSize: '.78rem', lineHeight: 1.6,
          margin: '0 0 1.25rem', textAlign: 'center',
        }}>
          You can refuse the optional cookies and still use the Lajtner Code.
          If you refuse the strictly necessary cookies, the Lajtner Code will
          not work. By clicking "Accept All", you consciously agree to our use
          of all cookies. For details, see our{' '}
          <a href={termsUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: '#4a90d9', textDecoration: 'none' }}>
            Privacy Policy
          </a>.
        </p>

        {/* Bottom action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
          <button onClick={acceptAll} style={{
            background: '#4a90d9', color: '#fff', border: 'none',
            padding: '.8rem', borderRadius: 10, fontSize: '.95rem',
            fontWeight: 700, cursor: 'pointer',
          }}>
            Accept All
          </button>
          <div style={{ display: 'flex', gap: '.45rem' }}>
            <button onClick={rejectOptional} style={{
              flex: 1, background: '#2a2a3e', color: '#ccc',
              border: '1px solid #3a3a5a', padding: '.7rem',
              borderRadius: 10, fontSize: '.85rem', fontWeight: 600,
              cursor: 'pointer',
            }}>
              Reject Optional
            </button>
            <button onClick={refuseEssential} style={{
              flex: 1, background: '#1a1a1a', color: '#ff6b6b',
              border: '1px solid #3a2020', padding: '.7rem',
              borderRadius: 10, fontSize: '.85rem', fontWeight: 600,
              cursor: 'pointer',
            }}>
              Reject All
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 10000,
  background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1rem',
}

const panelStyle = {
  background: '#16162a', border: '1px solid #2a2a4a',
  borderRadius: 16, maxWidth: 540, width: '100%',
  padding: '2rem', color: '#e0e0e0',
  maxHeight: '90vh', overflowY: 'auto',
}

const categoryBox = (bg, border) => ({
  background: bg, border: `1px solid ${border}`,
  borderRadius: 10, padding: '.85rem',
})

const descStyle = {
  margin: '.4rem 0 0', fontSize: '.78rem', color: '#aaa', lineHeight: 1.6,
}

const optionalBadge = {
  fontSize: '.6rem', fontWeight: 600, color: '#4a90d9',
  background: 'rgba(74,144,217,.1)', border: '1px solid rgba(74,144,217,.2)',
  borderRadius: 4, padding: '.1rem .35rem',
}

const inlineBtn = (bg, border, color) => ({
  background: bg, border: `1px solid ${border}`, color,
  padding: '.25rem .6rem', borderRadius: 6, fontSize: '.72rem',
  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
})

// ── CookieGate — wraps the app ────────────────────────────────────────────────
const PUBLIC_PATHS = ['/store', '/faq', '/delete-account', '/login']

export function CookieGate({ children }) {
  const [consent, setConsent] = useState(() => getConsent())

  if (!consent) {
    return <CookieConsent onConsented={setConsent} />
  }

  if (!consent.essential) {
    const path = window.location.pathname.replace(/^\/kinetic/, '')
    const isPublic = PUBLIC_PATHS.some(p => path.startsWith(p)) || path === '/'
    if (!isPublic) {
      return (
        <div style={{
          minHeight: '100vh', background: '#0d0d1a', color: '#e0e0e0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '2rem', fontFamily: 'system-ui',
        }}>
          <div style={{
            background: '#16162a', border: '1px solid #2a2a4a',
            borderRadius: 16, maxWidth: 440, width: '100%',
            padding: '2rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🔒</div>
            <h2 style={{ color: '#fff', margin: '0 0 .5rem', fontSize: '1.1rem' }}>
              Cookies Required
            </h2>
            <p style={{ color: '#aaa', fontSize: '.88rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
              You have rejected all cookies. The Lajtner Code cannot work without
              strictly necessary cookies. The shop and support remain available.
            </p>
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => {
                try { localStorage.removeItem(CONSENT_KEY) } catch {}
                setConsent(null)
              }} style={{
                background: '#4a90d9', color: '#fff', border: 'none',
                padding: '.6rem 1.2rem', borderRadius: 8, fontSize: '.88rem',
                fontWeight: 600, cursor: 'pointer',
              }}>
                Change Cookie Settings
              </button>
              <a href={window.location.pathname.replace(/\/[^/]*$/, '/store')}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  background: '#2a2a3e', color: '#ccc', border: '1px solid #3a3a5a',
                  padding: '.6rem 1.2rem', borderRadius: 8, fontSize: '.88rem',
                  fontWeight: 600, textDecoration: 'none',
                }}>
                Go to Store
              </a>
            </div>
          </div>
        </div>
      )
    }
  }

  return children
}

// ── CookieSettings — for Settings page ────────────────────────────────────────
export function CookieSettings() {
  const [consent, setConsent] = useState(() => getConsent())
  const [confirmRejectAll, setConfirmRejectAll] = useState(false)

  if (!consent) return null

  const updateConsent = (updates) => {
    const updated = {
      ...consent,
      ...updates,
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
    }
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(updated))
    } catch {}
    setConsent(updated)
    if (updates.essential === true && !consent.essential) {
      window.location.reload()
    }
  }

  const togglePref  = () => updateConsent({ preference: !consent.preference })
  const toggleForum = () => updateConsent({ forum: !consent.forum })

  const handleRejectAll = () => {
    if (!confirmRejectAll) { setConfirmRejectAll(true); return }
    updateConsent({ essential: false, preference: false, forum: false })
    setConfirmRejectAll(false)
    window.location.reload()
  }

  const handleAcceptAll = () => updateConsent({ essential: true, preference: true, forum: true })

  const resetConsent = () => {
    try { localStorage.removeItem(CONSENT_KEY) } catch {}
    window.location.reload()
  }

  const toggleStyle = (on) => ({
    background: on ? 'var(--green, #00ff88)' : 'var(--bg, #0d0d1a)',
    color: on ? '#000' : 'var(--muted, #888)',
    border: `1px solid ${on ? 'var(--green, #00ff88)' : 'var(--border, #2a2a4a)'}`,
    padding: '.2rem .6rem', borderRadius: 4, fontSize: '.75rem',
    fontWeight: 600, cursor: 'pointer', minWidth: 40,
  })

  return (
    <div style={{
      background: 'var(--bg2, #16162a)', borderRadius: 12, padding: '1rem',
      border: '1px solid var(--border, #2a2a4a)', marginBottom: '1rem',
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text, #fff)', marginBottom: '.75rem' }}>
        🔒 Cookie Settings
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <div style={settingsRow}>
          <span style={{ color: 'var(--text, #fff)' }}>🔒 Strictly necessary</span>
          <span style={{ color: 'var(--green, #6bff6b)', fontWeight: 600, fontSize: '.75rem' }}>
            {consent.essential ? 'Accepted' : 'Rejected'}
          </span>
        </div>
        <div style={settingsRow}>
          <span style={{ color: 'var(--text, #fff)' }}>⚙️ Preference cookies</span>
          <button onClick={togglePref} disabled={!consent.essential} style={toggleStyle(consent.preference)}>
            {consent.preference ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={settingsRow}>
          <span style={{ color: 'var(--text, #fff)' }}>💬 Forum cookies</span>
          <button onClick={toggleForum} disabled={!consent.essential} style={toggleStyle(consent.forum)}>
            {consent.forum ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      <div style={{
        display: 'flex', gap: '.5rem', marginTop: '.75rem',
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <button onClick={handleAcceptAll} style={{
          background: 'none', border: '1px solid var(--border, #2a2a4a)',
          color: 'var(--green, #00ff88)', borderRadius: 6, padding: '.3rem .8rem',
          fontSize: '.78rem', cursor: 'pointer', fontWeight: 600,
        }}>Accept All</button>
        <button onClick={handleRejectAll} style={{
          background: 'none', border: '1px solid rgba(255,68,68,.3)',
          color: 'var(--red, #ff4444)', borderRadius: 6, padding: '.3rem .8rem',
          fontSize: '.78rem', cursor: 'pointer', fontWeight: 600,
        }}>{confirmRejectAll ? 'Confirm Reject All?' : 'Reject All'}</button>
        <button onClick={resetConsent} style={{
          background: 'none', border: 'none', color: 'var(--muted, #888)',
          fontSize: '.72rem', cursor: 'pointer', textDecoration: 'underline', marginLeft: 'auto',
        }}>Reset & show banner</button>
      </div>
      <div style={{ marginTop: '.6rem', fontSize: '.72rem', color: 'var(--dim, #555)' }}>
        Consent given: {new Date(consent.timestamp).toLocaleDateString()}
        {!consent.essential && (
          <span style={{ color: 'var(--red, #ff4444)', marginLeft: '.5rem', fontWeight: 600 }}>
            All cookies rejected — Lajtner Code is locked
          </span>
        )}
      </div>
    </div>
  )
}

const settingsRow = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '.5rem .7rem', borderRadius: 6,
  background: 'var(--bg3, #1a1a2e)', fontSize: '.88rem',
}

// ── CookieSettingsLink — for footer ───────────────────────────────────────────
export function CookieSettingsLink({ style }) {
  const openSettings = () => {
    try { localStorage.removeItem(CONSENT_KEY) } catch {}
    window.location.reload()
  }
  return (
    <button onClick={openSettings} style={{
      background: 'none', border: 'none', color: 'var(--dim, #555)',
      cursor: 'pointer', fontSize: '.75rem', textDecoration: 'underline',
      padding: 0, ...style,
    }}>
      Cookie settings
    </button>
  )
}