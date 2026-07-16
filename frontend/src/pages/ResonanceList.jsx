import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// ── formatters ───────────────────────────────────────────────────────
// Lajtner Resonance: 1.64e25 -> 1.64L+25R
const fmtLR = (v) => {
  if (!v || v <= 0) return '—'
  const exp = Math.floor(Math.log10(v))
  const man = (v / Math.pow(10, exp)).toFixed(2)
  return `${man}L${exp >= 0 ? '+' : ''}${exp}R`
}
const fmtTime = (v) => (v != null ? `${(+v).toFixed(3)} s` : '—')
const SUP = { '-': '⁻', 0:'⁰',1:'¹',2:'²',3:'³',4:'⁴',5:'⁵',6:'⁶',7:'⁷',8:'⁸',9:'⁹' }
const sup = (n) => String(n).split('').map(c => SUP[c] ?? c).join('')
const fmtJerk = (v) => {
  if (v == null || v === 0) return '—'
  const exp = Math.floor(Math.log10(Math.abs(v)))
  const man = (v / Math.pow(10, exp)).toFixed(2)
  return `${man}×10${sup(exp)} °/s³`
}

// ── one metric block: min/avg/max cards + a sorted min→max bar list ───
function MetricSection({ title, hint, fmt, pack, barColor }) {
  const values = pack?.values || []
  const stats = pack?.stats || {}
  if (!values.length) {
    return (
      <div className="card" style={{marginTop:'1rem'}}>
        <div style={{fontWeight:700,marginBottom:'.25rem'}}>{title}</div>
        <div style={{color:'var(--muted)',fontSize:'.85rem'}}>No data yet.</div>
      </div>
    )
  }
  return (
    <div style={{marginTop:'1.25rem'}}>
      <div style={{display:'flex',alignItems:'baseline',gap:'.6rem',flexWrap:'wrap',marginBottom:'.4rem'}}>
        <span style={{fontWeight:700,fontSize:'1rem'}}>{title}</span>
        {hint && <span style={{fontSize:'.72rem',color:'var(--dim)'}}>{hint}</span>}
      </div>

      {/* min / average / max */}
      <div className="card" style={{display:'flex',gap:'1.5rem',flexWrap:'wrap',
        justifyContent:'space-around',marginBottom:'.6rem'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MIN</div>
          <div style={{fontSize:'1.15rem',fontWeight:700,color:'var(--blue)'}}>{fmt(stats.min)}</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)'}}>AVERAGE</div>
          <div style={{fontSize:'1.15rem',fontWeight:700,color:'var(--amber)'}}>{fmt(stats.avg)}</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MAX</div>
          <div style={{fontSize:'1.15rem',fontWeight:700,color:'var(--green)'}}>{fmt(stats.max)}</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MEASUREMENTS</div>
          <div style={{fontSize:'1.15rem',fontWeight:700,color:'var(--text)'}}>{stats.count}</div>
        </div>
      </div>

      {/* sorted list, min → max */}
      <div className="card">
        <div style={{maxHeight:360,overflowY:'auto'}}>
          {values.map((v, i) => {
            const frac = stats.max > stats.min ? (v - stats.min) / (stats.max - stats.min) : 0
            return (
              <div key={i} style={{display:'flex',alignItems:'center',gap:'.75rem',
                padding:'.32rem .6rem',borderBottom:'1px solid rgba(30,42,56,.4)'}}>
                <span style={{color:'var(--muted)',fontSize:'.72rem',minWidth:44,
                  fontFamily:'var(--font-mono)'}}>#{i+1}</span>
                <div style={{flex:1,height:8,background:'var(--bg3)',borderRadius:4,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${Math.max(2, frac*100)}%`,background:barColor}} />
                </div>
                <span style={{fontFamily:'var(--font-mono)',fontSize:'.8rem',color:'var(--amber)',
                  minWidth:110,textAlign:'right'}}>{fmt(v)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function ResonanceList() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('all')   // 'all' = everyone, 'mine' = just me

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/lajtner-list?email=${encodeURIComponent(user?.email || '')}&limit=2000`)
        setData(await r.json())
      } catch {}
      setLoading(false)
    })()
  }, [user?.email])

  const pick = (metric) => data?.[metric]?.[scope]

  return (
    <div>
      <div className="page-header">
        <h1>Lajtner Values — {scope === 'mine' ? 'Mine' : 'Everyone'}</h1>
        <p>Resonance, Time and Jerk — sorted from lowest to highest. See where you stand.</p>
      </div>

      {/* Mine / Everyone switch */}
      <div style={{display:'flex',gap:'.4rem',marginBottom:'.5rem'}}>
        <button className={`btn btn-sm ${scope==='mine'?'btn-primary':'btn-secondary'}`}
          onClick={() => setScope('mine')}>My measurements</button>
        <button className={`btn btn-sm ${scope==='all'?'btn-primary':'btn-secondary'}`}
          onClick={() => setScope('all')}>All users</button>
      </div>

      {loading ? (
        <div className="card" style={{color:'var(--muted)'}}>Loading…</div>
      ) : !data ? (
        <div className="card" style={{color:'var(--muted)'}}>No data.</div>
      ) : (
        <>
          <MetricSection title="Lajtner Resonance"
            hint="common (air) basis"
            fmt={fmtLR} pack={pick('resonance')}
            barColor="linear-gradient(90deg,var(--blue),var(--green))" />

          <MetricSection title="Lajtner Time"
            hint="lower is better"
            fmt={fmtTime} pack={pick('time')}
            barColor="linear-gradient(90deg,var(--green),var(--blue))" />

          <MetricSection title="Lajtner Jerk"
            hint="higher is better"
            fmt={fmtJerk} pack={pick('jerk')}
            barColor="linear-gradient(90deg,var(--blue),var(--green))" />

          {scope === 'mine' && (!pick('resonance')?.values?.length) && (
            <div className="card" style={{marginTop:'1rem',color:'var(--muted)',fontSize:'.85rem'}}>
              No measurements of yours yet — upload one to see your values here.
            </div>
          )}
        </>
      )}
    </div>
  )
}