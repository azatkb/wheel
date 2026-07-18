import * as XLSX from 'xlsx'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'
import { fSI } from '../hooks/useChart'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'azatkb22']
function isMaster(email) {
  if (!email) return false
  const e = email.toLowerCase()
  return MASTER_EMAILS.some(m => e === m || e.startsWith(m.split('@')[0]))
}

const PHYS_ROWS = [
  { key: 'J',               label: 'Inertia_total (J)',               unit: 'kg·m²'   },
  { key: 'alpha',           label: 'Angular Acceleration (α)',        unit: 'rad/s²'  },
  { key: 'phi_total',       label: 'Angular Displacement (θ)',        unit: 'rad'     },
  { key: 'omega_max',       label: 'Final Angular Velocity (ω)',      unit: 'rad/s'   },
  { key: 'omega_avg',       label: 'Average Angular Velocity',        unit: 'rad/s'   },
  { key: 'M_res',           label: 'Braking Torque (τ_f)',            unit: 'Nm'      },
  { key: 'M_motor_accel',   label: 'Driving Torque (τ_d)',            unit: 'Nm'      },
  { key: 'M_motor_const',   label: 'Constant Motion Torque',         unit: 'Nm'      },
  { key: 'M_avg_active',    label: 'Average Torque (active)',         unit: 'Nm'      },
  { key: 'F_accel',         label: 'Driving Force (F)',               unit: 'N'       },
  { key: 'F_const',         label: 'Constant Motion Force',          unit: 'N'       },
  { key: 'F_avg_active',    label: 'Average Driving Force',          unit: 'N'       },
  { key: 'F_max',           label: 'Maximum Driving Force',          unit: 'N'       },
  { key: 'E_kin_max',       label: 'Rotational Energy (peak)',        unit: 'J'       },
  { key: 'E_kin_const',     label: 'Final Rotational Energy',        unit: 'J'       },
  { key: 'E_kin_avg_active',label: 'Average Rotational Energy',      unit: 'J'       },
  { key: 'P_peak',          label: 'Inst. Power (peak)',              unit: 'W'       },
  { key: 'P_const',         label: 'Constant Motion Power',          unit: 'W'       },
  { key: 'P_avg',           label: 'Average Power',                   unit: 'W'       },
  { key: 'W_total',         label: 'Total Rotational Work (W)',       unit: 'J'       },
  { key: 'L_ang',           label: 'Angular Momentum (L)',            unit: 'kg·m²/s' },
]

const CHART_METRICS = [
  { key: 'dir_filtered',    label: 'Speed in direction (°/s)', unit: '°/s' },
  { key: 'angular_vel_dps', label: 'Angular velocity (°/s)',   unit: '°/s' },
  { key: 'cumulative_deg',  label: 'Cumulative rotation (°)',  unit: '°'   },
  { key: 'confidence_pct',  label: 'Significance (%)',          unit: '%'   },
  { key: 'rotation_deg',    label: 'Spoke angle (°)',           unit: '°'   },
]

const fmt = (v, u) => {
  if (v == null) return '—'
  if (v === 0) return '0'
  const a = Math.abs(v)
  const exp = Math.floor(Math.log10(a))
  const mantissa = v / Math.pow(10, exp)
  const mStr = mantissa.toFixed(3).replace(/\.?0+$/, '')
  return `${mStr}e${exp}`
}

// Lajtner Resonance formatter: 1.64e25 → 1.64L+25R
const fmtLR = (v) => {
  if (!v || v <= 0) return '—'
  const exp = Math.floor(Math.log10(v))
  const man = (v / Math.pow(10, exp)).toFixed(2)
  return `${man}L${exp >= 0 ? '+' : ''}${exp}R`
}

const COLORS = ['#00ff88','#44aaff','#ff8800','#f44','#cc88ff','#00bcd4','#ffcc00']

