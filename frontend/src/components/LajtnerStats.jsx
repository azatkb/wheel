import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// Averages of Lajtner Time (lower is better) and Lajtner Jerk (higher is better).
//   Your own average  -> Pro + Ultimate
//   All-users average -> Ultimate only
// Fetched once per session (module cache) to avoid refetching on every result.
let _cache = null
let _cacheKey = null

const fmtT = (v) => (v != null ? `${(+v).toFixed(3)} s` : '—')
const fmtJ = (v) => {
  if (v == null) return '—'
  const exp = Math.floor(Math.log10(Math.abs(v)))
  const man = (v / Math.pow(10, exp)).toFixed(2)
  return `${man}×10${sup(exp)} °/s³`
}
// tiny superscript helper
const SUP = { '-': '⁻', 0:'⁰',1:'¹',2:'²',3:'³',4:'⁴',5:'⁵',6:'⁶',7:'⁷',8:'⁸',9:'⁹' }
function sup(n) { return String(n).split('').map(c => SUP[c] ?? c).join('') }

function Row({ label, time, jerk }) {
  return (
    <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',justifyContent:'space-between',
      alignItems:'center',padding:'.5rem .75rem',borderRadius:8,
      background:'rgba(255,136,0,.06)',marginTop:'.4rem'}}>
      <span style={{color:'var(--muted)',fontSize:'.78rem',minWidth:110}}>{label}</span>
      <span style={{color:'var(--amber)',fontSize:'.82rem'}}>⏳ {fmtT(time)}</span>
      <span style={{color:'var(--amber)',fontSize:'.82rem'}}>🌀 {fmtJ(jerk)}</span>
    </div>
  )
}

export default function LajtnerStats() {
  const { user } = useAuth()
  const plan = (user?.plan || 'basic').toLowerCase()
  const isPaid = plan === 'pro' || plan === 'ultimate'
  const isUltimate = plan === 'ultimate'
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!isPaid || !user?.email) return
    if (_cacheKey === user.email && _cache) { setData(_cache); return }
    ;(async () => {
      try {
        const r = await fetch(`${API}/api/lajtner-averages?email=${encodeURIComponent(user.email)}`)
        const d = await r.json()
        _cache = d; _cacheKey = user.email
        setData(d)
      } catch {}
    })()
  }, [isPaid, isUltimate, user?.email])

  if (!isPaid || !data) return null
  const hasUser = data.user && (data.user.avg_time_s != null || data.user.avg_jerk_deg != null)
  const hasAll  = data.all  && (data.all.avg_time_s  != null || data.all.avg_jerk_deg  != null)
  if (!hasUser && !hasAll) return null

  return (
    <div style={{marginTop:'.75rem'}}>
      <div style={{fontSize:'.7rem',color:'var(--dim)',textTransform:'uppercase',
        letterSpacing:'.05em',marginBottom:'.15rem'}}>
        Lajtner averages · Time: lower is better · Jerk: higher is better
      </div>
      {hasUser && (
        <Row label={`You · ${data.user?.count || 0}`}
          time={data.user?.avg_time_s} jerk={data.user?.avg_jerk_deg} />
      )}
      {isUltimate && hasAll && (
        <Row label={`All users · ${data.all?.count || 0}`}
          time={data.all?.avg_time_s} jerk={data.all?.avg_jerk_deg} />
      )}
    </div>
  )
}
