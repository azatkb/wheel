import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// Lajtner Resonance formatter: 1.64e25 → 1.64L+25R
const fmtLR = (v) => {
  if (!v || v <= 0) return '—'
  const exp = Math.floor(Math.log10(v))
  const man = (v / Math.pow(10, exp)).toFixed(2)
  return `${man}L${exp >= 0 ? '+' : ''}${exp}R`
}

// A single, sortable, one-column comparison list of every measurement's
// Lajtner Resonance (from min to max). Anonymous — values only, no emails.
export default function ResonanceList() {
  const { user } = useAuth()
  const [values, setValues] = useState([])
  const [stats, setStats]   = useState({})
  const [mine, setMine]     = useState([])   // this user's own resonance values (to highlight)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/resonance-list?limit=2000`)
        const d = await r.json()
        setValues(d.values || [])
        setStats(d.stats || {})
      } catch {}
      // fetch the user's own measurements to mark them in the list
      try {
        if (user?.email) {
          const rj = await fetch(`${API}/api/jobs?limit=500&email=${encodeURIComponent(user.email)}`)
          const dj = await rj.json()
          const my = (dj.jobs || [])
            .map(j => j?.physics?.air?.planck_freq)
            .filter(v => v && v > 0)
          setMine(my)
        }
      } catch {}
      setLoading(false)
    })()
  }, [user?.email])

  const isMine = (v) => mine.some(m => Math.abs(m - v) / v < 1e-6)

  return (
    <div>
      <div className="page-header">
        <h1>Lajtner Resonance — Everyone</h1>
        <p>Every measurement, from lowest to highest. See where you stand.</p>
      </div>

      {loading ? (
        <div className="card" style={{color:'var(--muted)'}}>Loading…</div>
      ) : values.length === 0 ? (
        <div className="card" style={{color:'var(--muted)'}}>No measurements yet.</div>
      ) : (
        <>
          {/* Min / Average / Max summary (the "lines" from the diagram) */}
          <div className="card" style={{display:'flex',gap:'1.5rem',flexWrap:'wrap',justifyContent:'space-around'}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MIN</div>
              <div style={{fontSize:'1.2rem',fontWeight:700,color:'var(--blue)'}}>{fmtLR(stats.min)}</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'.7rem',color:'var(--muted)'}}>AVERAGE</div>
              <div style={{fontSize:'1.2rem',fontWeight:700,color:'var(--amber)'}}>{fmtLR(stats.avg)}</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MAX</div>
              <div style={{fontSize:'1.2rem',fontWeight:700,color:'var(--green)'}}>{fmtLR(stats.max)}</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MEASUREMENTS</div>
              <div style={{fontSize:'1.2rem',fontWeight:700,color:'var(--text)'}}>{stats.count}</div>
            </div>
          </div>

          {/* Single column, min → max (endpoint returns ascending) */}
          <div className="card">
            <div style={{maxHeight:520,overflowY:'auto'}}>
              {values.map((v, i) => {
                const frac = stats.max > stats.min ? (v - stats.min) / (stats.max - stats.min) : 0
                const me = isMine(v)
                return (
                  <div key={i} style={{
                    display:'flex',alignItems:'center',gap:'.75rem',
                    padding:'.35rem .6rem',
                    borderBottom:'1px solid rgba(30,42,56,.4)',
                    background: me ? 'rgba(0,255,136,.10)' : 'transparent',
                  }}>
                    <span style={{color:'var(--muted)',fontSize:'.72rem',minWidth:44,fontFamily:'var(--font-mono)'}}>#{i+1}</span>
                    <div style={{flex:1,height:8,background:'var(--bg3)',borderRadius:4,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${Math.max(2, frac*100)}%`,
                        background: me ? 'var(--green)' : 'linear-gradient(90deg,var(--blue),var(--green))'}} />
                    </div>
                    {me && <span style={{fontSize:'.68rem',color:'var(--green)',fontWeight:700}}>YOU</span>}
                    <span style={{fontFamily:'var(--font-mono)',fontSize:'.8rem',
                      color: me ? 'var(--green)' : 'var(--amber)',minWidth:96,textAlign:'right'}}>{fmtLR(v)}</span>
                  </div>
                )
              })}
            </div>
            <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:'.5rem'}}>
              Resonance is compared on a common (air) basis so every measurement is on the same scale.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
