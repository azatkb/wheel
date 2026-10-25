import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']

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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem .8rem' }}>
        <InfoRow label="UID" value={chip.uid} mono />
        <InfoRow label="Tap counter" value={chip.last_counter != null ? chip.last_counter : '—'} />
        <InfoRow label="Owner" value={chip.owner || chip.account_email || 'not assigned'} />
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
  const [chips, setChips]       = useState(null)  // null=idle, []=empty
  const [error, setError]       = useState('')
  const [manualUid, setManualUid] = useState('')
  const [loading, setLoading]   = useState(false)
  const [source, setSource]     = useState('')     // 'tap' | 'search' | 'all'

  const master = user?.email && MASTER_EMAILS.includes(user.email.toLowerCase())

  // On mount: check chip_auth for this user's last tapped UID,
  // or sessionStorage as fallback; master sees all chips
  useEffect(() => {
    if (!user?.email) return

    // 1) try sessionStorage (instant, from current session tap)
    let localUid = null
    try {
      const d = JSON.parse(sessionStorage.getItem('wt_device_auth') || '{}')
      if (d.authorized && d.uid) localUid = d.uid
    } catch {}

    if (localUid) {
      lookupUid(localUid, 'tap')
      return
    }

    // 2) ask server — chip_auth stores uid from the last tap (persists across sessions)
    fetch(`${API}/chip/status?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : {})
      .then(d => {
        if (d.uid) {
          lookupUid(d.uid, 'tap')
        } else if (master) {
          loadAll()
        }
      })
      .catch(() => { if (master) loadAll() })
  }, [user?.email, master])

  async function lookupUid(uid, src) {
    setError(''); setLoading(true); setSource(src || 'search')
    try {
      const r = await fetch(`${API}/chip/info?uid=${encodeURIComponent(uid)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setChips(d.found ? d.chips : [])
    } catch (e) {
      setError(`Could not reach server: ${e.message}`)
      setChips([])
    } finally { setLoading(false) }
  }

  async function loadAll() {
    setError(''); setLoading(true); setSource('all')
    try {
      const token = 'wt_master_2026'
      const r = await fetch(
        `${API}/master/chips?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      const list = (d.chips || []).map(row => ({
        ...row,
        series: parseSeries(row.serial),
        owner: row.account_email || null,
      }))
      setChips(list)
    } catch (e) {
      setError(`Could not load chips: ${e.message}`)
      setChips([])
    } finally { setLoading(false) }
  }

  function handleManual(e) {
    e.preventDefault()
    const v = manualUid.trim().toUpperCase()
    if (v.length >= 4) lookupUid(v, 'search')
  }

  const box = { maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }

  return (
    <div style={box}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem' }}>
        <span style={{ fontSize: '1.4rem' }}>📟</span> Chip Identifier
      </h2>
      <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1.5rem' }}>
        {source === 'tap'
          ? 'Showing chip detected from your last tap.'
          : 'Enter a chip UID to look up its details, or tap your NFC chip on this device.'}
      </p>

      {/* UID lookup */}
      <form onSubmit={handleManual} style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem' }}>
        <input type="text" placeholder="Enter chip UID (e.g. 04A1420ABD2390)"
          value={manualUid} onChange={e => setManualUid(e.target.value)}
          style={{
            flex: 1, padding: '.55rem .75rem', background: 'var(--bg2)',
            border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)',
            fontFamily: 'monospace', fontSize: '.85rem',
          }} />
        <button type="submit" className="btn btn-primary" disabled={loading}
          style={{ padding: '.55rem 1rem', whiteSpace: 'nowrap' }}>
          {loading ? '...' : 'Look up'}
        </button>
      </form>

      {error && <p style={{ color: 'var(--red)', fontSize: '.85rem', marginBottom: '1rem' }}>{error}</p>}

      {loading && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Loading...</p>
      )}

      {/* results */}
      {!loading && chips !== null && chips.length > 0 && (
        <>
          {source === 'all' && (
            <p style={{ color: 'var(--dim)', fontSize: '.78rem', marginBottom: '.5rem' }}>
              {chips.length} registered chip(s)
            </p>
          )}
          {chips.map(c => <ChipCard key={c.uid} chip={c} />)}
        </>
      )}

      {/* searched but nothing found */}
      {!loading && chips !== null && chips.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '2.5rem 1rem',
          background: 'var(--bg2)', borderRadius: 14, border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>🏷</div>
          <p style={{ color: 'var(--muted)' }}>
            {source === 'all' ? 'No chips registered yet.' : 'No chip found for this UID.'}
          </p>
          <p style={{ color: 'var(--dim)', fontSize: '.82rem' }}>
            {source === 'all'
              ? 'Write chips with write_chips.py, then they will appear here.'
              : 'Check the UID and try again, or tap your NFC chip on this device.'}
          </p>
        </div>
      )}

      {/* idle — no search yet, no tap */}
      {!loading && chips === null && !error && (
        <div style={{
          textAlign: 'center', padding: '2.5rem 1rem',
          background: 'var(--bg2)', borderRadius: 14, border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>📟</div>
          <p style={{ color: 'var(--muted)', fontWeight: 600 }}>Chip Number Identifier</p>
          <p style={{ color: 'var(--dim)', fontSize: '.82rem', maxWidth: 340, margin: '.5rem auto 0' }}>
            Enter a chip UID above to see its series, serial number, owner and tap history.
            Or tap your NFC chip on this phone to identify it automatically.
          </p>
        </div>
      )}
    </div>
  )
}