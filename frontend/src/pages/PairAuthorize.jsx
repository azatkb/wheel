import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useDeviceAuth } from '../hooks/useDeviceAuth'
import { API } from '../config'

/**
 * Phone-side page for authorizing a laptop.
 * The phone opens this after scanning the QR on the laptop:
 *   https://mindpw.com/kinetic/pair?pid=<pair_id>
 *
 * The user must be (a) logged in and (b) chip-authorized on this phone.
 * Tapping "Authorize this laptop" tells the server to unlock that laptop.
 */
export default function PairAuthorize() {
  const { user } = useAuth()
  const { deviceAuthorized } = useDeviceAuth()
  const [pairId, setPairId] = useState('')
  const [state, setState] = useState('idle')   // idle | working | done | error
  const [error, setError] = useState('')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('pid')
    setPairId(p || '')
  }, [])

  const authorize = async () => {
    setState('working'); setError('')
    try {
      const r = await fetch(`${API}/pair/authorize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair_id: pairId, email: user.email })
      })
      const d = await r.json()
      if (r.ok && d.ok) setState('done')
      else { setState('error'); setError(d.detail || 'Could not authorize the laptop.') }
    } catch {
      setState('error'); setError('Network error. Please try again.')
    }
  }

  const box = { maxWidth: 420, margin: '2rem auto', padding: '1.5rem',
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, textAlign: 'center' }

  if (!pairId) return (
    <div style={box}>
      <h2>Authorize a laptop</h2>
      <p style={{ color: 'var(--muted)' }}>No pairing code found. On your laptop, open the
        “Authorize this laptop” page and scan the QR code with your phone.</p>
    </div>
  )

  if (!user) return (
    <div style={box}>
      <h2>Please sign in</h2>
      <p style={{ color: 'var(--muted)' }}>Sign in on this phone first, then scan the laptop QR again.</p>
    </div>
  )

  if (!deviceAuthorized) return (
    <div style={box}>
      <h2>Tap your chip first</h2>
      <p style={{ color: 'var(--muted)' }}>To authorize a laptop, first tap your chip on this phone to
        confirm you own the device, then scan the laptop QR again.</p>
    </div>
  )

  return (
    <div style={box}>
      <h2>🔗 Authorize this laptop</h2>
      {state === 'done' ? (
        <div>
          <div style={{ fontSize: '2.4rem', color: 'var(--green)', margin: '.5rem 0' }}>✓</div>
          <p style={{ color: 'var(--green)', fontWeight: 600 }}>Laptop authorized!</p>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>Your laptop will unlock automatically.
            You can close this page.</p>
          <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginTop: '1rem' }}>
            Note: only one laptop stays authorized at a time — authorizing a new one signs the previous out.</p>
        </div>
      ) : (
        <div>
          <p style={{ color: 'var(--muted)' }}>You're signed in as <strong>{user.email}</strong> and your chip is
            verified on this phone. Tap below to unlock the app on the laptop that showed the QR code.</p>
          <button onClick={authorize} disabled={state === 'working'}
            className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
            {state === 'working' ? 'Authorizing…' : 'Authorize this laptop'}
          </button>
          {error && <p style={{ color: 'var(--red)', fontSize: '.85rem', marginTop: '.7rem' }}>{error}</p>}
        </div>
      )}
    </div>
  )
}
