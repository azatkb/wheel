import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { API } from '../config'
import PhysicsCard from '../components/PhysicsCard'
import * as XLSX from 'xlsx'

export default function History() {
  const { user } = useAuth()
  if (!user) return null
  const [jobs, setJobs] = useState([])
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState({})
  const [page, setPage] = useState(0)
  const PAGE = 20

  useEffect(() => { loadJobs() }, [])

  const loadJobs = async () => {
    try {
      const r = await fetch(API + '/api/jobs?limit=500&email=' + encodeURIComponent(user.email))
      const d = await r.json()
      setJobs(d.jobs || [])
    } catch {}
  }

  const filtered = jobs.filter(j =>
    !filter || (j.user_email || '').toLowerCase().includes(filter.toLowerCase())
  )

  const slice = filtered.slice(page * PAGE, page * PAGE + PAGE)

  const toggle = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (detail[id]) return
    try {
      const [sR, pR] = await Promise.allSettled([
        fetch(API + '/results/' + id),
        fetch(API + '/physics/' + id),
      ])
      const samples = sR.status === 'fulfilled' && sR.value.ok ? await sR.value.json() : []
      const phys = pR.status === 'fulfilled' && pR.value.ok ? await pR.value.json() : null
      setDetail(d => ({ ...d, [id]: { samples, phys } }))
    } catch {}
  }

  return (
    <div>
      <div className="page-header">
        <h1>History</h1>
        <p>All recorded tracks — click to expand</p>
      </div>

      <div className="card">
        <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem'}}>
          <input className="form-input" placeholder="Filter by email..."
            value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }}
            style={{flex:1}} />
          <button className="btn btn-secondary btn-sm"
            onClick={() => { setFilter(''); setPage(0) }}>Clear</button>
          <button className="btn btn-secondary btn-sm" onClick={loadJobs}>↺ Refresh</button>
        </div>

        {slice.map(j => (
          <div key={j.id} className={`track-item ${expanded === j.id ? 'expanded' : ''}`}>
            <div className="track-header" onClick={() => toggle(j.id)}>
              <span className={`track-dot dot-${j.status || 'queued'}`} />
              <span style={{color:'var(--amber)',fontWeight:700,marginRight:'.75rem',
                whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:220}}
                title={j.nickname || ''}>
                {j.nickname || 'Untitled'}
              </span>
              <span className="track-date">
                {j.created_at ? new Date(j.created_at).toLocaleString() : '—'}
              </span>
              <span className="track-email">{j.user_email || '—'}</span>
              <span className="track-src">{j.source_type || '—'}</span>
              <span style={{color:'#64748b',fontSize:'.72rem',marginLeft:'auto'}}>
                {j.duration_sec ? j.duration_sec.toFixed(1)+'s' : '—'} · {j.sample_count || 0} smp
              </span>
            </div>
            <div className="track-id">{j.id}</div>

            {expanded === j.id && (
              <div className="track-detail">
                {detail[j.id] ? (
                  <TrackDetail id={j.id} job={j} data={detail[j.id]} />
                ) : (
                  <div style={{color:'#64748b',fontSize:'.8rem'}}>Loading...</div>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{color:'#334155',textAlign:'center',padding:'2rem',fontSize:'.9rem'}}>
            No tracks found
          </div>
        )}

        {Math.ceil(filtered.length / PAGE) > 1 && (
          <div style={{display:'flex',gap:'.4rem',justifyContent:'center',marginTop:'.75rem',flexWrap:'wrap'}}>
            {Array.from({length: Math.ceil(filtered.length/PAGE)}, (_,i) => (
              <button key={i}
                className={`btn btn-sm ${i === page ? 'btn-primary' : 'btn-secondary'}`}
                style={{minWidth:36}}
                onClick={() => setPage(i)}>{i+1}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TrackDetail({ id, job, data }) {
  const [showTbl, setShowTbl] = useState(false)
  const { samples, phys } = data
  const msg = phys?.message || {}
  const result = phys?.result || {}

  const last = samples[samples.length - 1]
  const maxC = samples.length ? Math.max(...samples.map(s => Math.abs(+s.cumulative_deg))) : 0
  const avgS = samples.length ? Math.round(samples.reduce((a,s) => a+(+s.confidence_pct), 0)/samples.length) : 0

  const downloadXLSX = () => {
    if (!samples?.length) return
    const headers = ['Time (s)', 'Angle (°)', 'Total (°)', 'Velocity (°/s)', 'Significance (%)']
    const rows = samples.map(s => [
      s.timestamp_sec, s.rotation_deg, s.cumulative_deg,
      s.angular_vel_dps, s.confidence_pct,
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = headers.map(() => ({wch: 16}))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Samples')
    XLSX.writeFile(wb, `samples_${id.slice(0,8)}.xlsx`)
  }

  return (
    <div>
      {samples.length > 0 && (
        <div className="metrics-grid" style={{marginBottom:'.75rem'}}>
          {/* Lajtner Resonance - top priority */}
          {msg?.display?.planck_freq_raw > 0 && (() => {
            const pf = msg.display.planck_freq_raw
            const exp = Math.floor(Math.log10(Math.abs(pf)))
            const mant = pf / Math.pow(10, exp)
            return (
              <div className="metric-box" style={{
                padding:'.6rem .8rem',
                border:'2px solid rgba(255,136,0,.5)',
                background:'rgba(255,136,0,.08)',
                gridColumn:'1 / -1'
              }}>
                <div className="metric-val" style={{fontSize:'1.4rem',color:'var(--amber)',fontWeight:800}}>
                  {mant.toFixed(2)}L{exp > 0 ? '+' : ''}{exp}R
                </div>
                <div className="metric-label">Lajtner Resonance</div>
              </div>
            )
          })()}
          {/* Velocity */}
          {last && +last.timestamp_sec > 0 && (
            <div className="metric-box" style={{padding:'.6rem .8rem'}}>
              <div className="metric-val" style={{fontSize:'1.2rem',color:'var(--blue)'}}>
                {(maxC / +last.timestamp_sec).toFixed(3)}°/s
              </div>
              <div className="metric-label">Velocity</div>
            </div>
          )}
          {[
            [samples.length, 'Samples'],
            [last ? (+last.timestamp_sec).toFixed(1)+'s' : '—', 'Duration'],
            [maxC.toFixed(1)+'°', 'Max Rotation'],
            [last ? (+last.cumulative_deg).toFixed(1)+'°' : '—', 'Final Angle'],
            [avgS+'%', 'Avg Sig'],
          ].map(([v,l]) => (
            <div key={l} className="metric-box" style={{padding:'.6rem .8rem'}}>
              <div className="metric-val" style={{fontSize:'1.2rem'}}>{v}</div>
              <div className="metric-label">{l}</div>
            </div>
          ))}
        </div>
      )}

      {(msg.message || Object.keys(msg.display||{}).length > 0) && (
        <PhysicsCard msg={msg} result={result} jobId={id} isPaid={false} />
      )}

      <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginTop:'.5rem'}}>
        {/* Download only for uploaded videos, not streams */}
        {job?.source_type !== 'stream' && (
          <a href={`${API}/download/${id}`}>
            <button className="btn btn-primary btn-sm">↓ Download Video</button>
          </a>
        )}
        {job?.source_type === 'stream' && (
          <button className="btn btn-secondary btn-sm" disabled
            title="Stream videos cannot be downloaded">
            ▶ Replay Only
          </button>
        )}
        {msg?.display?.planck_freq_raw > 0 && (() => {
          const pf = msg.display.planck_freq_raw
          const exp = Math.floor(Math.log10(Math.abs(pf)))
          const mant = pf / Math.pow(10, exp)
          const lr = `${mant.toFixed(2)}L${exp >= 0 ? '+' : ''}${exp}R`
          return (
            <button className="btn btn-secondary btn-sm"
              onClick={() => {
                const nn = job?.nickname || 'My measurement'
                sessionStorage.setItem('forum_share', JSON.stringify({
                  job_id: id, lr_value: lr, nickname: nn,
                  rotation_deg: maxC, medium: job?.medium || 'air',
                  title: `${nn} — ${lr}`,
                  body: `Video: ${nn}\nRotation: ${maxC.toFixed(1)}° · Medium: ${(job?.medium||'air').toUpperCase()} · Lajtner Resonance: ${lr}`
                }))
                window.location.href = '/forum'
              }}>💬 Share</button>
          )
        })()}
        {/* <a href={`${API}/csv/${id}`}>
          <button className="btn btn-secondary btn-sm">↓ CSV</button>
        </a> */}
        <button className="btn btn-secondary btn-sm" onClick={downloadXLSX}>
          ↓ Download XLSX
        </button>
      </div>
    </div>
  )
}