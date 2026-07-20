import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// ── formatters ───────────────────────────────────────────────────────
const fmtLR = (v) => {
  if (!v || v <= 0) return '—'
  const e = Math.floor(Math.log10(v))
  return `${(v / Math.pow(10, e)).toFixed(2)}L${e >= 0 ? '+' : ''}${e}R`
}
const fmtLT = (v) => (v != null ? `${(+v).toFixed(3)}` : '—')       // seconds
const SUP = { '-':'⁻',0:'⁰',1:'¹',2:'²',3:'³',4:'⁴',5:'⁵',6:'⁶',7:'⁷',8:'⁸',9:'⁹' }
const sup = (n) => String(n).split('').map(c => SUP[c] ?? c).join('')
const fmtLJ = (v) => {
  if (v == null || v === 0) return '—'
  const e = Math.floor(Math.log10(Math.abs(v)))
  return `${(v / Math.pow(10, e)).toFixed(2)}×10${sup(e)}`
}
const fmtDur = (s) => (s != null ? `${(+s).toFixed(1)}s` : '—')

// metric meta: label, formatter, colour, and "best" direction
const METRICS = {
  LR: { label: 'LR', full: 'Lajtner Resonance', unit: '—',    fmt: fmtLR, color: '#44aaff', bestHigh: true  },
  LT: { label: 'LT', full: 'Lajtner Time',      unit: 's',    fmt: fmtLT, color: '#ff8800', bestHigh: false },
  LJ: { label: 'LJ', full: 'Lajtner Jerk',      unit: '°/s³', fmt: fmtLJ, color: '#00c271', bestHigh: true  },
}

