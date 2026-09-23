import { useState, useEffect } from 'react'
import { useDeviceAuth } from '../hooks/useDeviceAuth'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// Set to true to require an NFC tap / laptop pairing. false = open access.
const DEVICE_GATE_ENABLED = true

// Master accounts never need the chip — they always pass the gate.
const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e || '').toLowerCase())

// The phone opens this URL after scanning the QR (React route /pair).
const PAIR_URL_BASE = 'https://mindpw.com/kinetic/pair'

// Rough "is this a phone?" check — phones can tap NFC; laptops need the QR flow.
function isPhone() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/**
 * Gate the measurement UI:
 *   - phones  -> "Tap your device" (NFC)
 *   - laptops -> show a QR code; user scans it with an already-authorized phone
 *   - master  -> always allowed
 */
export default function DeviceGate({ children }) {
  const { user } = useAuth()
  if (!DEVICE_GATE_ENABLED) return children
  if (isMaster(user?.email)) return children
  const { deviceAuthorized, checking } = useDeviceAuth()

  if (checking) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <div style={{ color: 'var(--muted)' }}>Verifying your device…</div>
      </div>
    )
  }
  if (deviceAuthorized) return children

  // Laptop / desktop -> QR pairing
  if (!isPhone()) return <LaptopQR />

  // Phone -> tap NFC
  return (
    <div className="card" style={{ textAlign: 'center', padding: '2.25rem 1.5rem' }}>
      <div style={{ fontSize: '2.4rem', marginBottom: '.5rem' }}>📟</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '.4rem' }}>
        Tap your device to begin
      </div>
      <p style={{ color: 'var(--muted)', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
        Hold your phone to the secure tag on the product box. Your browser will open
        and unlock the measurement automatically — this confirms you are using a
        genuine device.
      </p>
      <p style={{ color: 'var(--dim)', fontSize: '.8rem', marginTop: '1rem' }}>
        No NFC prompt? Make sure NFC is enabled on your phone and the tag is near the back of the device.
      </p>
    </div>
  )
}

// -- Laptop QR panel --------------------------------------------------------
function LaptopQR() {
  const [pairId, setPairId] = useState(null)
  const [status, setStatus] = useState('loading')   // loading | waiting | expired | error
  const [qrUrl, setQrUrl] = useState('')

  const start = async () => {
    setStatus('loading')
    try {
      const r = await fetch(`${API}/pair/new`, { method: 'POST' })
      const d = await r.json()
      setPairId(d.pair_id)
      const url = `${PAIR_URL_BASE}?pid=${encodeURIComponent(d.pair_id)}`
      setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`)
      setStatus('waiting')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => { start() }, [])

  useEffect(() => {
    if (status !== 'waiting' || !pairId) return
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${API}/pair/status?pid=${encodeURIComponent(pairId)}`)
        const d = await r.json()
        if (d.authorized && d.token) {
          clearInterval(t)
          try {
            sessionStorage.setItem('wt_device_auth', JSON.stringify({
              authorized: true, laptop: true, token: d.token, email: d.email, ts: Date.now()
            }))
          } catch {}
          window.location.reload()
        } else if (d.expired) {
          clearInterval(t); setStatus('expired')
        }
      } catch {/* keep polling */}
    }, 2500)
    return () => clearInterval(t)
  }, [status, pairId])

  return (
    <div className="card" style={{ textAlign: 'center', padding: '2.25rem 1.5rem' }}>
      <div style={{ fontSize: '2rem', marginBottom: '.3rem' }}>🔗</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '.4rem' }}>
        Authorize this laptop
      </div>
      <p style={{ color: 'var(--muted)', maxWidth: 420, margin: '0 auto .8rem', lineHeight: 1.6 }}>
        Scan this QR code with your phone to unlock the app on this computer.
      </p>

      {status === 'waiting' && qrUrl && (
        <>
          <div style={{ background: '#fff', display: 'inline-block', padding: '.8rem', borderRadius: 12 }}>
            <img src={qrUrl} alt="Pairing QR" width={220} height={220} style={{ display: 'block' }} />
          </div>
          <ol style={{ textAlign: 'left', maxWidth: 360, margin: '1rem auto', color: 'var(--text)', fontSize: '.88rem', lineHeight: 1.7 }}>
            <li>Open the app on your <strong>phone</strong> and tap your chip.</li>
            <li>Tap <strong>"Authorize laptop"</strong>.</li>
            <li>Scan this code — this laptop unlocks automatically.</li>
          </ol>
          <div style={{ color: 'var(--amber)', fontSize: '.85rem' }}>Waiting for your phone…</div>
        </>
      )}

      {status === 'loading' && <div style={{ color: 'var(--muted)' }}>Generating code…</div>}
      {status === 'expired' && (
        <div>
          <p style={{ color: 'var(--red)', marginBottom: '.6rem' }}>This code expired.</p>
          <button className="btn btn-primary" onClick={start}>Generate a new code</button>
        </div>
      )}
      {status === 'error' && (
        <div>
          <p style={{ color: 'var(--red)', marginBottom: '.6rem' }}>Could not reach the server.</p>
          <button className="btn btn-primary" onClick={start}>Try again</button>
        </div>
      )}
    </div>
  )
}