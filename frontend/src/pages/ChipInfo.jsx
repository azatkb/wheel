import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useDeviceAuth } from '../hooks/useDeviceAuth.js'
import { API } from '../config'

const SERIES_COLORS = {
  pioneer:  { bg: 'rgba(255,136,0,.12)', border: 'rgba(255,136,0,.4)', text: 'var(--amber)' },
  spectrum: { bg: 'rgba(0,200,255,.12)', border: 'rgba(0,200,255,.4)', text: 'var(--blue)' },
  founder:  { bg: 'rgba(160,120,255,.12)', border: 'rgba(160,120,255,.4)', text: '#a078ff' },
  core:     { bg: 'rgba(0,255,136,.12)', border: 'rgba(0,255,136,.4)', text: 'var(--green)' },
  unknown:  { bg: 'rgba(128,128,128,.12)', border: 'rgba(128,128,128,.4)', text: 'var(--muted)' },
}

function ChipCard({ chip }) {
  const c = SERIES_COLORS[chip.series] || SERIES_COLORS.unknown

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '1.5rem', marginBottom: '1rem', position: 'relative', overflow: 'hidden',
    }}>
      {/* series accent stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: c.border,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.2rem' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
          background: c.bg, border: `1px solid ${c.border}`,
        }}>
          {chip.series === 'pioneer' ? '🚀' : chip.series === 'spectrum' ? '🌈'
            : chip.series === 'founder' ? '💎' : chip.series === 'core' ? '⚡' : '🏷'}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: c.text }}>
            {chip.series.charAt(0).toUpperCase() + chip.series.slice(1)} Series
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{chip.serial}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem .8rem' }}>
        <InfoRow label="UID" value={chip.uid} mono />
        <InfoRow label="Tap counter" value={chip.last_counter != null ? chip.last_counter : '—'} />
        <InfoRow label="Owner" value={chip.owner || 'not assigned'} />
        <InfoRow label="Activated"
          value={chip.activated_at
            ? new Date(chip.activated_at).toLocaleDateString()
            : '—'} />
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: '.7rem', color: 'var(--dim)', textTransform: 'uppercase',
        letterSpacing: '.04em', marginBottom: '.15rem' }}>{label}</div>
      <div style={{
        fontSize: '.88rem', color: 'var(--fg)',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all',
      }}>{value}</div>
    </div>
  )
}

export default function ChipInfo() {
  const { user } = useAuth()
  const { deviceAuthorized, deviceUid } = useDeviceAuth()
  const [chips, setChips] = useState(null)   // null=loading, []=none
  const [error, setError] = useState('')
  const [manualUid, setManualUid] = useState('')

  // Auto-load: if device is authorized we have the UID from the tap
  useEffect(() => {
    if (deviceAuthorized && deviceUid) {
      loadByUid(deviceUid)
    } else if (user?.email) {
      loadByEmail(user.email)
    }
  }, [deviceAuthorized, deviceUid, user])

  async function loadByUid(uid) {
    setError(''); setChips(null)
    try {
      const r = await fetch(`${API}/chip/info?uid=${encodeURIComponent(uid)}`)
      const d = await r.json()
      setChips(d.found ? d.chips : [])
    } catch { setError('Could not reach server.') }
  }

  async function loadByEmail(email) {
    setError(''); setChips(null)
    try {
      const r = await fetch(`${API}/chip/info?email=${encodeURIComponent(email)}`)
      const d = await r.json()
      setChips(d.found ? d.chips : [])
    } catch { setError('Could not reach server.') }
  }

  function handleManual(e) {
    e.preventDefault()
    const v = manualUid.trim().toUpperCase()
    if (v.length >= 8) loadByUid(v)
  }

  const box = { maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }

  return (
    <div style={box}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem' }}>
        <span style={{ fontSize: '1.4rem' }}>📟</span> My Chip
      </h2>
      <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1.5rem' }}>
        Chip details{deviceAuthorized ? ' (detected from your last tap)' : ' linked to your account'}.
        {!deviceAuthorized && (
          <span> Tap your chip to see details for a specific device.</span>
        )}
      </p>

      {/* Manual UID lookup */}
      <form onSubmit={handleManual} style={{
        display: 'flex', gap: '.5rem', marginBottom: '1.5rem',
      }}>
        <input
          type="text" placeholder="Look up by UID (e.g. 04A1420ABD2390)"
          value={manualUid} onChange={e => setManualUid(e.target.value)}
          style={{
            flex: 1, padding: '.55rem .75rem', background: 'var(--bg2)',
            border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)',
            fontFamily: 'monospace', fontSize: '.85rem',
          }}
        />
        <button type="submit" className="btn btn-primary"
          style={{ padding: '.55rem 1rem', whiteSpace: 'nowrap' }}>
          Look up
        </button>
      </form>

      {error && <p style={{ color: 'var(--red)', fontSize: '.85rem' }}>{error}</p>}

      {chips === null && !error && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Loading...</p>
      )}

      {chips && chips.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '2.5rem 1rem',
          background: 'var(--bg2)', borderRadius: 14, border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>🏷</div>
          <p style={{ color: 'var(--muted)' }}>No chips found.</p>
          <p style={{ color: 'var(--dim)', fontSize: '.82rem' }}>
            Tap your NFC chip on this device, or enter a UID above.
          </p>
        </div>
      )}

      {chips && chips.length > 0 && chips.map(c => (
        <ChipCard key={c.uid} chip={c} />
      ))}
    </div>
  )
}
