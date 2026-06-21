import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// Format: 1.123e-11
const fmtSci = (v) => {
  if (!v && v !== 0) return '—'
  if (v === 0) return '0'
  return (+v).toExponential(3)
}

// Lajtner Resonance format
const fmtLR = (energy) => {
  if (!energy || energy === 0) return '—'
  const h = 6.626e-34
  const freq = energy / h
  const exp = Math.floor(Math.log10(Math.abs(freq)))
  const mant = freq / Math.pow(10, exp)
  return `${mant.toFixed(2)}L${exp >= 0 ? '+' : ''}${exp}R`
}

export default function FPE() {
  const { user } = useAuth()
  if (!user) return null
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [sort, setSort]     = useState('lr')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/master/all?email=${encodeURIComponent(user.email)}&limit=1000`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      setRows(d.rows || [])
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const getLR = (e) => {
    if (!e || e === 0) return 0
    return e / 6.626e-34
  }

  const getVelocity = (r) => {
    if (!r.cumulative_deg || !r.t_lajtner || r.t_lajtner <= 0) return 0
    return r.cumulative_deg / r.t_lajtner
  }

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'lr')      return getLR(b.w_total_air) - getLR(a.w_total_air)
    if (sort === 'power')   return (b.p_peak_air || 0) - (a.p_peak_air || 0)
    if (sort === 'force')   return (b.f_max_air || 0) - (a.f_max_air || 0)
    if (sort === 'energy')  return (b.w_total_air || 0) - (a.w_total_air || 0)
    if (sort === 'velocity') return getVelocity(b) - getVelocity(a)
    return 0
  })

  const downloadCSV = () => {
    const h = ['email','date','rotation_deg','t_total_s','velocity_deg_s','f_N','p_W','e_J','lajtner_resonance','medium']
    const rows_csv = sorted.map(r => {
      const exp = Math.floor(Math.log10(Math.abs(getLR(r.w_total_air)||1)))
      const mant = getLR(r.w_total_air) / Math.pow(10, exp)
      return [
        r.email,
        r.created_at?.slice(0,16),
        (r.cumulative_deg||0).toFixed(3),
        (r.t_lajtner||0).toFixed(3),
        getVelocity(r).toFixed(3),
        (r.f_max_air||0).toExponential(3),
        (r.p_peak_air||0).toExponential(3),
        (r.w_total_air||0).toExponential(3),
        `${mant.toFixed(2)}L${exp>=0?'+':''}${exp}R`,
        r.medium||'air'
      ].join(';')
    })
    const csv = [h.join(';'), ...rows_csv].join('\n')
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'})
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'lajtner_fpe.csv'
    a.click()
  }

  return (
    <div>
      <div className="page-header">
        <h1>⚡ FPE Dashboard</h1>
        <p>Force · Power · Energy — all users</p>
      </div>

      <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap'}}>
        {[['lr','Lajtner Resonance'],['power','Power'],['force','Force'],['energy','Energy'],['velocity','Velocity']].map(([k,l]) => (
          <button key={k} className={`btn btn-sm ${sort===k?'btn-primary':'btn-secondary'}`}
            onClick={() => setSort(k)}>Sort by {l}</button>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={load}>↺ Refresh</button>
        <button className="btn btn-secondary btn-sm" onClick={downloadCSV}>↓ CSV</button>
        <button className="btn btn-secondary btn-sm" onClick={downloadCSV}>↓ CSV</button>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading && <div style={{color:'var(--muted)',padding:'1rem'}}>Loading...</div>}

      {!loading && rows.length > 0 && (
        <div className="card">
          <div className="card-title">All Records ({rows.length})</div>
          <div className="tbl-wrap" style={{maxHeight:600}}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Email</th>
                  <th>Date</th>
                  <th style={{color:'var(--blue)'}}>Velocity (°/s)</th>
                  <th style={{color:'var(--blue)'}}>ω (°/s)</th>
                  <th style={{color:'var(--green)'}}>F (N)</th>
                  <th style={{color:'var(--amber)'}}>P (W)</th>
                  <th style={{color:'var(--blue)'}}>E (J)</th>
                  <th style={{color:'#FFD700'}}>Lajtner Resonance</th>
                  <th>Medium</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={i}>
                    <td style={{color:'var(--dim)',fontSize:'.75rem'}}>{i+1}</td>
                    <td style={{color:'var(--text)',fontSize:'.8rem'}}>{r.email}</td>
                    <td style={{color:'var(--muted)',fontSize:'.72rem',whiteSpace:'nowrap'}}>
                      {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={{color:'var(--blue)',fontFamily:'monospace'}}>
                      {getVelocity(r).toFixed(3)}
                    </td>
                    <td style={{color:'var(--blue)',fontFamily:'monospace'}}>
                      {((r.omega_max||0)*180/Math.PI).toFixed(3)}
                    </td>
                    <td style={{color:'var(--green)',fontFamily:'monospace'}}>
                      {fmtSci(r.f_max_air)}
                    </td>
                    <td style={{color:'var(--amber)',fontFamily:'monospace'}}>
                      {fmtSci(r.p_peak_air)}
                    </td>
                    <td style={{color:'var(--blue)',fontFamily:'monospace'}}>
                      {fmtSci(r.w_total_air)}
                    </td>
                    <td style={{color:'#FFD700',fontFamily:'monospace',fontWeight:600}}>
                      {fmtLR(r.w_total_air)}
                    </td>
                    <td style={{color:'var(--muted)',fontSize:'.8rem'}}>{r.medium || 'air'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}