export default function ResonanceList() {
  const { user } = useAuth()
  const plan = (user?.plan || 'basic').toLowerCase()
  // plan gating: Basic = LR · Pro = LR+LT · Ultimate = LR+LT+LJ
  const [data, setData]   = useState(null)
  // plan gating: Basic = LR · Pro = LR+LT · Ultimate/Master = LR+LT+LJ
  const cols = (data?.is_master || plan === 'ultimate') ? ['LR','LT','LJ']
             : plan === 'pro' ? ['LR','LT'] : ['LR']
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('mine')       // 'mine' | 'all'
  const [sortKey, setSortKey] = useState('LR')      // 'LR'|'LT'|'LJ'|'date'|'duration_s'
  const [sortDesc, setSortDesc] = useState(true)    // sort direction
  const [rowMode, setRowMode] = useState('all')     // 'all' | 'top10' | 'bottom10'
  const [selected, setSelected] = useState([])      // selected job_ids
  const [detail, setDetail]   = useState(null)      // { rows, datas: {job_id: data}, loading }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/lr-lt-lj?email=${encodeURIComponent(user?.email || '')}`)
        setData(await r.json())
      } catch {}
      setLoading(false)
    })()
  }, [user?.email])

  const rows = (scope === 'mine' ? data?.mine : data?.all) || []
  const isMaster = !!data?.is_master
  const isMetric = (k) => k === 'LR' || k === 'LT' || k === 'LJ'

  // sort by any column; slice for Best/Worst 10 (metric only, respecting best direction)
  const view = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey]
      if (isMetric(sortKey) || sortKey === 'duration_s') {
        x = (x == null ? -Infinity : x); y = (y == null ? -Infinity : y)
        return sortDesc ? (y - x) : (x - y)
      }
      // string (date / email)
      x = String(x ?? ''); y = String(y ?? '')
      return sortDesc ? y.localeCompare(x) : x.localeCompare(y)
    })
    if (rowMode !== 'all' && isMetric(sortKey)) {
      const best = METRICS[sortKey].bestHigh
      const bestFirst = [...rows].filter(r => r[sortKey] != null)
        .sort((a, b) => best ? (b[sortKey] - a[sortKey]) : (a[sortKey] - b[sortKey]))
      return rowMode === 'top10' ? bestFirst.slice(0, 10) : [...bestFirst].reverse().slice(0, 10)
    }
    return arr
  }, [rows, sortKey, sortDesc, rowMode])

  // per-user averages for the grouped bar charts (matches the reference picture)
  const byUser = useMemo(() => {
    const map = {}
    view.forEach(r => {
      const k = r.email || '—'
      if (!map[k]) map[k] = { email: k, LR: [], LT: [], LJ: [] }
      cols.forEach(c => { if (r[c] != null) map[k][c].push(r[c]) })
    })
    const users = Object.values(map).map(u => ({
      email: u.email,
      LR: u.LR.length ? u.LR.reduce((a,b)=>a+b,0)/u.LR.length : null,
      LT: u.LT.length ? u.LT.reduce((a,b)=>a+b,0)/u.LT.length : null,
      LJ: u.LJ.length ? u.LJ.reduce((a,b)=>a+b,0)/u.LJ.length : null,
    }))
    const max = {}
    cols.forEach(c => { max[c] = Math.max(...users.map(u => u[c] || 0), 1e-30) })
    return { users: users.slice(0, 25), max }   // cap charts at 25 users
  }, [view, cols])

  const setSort = (k) => { setSortKey(k); setSortDesc(d => (sortKey === k ? !d : true)) }
  const arrow = (k) => (sortKey === k ? (sortDesc ? ' ▾' : ' ▴') : '')

  const downloadCSV = () => {
    const head = ['email','date','video_length_s','nickname', ...cols]
    const lines = [head]
    ;(data?.all || []).forEach(r => {
      lines.push([r.email||'', r.date||'', r.duration_s??'', r.nickname||'', ...cols.map(c => r[c] ?? '')])
    })
    const csv = lines.map(l => l.map(c => {
      const s = String(c ?? '')
      return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s
    }).join(';')).join('\r\n')
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'lr_lt_lj_all.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const toggleRow = (row) => {
    if (!row.job_id) return                       // other users' rows: not selectable
    setSelected(sel => sel.includes(row.job_id)
      ? sel.filter(x => x !== row.job_id)
      : [...sel, row.job_id])
  }

  const openDetails = async () => {
    const rows = view.filter(r => r.job_id && selected.includes(r.job_id))
    if (!rows.length) return
    setDetail({ rows, datas: {}, loading: true })
    const datas = {}
    await Promise.all(rows.map(async (row) => {
      try {
        const r = await fetch(`${API}/api/measurement/${row.job_id}?email=${encodeURIComponent(user?.email || '')}`)
        datas[row.job_id] = r.ok ? await r.json() : null
      } catch { datas[row.job_id] = null }
    }))
    setDetail({ rows, datas, loading: false })
  }

  const avg = scope === 'mine' ? data?.avg?.mine : data?.avg?.all
  const showNick = scope === 'mine' || (isMaster && scope === 'all')
  const thStyle = (right, active) => ({padding:'.4rem .6rem',cursor:'pointer',userSelect:'none',
    textAlign: right ? 'right' : 'left', color: active ? 'var(--green)' : 'var(--muted)',
    fontSize:'.68rem',textTransform:'uppercase',whiteSpace:'nowrap'})

  return (
    <div>
      <div className="page-header">
        <h1>LR-LT-LJ — {scope === 'mine' ? 'My values' : 'Everyone'}</h1>
        <p>Lajtner Resonance · Time (lower is better) · Jerk (higher is better).</p>
      </div>

      <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',marginBottom:'.6rem',alignItems:'center'}}>
        <button className={`btn btn-sm ${scope==='mine'?'btn-primary':'btn-secondary'}`} onClick={()=>setScope('mine')}>My results</button>
        <button className={`btn btn-sm ${scope==='all'?'btn-primary':'btn-secondary'}`} onClick={()=>setScope('all')}>All users</button>
        <span style={{flex:1}} />
        {isMaster && <button className="btn btn-sm btn-secondary" onClick={downloadCSV}>⬇ CSV (all, ;)</button>}
      </div>

      {loading ? (
        <div className="card" style={{color:'var(--muted)'}}>Loading…</div>
      ) : !rows.length ? (
        <div className="card" style={{color:'var(--muted)'}}>
          {scope==='mine' ? 'No measurements of yours yet.' : 'No data yet.'}
        </div>
      ) : (
        <>
          {/* averages */}
          <div className="card" style={{display:'flex',gap:'1.25rem',flexWrap:'wrap',justifyContent:'space-around'}}>
            {cols.map(c => (
              <div key={c} style={{textAlign:'center'}}>
                <div style={{fontSize:'.7rem',color:'var(--muted)'}}>{METRICS[c].full} avg</div>
                <div style={{fontSize:'1.05rem',fontWeight:700,color:METRICS[c].color}}>
                  {METRICS[c].fmt(avg?.[c])}{c!=='LR' && avg?.[c]!=null ? ` ${METRICS[c].unit}` : ''}
                </div>
              </div>
            ))}
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'.7rem',color:'var(--muted)'}}>MEASUREMENTS</div>
              <div style={{fontSize:'1.05rem',fontWeight:700}}>{avg?.count ?? 0}</div>
            </div>
          </div>

          {/* row mode */}
          <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',margin:'.6rem 0'}}>
            {[['all','All'],['top10',`Best 10 (${METRICS[sortKey]?.label||sortKey})`],['bottom10',`Worst 10 (${METRICS[sortKey]?.label||sortKey})`]].map(([k,l]) => (
              <button key={k} className={`btn btn-sm ${rowMode===k?'btn-primary':'btn-secondary'}`}
                onClick={()=>setRowMode(k)} disabled={k!=='all' && !isMetric(sortKey)}>{l}</button>
            ))}
            <span style={{color:'var(--muted)',fontSize:'.75rem',alignSelf:'center'}}>{view.length} rows · tap a header to sort</span>
            <span style={{flex:1}} />
            {selected.length > 0 && (
              <>
                <button className="btn btn-sm btn-primary" onClick={openDetails}>
                  🔍 Show details ({selected.length})
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => setSelected([])}>Clear</button>
              </>
            )}
          </div>

          {/* table */}
          <div className="card" style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.78rem',whiteSpace:'nowrap'}}>
              <thead>
                <tr style={{borderBottom:'2px solid var(--border)'}}>
                  <th style={{padding:'.4rem .4rem'}}></th>
                  <th style={{padding:'.4rem .6rem',color:'var(--muted)',fontSize:'.68rem'}}>#</th>
                  <th onClick={()=>setSort('email')} style={thStyle(false, sortKey==='email')}>Email{arrow('email')}</th>
                  <th onClick={()=>setSort('date')} style={thStyle(false, sortKey==='date')}>Date{arrow('date')}</th>
                  <th onClick={()=>setSort('duration_s')} style={thStyle(true, sortKey==='duration_s')}>Video{arrow('duration_s')}</th>
                  {showNick && <th style={{padding:'.4rem .6rem',textAlign:'left',color:'var(--muted)',fontSize:'.68rem',textTransform:'uppercase'}}>Nickname</th>}
                  {cols.map(c => (
                    <th key={c} onClick={()=>setSort(c)} style={thStyle(true, sortKey===c)}>
                      {METRICS[c].label} ({METRICS[c].unit}){arrow(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.map((r, i) => {
                  const sel = r.job_id && selected.includes(r.job_id)
                  return (
                  <tr key={i} onClick={() => toggleRow(r)}
                    title={r.job_id ? 'Click to select' : ''}
                    style={{borderBottom:'1px solid rgba(30,42,56,.4)',
                      cursor: r.job_id ? 'pointer' : 'default',
                      background: sel ? 'rgba(0,255,136,.08)' : 'transparent'}}>
                    <td style={{padding:'.32rem .4rem'}}>
                      {r.job_id ? (
                        <span style={{display:'inline-flex',width:14,height:14,borderRadius:3,
                          alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#000',
                          background: sel ? 'var(--green)' : 'transparent',
                          border:`2px solid ${sel ? 'var(--green)' : 'var(--border)'}`}}>{sel ? '✓' : ''}</span>
                      ) : null}
                    </td>
                    <td style={{padding:'.32rem .6rem',color:'var(--muted)',fontFamily:'var(--font-mono)',fontSize:'.72rem'}}>{i+1}</td>
                    <td style={{padding:'.32rem .6rem',color:'var(--text)'}}>{r.email || '—'}</td>
                    <td style={{padding:'.32rem .6rem',color:'var(--muted)'}}>{r.date || '—'}</td>
                    <td style={{padding:'.32rem .6rem',color:'var(--muted)',textAlign:'right'}}>{fmtDur(r.duration_s)}</td>
                    {showNick && <td style={{padding:'.32rem .6rem',color:'var(--amber)'}}>{r.nickname || '—'}</td>}
                    {cols.map(c => (
                      <td key={c} style={{padding:'.32rem .6rem',textAlign:'right',fontFamily:'var(--font-mono)',color:METRICS[c].color}}>
                        {METRICS[c].fmt(r[c])}
                      </td>
                    ))}
                  </tr>
                )})}
              </tbody>
            </table>
          </div>

          {/* grouped bar charts — per user, LR/LT/LJ bars (reference picture) */}
          <div className="card" style={{marginTop:'1rem'}}>
            <div style={{fontSize:'.72rem',color:'var(--dim)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.5rem'}}>
              Bar charts · each user: {cols.join(' / ')} (bars scaled within each metric)
            </div>
            {byUser.users.map((u, i) => (
              <div key={i} style={{marginBottom:'.8rem'}}>
                <div style={{fontSize:'.78rem',color:'var(--text)',fontWeight:600,marginBottom:'.2rem'}}>{u.email}</div>
                {cols.map(c => {
                  const frac = u[c] != null ? Math.max(2, (u[c] / byUser.max[c]) * 100) : 0
                  return (
                    <div key={c} style={{display:'flex',alignItems:'center',gap:'.5rem',marginBottom:'.15rem'}}>
                      <span style={{width:24,fontSize:'.68rem',color:'var(--muted)',fontFamily:'var(--font-mono)'}}>{METRICS[c].label}</span>
                      <div style={{flex:1,height:12,background:'var(--bg3)',borderRadius:3,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${frac}%`,background:METRICS[c].color}} />
                      </div>
                      <span style={{minWidth:90,textAlign:'right',fontSize:'.72rem',fontFamily:'var(--font-mono)',color:METRICS[c].color}}>
                        {METRICS[c].fmt(u[c])}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {!isMaster && (
            <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:'.5rem'}}>
              You can view your own data but not download it. Other users' emails are masked and their video nicknames are hidden.
              Select one or more of your rows and press “Show details” to see their full physics.
            </div>
          )}
        </>
      )}

      {/* Measurement details modal — all selected measurements, one after another */}
      {detail && (
        <div onClick={e => e.target === e.currentTarget && setDetail(null)}
          style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(0,0,0,.65)',
            display:'flex',alignItems:'flex-start',justifyContent:'center',
            padding:'1rem',overflowY:'auto'}}>
          <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:16,
            width:'100%',maxWidth:720,padding:'1.25rem',position:'relative',marginTop:'2rem',marginBottom:'2rem'}}>
            <button onClick={() => setDetail(null)} style={{position:'absolute',top:10,right:12,
              background:'none',border:'none',color:'var(--muted)',fontSize:'1.05rem',cursor:'pointer'}}>✕ </button>
            <h3 style={{marginBottom:'.75rem'}}>Details — {detail.rows.length} measurement{detail.rows.length>1?'s':''}</h3>
            {detail.loading ? (
              <div style={{color:'var(--muted)',padding:'1rem 0'}}>Loading…</div>
            ) : detail.rows.map((row, ri) => {
              const d = detail.datas[row.job_id]
              if (!d) return (
                <div key={ri} style={{color:'var(--muted)',padding:'.5rem 0'}}>
                  {row.nickname || row.date}: could not load details.
                </div>
              )
              const j = d.job || {}
              const ph = d.physics || {}
              const ideal = ph.ideal || {}, air = ph.air || {}, water = ph.water || {}
              const ROWS = [
                ['W_total','Total Work','J'],['P_avg','Average Power','W'],
                ['P_peak','Peak Power','W'],['F_max','Max Force','N'],
                ['E_kin_max','Rotational Energy (peak)','J'],
                ['omega_max','Final Angular Velocity','rad/s'],
                ['alpha','Angular Acceleration','rad/s²'],['J','Inertia','kg·m²'],
                ['planck_freq','Lajtner Resonance (LR)','—'],
              ]
              const f = (v) => {
                if (v == null) return '—'
                if (v === 0) return '0'
                const a=Math.abs(v), e=Math.floor(Math.log10(a))
                return `${(v/Math.pow(10,e)).toFixed(3).replace(/\.?0+$/,'')}e${e}`
              }
              return (
                <div key={ri} style={{marginBottom:'1.5rem',paddingBottom:'1.25rem',
                  borderBottom: ri < detail.rows.length-1 ? '2px solid var(--border)' : 'none'}}>
                  <div style={{fontWeight:700,marginBottom:'.3rem'}}>
                    {ri+1}. {j.nickname || row.nickname || 'Measurement'}
                    <span style={{color:'var(--muted)',fontWeight:400,fontSize:'.8rem'}}> · {j.date || row.date}</span>
                  </div>
                  <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',fontSize:'.78rem',
                    color:'var(--muted)',marginBottom:'.5rem'}}>
                    <span>📧 {j.email}</span>
                    <span>⏱ {j.duration_s != null ? (+j.duration_s).toFixed(1)+'s video' : '—'}</span>
                    <span style={{color: j.medium==='water' ? '#00bcd4' : 'var(--blue)',fontWeight:700}}>
                      {(j.medium||'air').toUpperCase()}{j.direction ? ' · '+String(j.direction).toUpperCase() : ''}
                    </span>
                  </div>
                  <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',marginBottom:'.5rem'}}>
                    <span style={{color:'#44aaff',fontSize:'.85rem'}}><b>LR</b> 🔷 {fmtLR(row.LR)}</span>
                    <span style={{color:'var(--amber)',fontSize:'.85rem'}}><b>LT</b> ⏳ {ph.lajtner_time != null ? (+ph.lajtner_time).toFixed(3)+' s' : '—'}</span>
                    <span style={{color:'var(--amber)',fontSize:'.85rem'}}><b>LJ</b> 🌀 {ph.lajtner_jerk_deg != null ? fmtLJ(ph.lajtner_jerk_deg)+' °/s³' : '—'}</span>
                  </div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.76rem',whiteSpace:'nowrap'}}>
                      <thead>
                        <tr style={{borderBottom:'2px solid var(--border)'}}>
                          <th style={{textAlign:'left',padding:'.3rem .5rem',color:'var(--muted)',fontSize:'.66rem',textTransform:'uppercase'}}>Parameter</th>
                          <th style={{padding:'.3rem .5rem',color:'var(--muted)',fontSize:'.66rem',textAlign:'right'}}>Unit</th>
                          <th style={{padding:'.3rem .5rem',color:'var(--blue)',fontSize:'.66rem',textAlign:'right'}}>Ideal</th>
                          <th style={{padding:'.3rem .5rem',color:'var(--green)',fontSize:'.66rem',textAlign:'right'}}>Air</th>
                          <th style={{padding:'.3rem .5rem',color:'#00bcd4',fontSize:'.66rem',textAlign:'right'}}>Water</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ROWS.map(([k,label,unit]) => (
                          <tr key={k} style={{borderBottom:'1px solid rgba(30,42,56,.4)'}}>
                            <td style={{padding:'.3rem .5rem',color:'var(--text)'}}>{label}</td>
                            <td style={{padding:'.3rem .5rem',color:'var(--dim)',fontSize:'.7rem',textAlign:'right'}}>{unit}</td>
                            <td style={{padding:'.3rem .5rem',color:'var(--blue)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{f(ideal[k])}</td>
                            <td style={{padding:'.3rem .5rem',color:'var(--green)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{f(air[k])}</td>
                            <td style={{padding:'.3rem .5rem',color:'#00bcd4',fontFamily:'var(--font-mono)',textAlign:'right'}}>{f(water[k])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}