// ── Physics table ──────────────────────────────────────────────────────────
function PhysicsTable({ result, job, samples }) {
  if (!result) return <div style={{color:'var(--muted)'}}>No physics data</div>
  const { ideal = {}, air = {}, water = {} } = result
  const maxCum = samples?.length ? Math.max(...samples.map(s => Math.abs(+s.cumulative_deg))) : 0
  const phys = result

  return (
    <div>
      <div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap',marginBottom:'1rem',
        fontSize:'.78rem',color:'var(--muted)'}}>
        {job && <>
          <span>📅 {job.created_at?.slice(0,16)?.replace('T',' ')}</span>
          <span>📧 {job.user_email}</span>
          <span>⏱ {job.duration_sec?.toFixed(1)}s</span>
          <span style={{color:'var(--green)'}}>↻ {maxCum.toFixed(1)}°</span>
          <span style={{
            color: job.medium === 'water' ? '#00bcd4' : 'var(--blue)',
            fontWeight:700, fontSize:'.85rem'
          }}>
            {(job.medium || 'air').toUpperCase()} · {(job.direction || '').toUpperCase()}
          </span>
        </>}
        {/* Avg angular velocity = rotation / time */}
        {ideal?.phi_total != null && ideal?.t_total > 0 && (
          <span style={{color:'var(--blue)'}}>
            ⚡ {((ideal.phi_total * 180 / Math.PI) / ideal.t_total).toFixed(3)} °/s avg
          </span>
        )}
        {/* Lajtner Resonance / Time / Acceleration */}
        {(() => {
          const rc = result?.[job?.medium] || result?.air || result?.ideal || {}
          return rc.planck_freq > 0 ? (
            <span style={{color:'var(--amber)',fontWeight:600}}>🔷 {fmtLR(rc.planck_freq)}
              <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'.3rem'}}>Lajtner Resonance</span>
            </span>
          ) : null
        })()}
        {result?.lajtner_time != null && (
          <span style={{color:'var(--amber)'}}>⏳ {(+result.lajtner_time).toFixed(3)} s
            <span style={{color:'var(--muted)',marginLeft:'.3rem'}}>Lajtner Time</span></span>
        )}
        {result?.lajtner_jerk_deg != null && (
          <span style={{color:'var(--amber)'}}>🌀 {fmt(result.lajtner_jerk_deg)} °/s³
            <span style={{color:'var(--muted)',marginLeft:'.3rem'}}>Lajtner Jerk</span></span>
        )}
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.78rem',whiteSpace:'nowrap'}}>
          <thead>
            <tr style={{borderBottom:'2px solid var(--border)'}}>
              <th style={{textAlign:'left',padding:'.4rem .6rem',color:'var(--muted)',
                fontSize:'.68rem',textTransform:'uppercase',letterSpacing:'.05em',minWidth:200}}>
                Parameter
              </th>
              <th style={{padding:'.4rem .6rem',color:'var(--muted)',fontSize:'.68rem',
                textTransform:'uppercase',textAlign:'right'}}>Unit</th>
              <th style={{padding:'.4rem .6rem',color:'var(--blue)',fontSize:'.68rem',
                textTransform:'uppercase',textAlign:'right'}}>Ideal</th>
              <th style={{padding:'.4rem .6rem',color:'var(--green)',fontSize:'.68rem',
                textTransform:'uppercase',textAlign:'right'}}>Air</th>
              <th style={{padding:'.4rem .6rem',color:'#00bcd4',fontSize:'.68rem',
                textTransform:'uppercase',textAlign:'right'}}>Water</th>
            </tr>
          </thead>
          <tbody>
            {/* Metadata rows */}
            {job && <>
              <tr style={{borderBottom:'1px solid var(--border)',background:'rgba(0,255,136,.04)'}}>
                <td style={{padding:'.3rem .6rem',color:'var(--text)',fontWeight:600}}>Medium</td>
                <td style={{padding:'.3rem .6rem',color:'var(--muted)',fontSize:'.7rem'}}>—</td>
                <td colSpan={3} style={{padding:'.3rem .6rem',textAlign:'left'}}>
                  <span style={{
                    color: job.medium === 'water' ? '#00bcd4' : 'var(--blue)',
                    fontWeight:700, fontSize:'.9rem'
                  }}>
                    {(job.medium || 'air').toUpperCase()}
                  </span>
                  <span style={{color:'var(--muted)',marginLeft:'.75rem',fontSize:'.8rem'}}>
                    · {job.direction?.toUpperCase() || '—'}
                  </span>
                </td>
              </tr>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'.3rem .6rem',color:'var(--text)',fontWeight:600}}>Date</td>
                <td style={{padding:'.3rem .6rem',color:'var(--muted)',fontSize:'.7rem'}}>—</td>
                <td colSpan={3} style={{padding:'.3rem .6rem',color:'var(--text)',textAlign:'left'}}>
                  {job.created_at?.slice(0,16)?.replace('T',' ')}
                </td>
              </tr>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'.3rem .6rem',color:'var(--text)',fontWeight:600}}>Rotation (°)</td>
                <td style={{padding:'.3rem .6rem',color:'var(--muted)',fontSize:'.7rem'}}>deg</td>
                <td colSpan={3} style={{padding:'.3rem .6rem',color:'var(--green)',textAlign:'left'}}>
                  {maxCum.toFixed(2)}°
                </td>
              </tr>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'.3rem .6rem',color:'var(--text)',fontWeight:600}}>Time (t)</td>
                <td style={{padding:'.3rem .6rem',color:'var(--muted)',fontSize:'.7rem'}}>s</td>
                <td colSpan={3} style={{padding:'.3rem .6rem',color:'var(--text)',textAlign:'left'}}>
                  {ideal?.t_total != null ? (+ideal.t_total).toFixed(2) : job.duration_sec?.toFixed(2)}s
                </td>
              </tr>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'.3rem .6rem',color:'var(--text)',fontWeight:600}}>Avg Velocity</td>
                <td style={{padding:'.3rem .6rem',color:'var(--muted)',fontSize:'.7rem'}}>°/s</td>
                <td colSpan={3} style={{padding:'.3rem .6rem',color:'var(--blue)',textAlign:'left'}}>
                  {ideal?.phi_total != null && ideal?.t_total > 0
                    ? ((ideal.phi_total * 180 / Math.PI) / ideal.t_total).toFixed(3)
                    : '—'} °/s
                </td>
              </tr>
              <tr style={{borderBottom:'2px solid var(--border)'}}>
                <td style={{padding:'.3rem .6rem',color:'var(--text)',fontWeight:600}}>Medium</td>
                <td style={{padding:'.3rem .6rem',color:'var(--muted)',fontSize:'.7rem'}}>—</td>
                <td colSpan={3} style={{padding:'.3rem .6rem',color:'var(--amber)',textAlign:'left'}}>
                  {(job.medium || 'air').toUpperCase()} · {job.direction?.toUpperCase() || '—'}
                </td>
              </tr>
            </>}
            {PHYS_ROWS.map(({ key, label, unit }, i) => (
              <tr key={key} style={{
                background: i%2===0 ? 'transparent' : 'rgba(255,255,255,.02)',
                borderBottom:'1px solid rgba(30,42,56,.4)'}}>
                <td style={{padding:'.35rem .6rem',color:'var(--text)'}}>{label}</td>
                <td style={{padding:'.35rem .6rem',color:'var(--dim)',fontSize:'.72rem',textAlign:'right'}}>{unit}</td>
                <td style={{padding:'.35rem .6rem',color:'var(--blue)',fontFamily:'var(--font-mono)',textAlign:'right'}}>
                  {fmt(ideal[key], unit)}</td>
                <td style={{padding:'.35rem .6rem',color:'var(--green)',fontFamily:'var(--font-mono)',textAlign:'right'}}>
                  {fmt(air[key], unit)}</td>
                <td style={{padding:'.35rem .6rem',color:'#00bcd4',fontFamily:'var(--font-mono)',textAlign:'right'}}>
                  {fmt(water[key], unit)}</td>
              </tr>
            ))}
            {/* Lajtner metrics as regular rows. LR differs per medium; LT/LJ are
                medium-independent. Per client: the column of the medium that was
                NOT measured shows 0 (air measurement → water = 0, and vice versa). */}
            {(() => {
              const med = (job?.medium || 'air').toLowerCase()
              const airCell = (v) => med === 'air'   ? v : 0
              const watCell = (v) => med === 'water' ? v : 0
              return (<>
                {(ideal?.planck_freq != null || air?.planck_freq != null) && (
                  <tr style={{borderTop:'2px solid var(--border)',background:'rgba(255,136,0,.06)'}}>
                    <td style={{padding:'.35rem .6rem',color:'var(--text)',fontWeight:600}}>Lajtner Resonance (LR)</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--dim)',fontSize:'.72rem',textAlign:'right'}}>—</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--blue)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(ideal.planck_freq)}</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--green)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(airCell(air.planck_freq))}</td>
                    <td style={{padding:'.35rem .6rem',color:'#00bcd4',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(watCell(water.planck_freq))}</td>
                  </tr>
                )}
                {result?.lajtner_time != null && (
                  <tr style={{background:'rgba(255,136,0,.06)'}}>
                    <td style={{padding:'.35rem .6rem',color:'var(--text)',fontWeight:600}}>Lajtner Time (LT)</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--dim)',fontSize:'.72rem',textAlign:'right'}}>s</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--blue)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(result.lajtner_time)}</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--green)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(airCell(result.lajtner_time))}</td>
                    <td style={{padding:'.35rem .6rem',color:'#00bcd4',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(watCell(result.lajtner_time))}</td>
                  </tr>
                )}
                {result?.lajtner_jerk_deg != null && (
                  <tr style={{background:'rgba(255,136,0,.06)'}}>
                    <td style={{padding:'.35rem .6rem',color:'var(--text)',fontWeight:600}}>Lajtner Jerk (LJ)</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--dim)',fontSize:'.72rem',textAlign:'right'}}>°/s³</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--blue)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(result.lajtner_jerk_deg)}</td>
                    <td style={{padding:'.35rem .6rem',color:'var(--green)',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(airCell(result.lajtner_jerk_deg))}</td>
                    <td style={{padding:'.35rem .6rem',color:'#00bcd4',fontFamily:'var(--font-mono)',textAlign:'right'}}>{fmt(watCell(result.lajtner_jerk_deg))}</td>
                  </tr>
                )}
              </>)
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Chart ──────────────────────────────────────────────────────────────────
function AnalyticsChart({ datasets, metric, unit }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !datasets.length) return
    const canvas = ref.current
    canvas.width = canvas.offsetWidth || 800
    canvas.height = 300
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height
    const pad = { l:60, r:20, t:30, b:40 }
    ctx.fillStyle = '#080b0f'; ctx.fillRect(0,0,W,H)
    const cW = W-pad.l-pad.r, cH = H-pad.t-pad.b
    const allV = datasets.flatMap(d => d.values.map(v => v.y))
    const allT = datasets.flatMap(d => d.values.map(v => v.x))
    if (!allV.length) return
    const vMin=Math.min(...allV), vMax=Math.max(...allV), vR=(vMax-vMin)||1
    const tMin=Math.min(...allT), tMax=Math.max(...allT)||1
    const tx = t => pad.l+(t-tMin)/(tMax-tMin)*cW
    const ty = v => pad.t+(1-(v-vMin)/vR)*cH
    // Grid
    ctx.strokeStyle='#2a3a4a'; ctx.lineWidth=1
    ;[0,.25,.5,.75,1].forEach(f => {
      const y=pad.t+f*cH, v=vMax-f*vR
      ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke()
      ctx.fillStyle='#7a8fa8'; ctx.font='11px system-ui,sans-serif'
      ctx.fillText(fSI(v,unit), 2, y+3)
    })
    ;[0,.25,.5,.75,1].forEach(f => {
      const t=tMin+f*(tMax-tMin)
      ctx.fillStyle='#7a8fa8'; ctx.font='11px system-ui,sans-serif'
      ctx.fillText(t.toFixed(1)+'s', pad.l+f*cW-12, H-8)
    })
    // Zero line
    if (vMin<0&&vMax>0) {
      const zy=ty(0); ctx.strokeStyle='rgba(255,255,255,.2)'; ctx.setLineDash([4,4])
      ctx.beginPath(); ctx.moveTo(pad.l,zy); ctx.lineTo(W-pad.r,zy); ctx.stroke()
      ctx.setLineDash([])
    }
    // Lines
    datasets.forEach((ds,di) => {
      const col=COLORS[di%COLORS.length]
      ctx.strokeStyle=col; ctx.lineWidth=2; ctx.beginPath()
      ds.values.forEach((p,i) => i===0?ctx.moveTo(tx(p.x),ty(p.y)):ctx.lineTo(tx(p.x),ty(p.y)))
      ctx.stroke()
      // Legend
      ctx.fillStyle=col; ctx.fillRect(pad.l+di*160, 8, 12, 3)
      ctx.font='11px system-ui,sans-serif'; ctx.fillText(ds.label.slice(0,20), pad.l+di*160+16, 14)
    })
    ctx.fillStyle='#64748b'; ctx.font='bold 11px system-ui,sans-serif'
    ctx.fillText(metric, pad.l, pad.t-10)
  }, [datasets, metric, unit])
  return <canvas ref={ref} style={{width:'100%',height:300,display:'block',
    borderRadius:10,background:'#080b0f'}} />
}

