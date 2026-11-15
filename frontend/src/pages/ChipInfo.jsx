import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const SERIES_COLORS = {
  pioneer:  { bg: 'rgba(255,136,0,.12)', border: 'rgba(255,136,0,.4)', text: 'var(--amber)' },
  spectrum: { bg: 'rgba(0,200,255,.12)', border: 'rgba(0,200,255,.4)', text: 'var(--blue)' },
  founder:  { bg: 'rgba(160,120,255,.12)', border: 'rgba(160,120,255,.4)', text: '#a078ff' },
  core:     { bg: 'rgba(0,255,136,.12)', border: 'rgba(0,255,136,.4)', text: 'var(--green)' },
  unknown:  { bg: 'rgba(128,128,128,.12)', border: 'rgba(128,128,128,.4)', text: 'var(--muted)' },
}

function parseSeries(serial) {
  const s = (serial || '').toLowerCase()
  if (s.includes('pioneer'))  return 'pioneer'
  if (s.includes('spectrum')) return 'spectrum'
  if (s.includes('founder'))  return 'founder'
  if (s.includes('core'))     return 'core'
  return 'unknown'
}

function ChipCard({ chip }) {
  const c = SERIES_COLORS[chip.series] || SERIES_COLORS.unknown
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '1.5rem', marginBottom: '1rem', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: c.border,
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
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{chip.serial || '—'}</div>
        </div>
      </div>
      {/* chip name = serial */}
      {chip.serial && (
        <div style={{
          fontSize: '1.1rem', fontWeight: 600, color: 'var(--fg)',
          marginBottom: '1rem', padding: '.6rem .8rem',
          background: c.bg, borderRadius: 8, border: `1px solid ${c.border}`,
        }}>
          {chip.serial}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem .8rem' }}>
        <InfoRow label="UID" value={chip.uid} mono />
        <InfoRow label="Tap counter" value={chip.last_counter != null ? chip.last_counter : '—'} />
        <InfoRow label="Activated"
          value={chip.activated_at ? new Date(chip.activated_at).toLocaleDateString() : '—'} />
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
        fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all',
      }}>{value}</div>
    </div>
  )
}

export default function ChipInfo() {
  const { user } = useAuth()
  const [chip, setChip]       = useState(null)   // null=loading, false=none
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)

  // On mount: ask /chip/status by email → get uid → load chip info from tags
  useEffect(() => {
    if (!user?.email) { setLoading(false); return }
    setLoading(true)
    fetch(`${API}/chip/status?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : {})
      .then(d => {
        if (d.uid) {
          return fetch(`${API}/chip/info?uid=${encodeURIComponent(d.uid)}`)
            .then(r => r.ok ? r.json() : {})
            .then(info => {
              if (info.found && info.chips?.length) {
                setChip(info.chips[0])
              } else {
                // uid known but not in tags — show basic info
                setChip({ uid: d.uid, serial: '', series: 'unknown' })
              }
            })
        } else {
          setChip(false)
        }
      })
      .catch(() => setError('Could not reach server.'))
      .finally(() => setLoading(false))
  }, [user?.email])

  const box = { maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }

  return (
    <div style={box}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem' }}>
        <span style={{ fontSize: '1.4rem' }}>📟</span> My Chip
      </h2>

      {error && <p style={{ color: 'var(--red)', fontSize: '.85rem' }}>{error}</p>}

      {loading && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Loading...</p>
      )}

      {!loading && chip && (
        <ChipCard chip={chip} />
      )}

      {!loading && chip === false && !error && (
        <div style={{
          textAlign: 'center', padding: '2.5rem 1rem',
          background: 'var(--bg2)', borderRadius: 14, border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>📟</div>
          <p style={{ color: 'var(--muted)', fontWeight: 600 }}>No chip linked yet</p>
          <p style={{ color: 'var(--dim)', fontSize: '.82rem', maxWidth: 340, margin: '.5rem auto 0' }}>
            Tap your NFC chip on this device to link it to your account.
            After that, your chip info will appear here automatically.
          </p>
        </div>
      )}
    </div>
  )
}