// ── Modal ──────────────────────────────────────────────────────────────────
function Modal({ open, onClose, children }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!open) return null
  return (
    <div style={{
      position:'fixed',inset:0,zIndex:1000,
      background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',
      display:'flex',alignItems:'flex-start',justifyContent:'center',
      padding:'1rem',overflowY:'auto',
    }} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{
        background:'var(--bg2)',border:'1px solid var(--border)',
        borderRadius:20,width:'100%',maxWidth:1100,
        padding:'1.5rem',position:'relative',marginTop:'2rem',marginBottom:'2rem',
      }}>
        <button onClick={onClose} style={{
          position:'absolute',top:12,right:12,
          background:'var(--bg3)',border:'1px solid var(--border)',
          borderRadius:8,color:'var(--muted)',fontSize:'.9rem',
          cursor:'pointer',padding:'.25rem .6rem',lineHeight:1,
          zIndex:10,
        }}>✕ Close</button>
        {children}
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function Analytics() {
  const { user } = useAuth()
  if (!user) return null
  const master = isMaster(user.email)
  const [emailFilter, setEmailFilter] = useState(user.email)
  // Everyone sees only their own records in Analytics
  const effectiveEmail = user.email
  const [jobs, setJobs] = useState([])
  const [selected, setSelected] = useState([])
  const [physics, setPhysics] = useState({})
  const [samples, setSamples] = useState({})
  const [loading, setLoading] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTab, setModalTab] = useState('table')
  const [chartMetric, setChartMetric] = useState('dir_filtered')

  useEffect(() => { loadJobs() }, [emailFilter])

  const loadJobs = async () => {
    try {
      const r = await fetch(`${API}/api/jobs?limit=500&email=${encodeURIComponent(effectiveEmail)}`)
      const d = await r.json()
      setJobs((d.jobs || []).filter(j => j.status === 'done'))
    } catch {}
  }

  const toggleSelect = id => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  const selectAll = () => setSelected(jobs.map(j => j.id))
  const clearAll  = () => setSelected([])

  const analyse = async () => {
    if (!selected.length) return
    setAnalysing(true)
    await Promise.all(selected.map(async id => {
      if (physics[id]) return
      try {
        const [sRes, pRes] = await Promise.all([
          fetch(`${API}/results/${id}`),
          fetch(`${API}/physics/${id}`),
        ])
        const s = sRes.ok ? await sRes.json() : []
        const p = pRes.ok ? await pRes.json() : null
        setSamples(prev => ({...prev, [id]: s}))
        setPhysics(prev => ({...prev, [id]: p}))
      } catch {}
    }))
    setAnalysing(false)
    setModalOpen(true)
  }

  const exportCSV = () => {
    const notLoaded = selected.filter(id => !physics[id]?.result)
    if (notLoaded.length > 0) {
      alert(`Please click "Analyse" first (${notLoaded.length} measurement(s) not loaded)`)
      return
    }
    const physKeys = PHYS_ROWS.map(r => r.key)
    // One row per measurement — all physics values flat as columns
    const header = [
      'date', 'email', 'job_id', 'source', 'direction', 'medium',
      'duration_s', 'rotation_deg',
      'lajtner_time_s', 'lajtner_jerk_deg', 'lajtner_jerk_rad',
      ...physKeys.map(k => k + '_ideal'),
      ...physKeys.map(k => k + '_air'),
      ...physKeys.map(k => k + '_water'),
    ]
    const rows = [header]
    selected.forEach(id => {
      const job = jobs.find(j => j.id === id)
      const res = physics[id]?.result
      if (!res) return
      rows.push([
        job?.created_at?.slice(0,19).replace('T',' ') || '',
        job?.user_email  || '',
        id,
        job?.source_type || '',
        job?.direction   || '',
        job?.medium      || '',
        job?.duration_sec || '',
        res.ideal?.phi_total != null
          ? +(res.ideal.phi_total * 180 / Math.PI).toFixed(4) : '',
        res.lajtner_time      ?? '',
        res.lajtner_jerk_deg ?? '',
        res.lajtner_jerk_rad ?? '',
        ...physKeys.map(k => res.ideal?.[k] ?? ''),
        ...physKeys.map(k => res.air?.[k]   ?? ''),
        ...physKeys.map(k => res.water?.[k]  ?? ''),
      ])
    })
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = header.map((h, i) => ({
      wch: Math.min(28, Math.max(h.length,
        ...rows.slice(1,10).map(r => String(r[i]??'').length)
      ))
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Measurements')
    XLSX.writeFile(wb, 'lajtner_measurements.xlsx')
  }

  // Lajtner Resonance / Time / Jerk as a long table:
  // value in one column, dimension in another, ';'-separated (Hungarian Excel).
  const exportLajtnerCSV = () => {
    const notLoaded = selected.filter(id => !physics[id]?.result)
    if (notLoaded.length > 0) {
      alert(`Please click "Analyse" first (${notLoaded.length} measurement(s) not loaded)`)
      return
    }
    const rows = [['Measurement', 'Metric', 'Value', 'Dimension']]
    selected.forEach(id => {
      const job = jobs.find(j => j.id === id)
      const res = physics[id]?.result
      if (!res) return
      const med   = job?.medium || 'air'
      const label = job?.nickname
        || (job?.created_at?.slice(0, 16)?.replace('T', ' '))
        || id.slice(0, 8)
      const reson = res?.[med]?.planck_freq ?? res?.air?.planck_freq ?? res?.ideal?.planck_freq
      rows.push([label, 'Lajtner Resonance', reson ?? '', '1/s (Hz)'])
      rows.push([label, 'Lajtner Time',      res.lajtner_time     ?? '', 's'])
      rows.push([label, 'Lajtner Jerk',      res.lajtner_jerk_deg ?? '', 'degree/s^3'])
    })
    const csv = rows.map(r => r.map(c => {
      const s = String(c ?? '')
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(';')).join('\r\n')
    // BOM so Excel reads UTF-8 correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lajtner_metrics.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const chartDatasets = selected.map((id, di) => {
    const job = jobs.find(j => j.id === id)
    const s = samples[id] || []
    // Compute direction-filtered velocity
    const vels = s.map(r => +r.angular_vel_dps || 0)
    const posCnt = vels.filter(v => v > 0).length
    const negCnt = vels.filter(v => v < 0).length
    const dominant = posCnt >= negCnt ? 'ccw' : 'cw'
    const dirFiltered = vels.map(v =>
      dominant === 'ccw' ? (v > 0 ? v : 0) : (v < 0 ? v : 0)
    )
    const values = s.map((row, i) => ({
      x: +row.timestamp_sec,
      y: chartMetric === 'dir_filtered' ? dirFiltered[i] : (+row[chartMetric] || 0)
    }))
    return {
      label: `${job?.user_email?.split('@')[0]||id.slice(0,6)} ${job?.created_at?.slice(0,10)||''}`,
      values,
      color: COLORS[di % COLORS.length],
    }
  }).filter(d => d.values.length)

  const selectedMetric = CHART_METRICS.find(m => m.key === chartMetric)

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <p>Select measurements → Analyse</p>
      </div>

      {/* Filter */}
      <div className="card">
        <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',alignItems:'flex-end',marginBottom:'.75rem'}}>
          <div style={{flex:1,minWidth:200}}>
            <label className="form-label">{master?'Filter by email':'Email'}</label>
            <input className="form-input" value={emailFilter}
              onChange={e => master && setEmailFilter(e.target.value)}
              readOnly={!master}
              placeholder={master?'leave blank = all users':user.email}
              style={{padding:'.45rem .65rem',opacity:master?1:.6}} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadJobs}>↺ Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={selectAll}>Select all</button>
          <button className="btn btn-secondary btn-sm" onClick={clearAll}>Clear</button>
        </div>

        {/* Job list */}
        <div style={{maxHeight:260,overflowY:'auto',marginBottom:'.75rem'}}>
          {jobs.length === 0 && (
            <div style={{color:'var(--muted)',fontSize:'.82rem',padding:'1rem 0'}}>No measurements found</div>
          )}
          {jobs.map(j => {
            const sel = selected.includes(j.id)
            return (
              <div key={j.id} onClick={() => toggleSelect(j.id)}
                style={{
                  display:'flex',alignItems:'center',gap:'.6rem',
                  padding:'.5rem .75rem',borderRadius:8,cursor:'pointer',
                  marginBottom:'.2rem',transition:'all .12s',
                  background: sel ? 'rgba(0,255,136,.08)' : 'var(--bg3)',
                  border:`1px solid ${sel?'var(--green)':'var(--border)'}`,
                }}>
                <div style={{width:14,height:14,borderRadius:3,flexShrink:0,
                  background:sel?'var(--green)':'transparent',
                  border:`2px solid ${sel?'var(--green)':'var(--border2)'}`,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:10,color:'#000',fontWeight:700}}>
                  {sel?'✓':''}
                </div>
                <span style={{color:'var(--muted)',fontSize:'.72rem',minWidth:110,fontFamily:'var(--font-mono)'}}>
                  {j.created_at?.slice(0,16)?.replace('T',' ')}
                </span>
                <span style={{color:'var(--text)',fontSize:'.82rem',flex:1}}>
                  {j.user_email}
                </span>
                <span style={{color:'var(--muted)',fontSize:'.68rem',
                  padding:'.1rem .35rem',border:'1px solid var(--border)',borderRadius:4}}>
                  {j.source_type}
                </span>
              </div>
            )
          })}
        </div>

        {/* Analyse button */}
        <div style={{display:'flex',gap:'.5rem',alignItems:'center',flexWrap:'wrap'}}>
          <button className="btn btn-primary"
            onClick={analyse}
            disabled={!selected.length || analysing}
            style={{minWidth:160}}>
            {analysing ? '⏳ Loading...' : `📊 Analyse (${selected.length})`}
          </button>
          {selected.length > 0 && Object.keys(physics).length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setModalOpen(true)}>
              ↗ Reopen results
            </button>
          )}
          <span style={{color:'var(--muted)',fontSize:'.78rem'}}>
            {selected.length} selected
          </span>
        </div>
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <div style={{marginBottom:'1rem',display:'flex',gap:'.4rem',flexWrap:'wrap',
          alignItems:'center',paddingRight:'6rem'}}>
          <h2 style={{fontSize:'1.1rem',fontWeight:700,flex:1}}>
            Analysis — {selected.length} measurement{selected.length>1?'s':''}
          </h2>
          {[
            {id:'table',  label:'📋 Physics Table'},
            {id:'charts', label:'📈 Charts'},
            {id:'export', label:'⬇ Export'},
          ].map(t => (
            <button key={t.id}
              className={`btn btn-sm ${modalTab===t.id?'btn-primary':'btn-secondary'}`}
              onClick={() => setModalTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Table tab */}
        {modalTab === 'table' && selected.map(id => {
          const job  = jobs.find(j => j.id === id)
          const p    = physics[id]
          const s    = samples[id] || []
          return (
            <div key={id} style={{marginBottom:'2rem',
              paddingBottom:'2rem',borderBottom:'1px solid var(--border)'}}>
              <PhysicsTable result={p?.result} job={job} samples={s} />
            </div>
          )
        })}

        {/* Charts tab */}
        {modalTab === 'charts' && (
          <div>
            <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',marginBottom:'1rem'}}>
              {CHART_METRICS.map(m => (
                <button key={m.key}
                  className={`btn btn-sm ${chartMetric===m.key?'btn-primary':'btn-secondary'}`}
                  onClick={() => setChartMetric(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            {chartDatasets.length > 0
              ? <AnalyticsChart datasets={chartDatasets}
                  metric={selectedMetric?.label||chartMetric}
                  unit={selectedMetric?.unit||''} />
              : <div style={{color:'var(--muted)'}}>No sample data loaded yet</div>
            }
            <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:'.5rem'}}>
              Each color = one measurement
            </div>
          </div>
        )}

        {/* Export tab */}
        {modalTab === 'export' && (
          <div style={{display:'flex',flexDirection:'column',gap:'.75rem',maxWidth:420}}>
            <button className="btn btn-primary" onClick={exportCSV}>
              ⬇ Download Physics XLSX
            </button>
            <div style={{fontSize:'.78rem',color:'var(--muted)'}}>
              All 20 variables × 3 cases (Ideal/Air/Water) for {selected.length} measurement{selected.length>1?'s':''}.
            </div>
            <button className="btn btn-secondary" onClick={exportLajtnerCSV}>
              ⬇ Lajtner metrics CSV (;)
            </button>
            <div style={{fontSize:'.78rem',color:'var(--muted)'}}>
              Lajtner Resonance, Time, Jerk — value in one column, dimension in another,
              <strong> ;</strong>-separated for Hungarian Excel (UTF-8).
            </div>
            {master && (
              <a href={`${API}/master/export-csv?token=wt_master_2026`}>
                <button className="btn btn-secondary" style={{width:'100%'}}>
                  ⬇ Full Database (all users)
                </button>
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}