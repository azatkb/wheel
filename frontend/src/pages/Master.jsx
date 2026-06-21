import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_TOKEN = 'wt_master_2026'

function fmtSI(v, u) {
  if (!v && v !== 0) return '0'
  if (v === 0) return '0 '+u
  return v.toExponential(2)+' '+u
}

export default function Master() {
  const { user } = useAuth()
  if (!user) return null
  const [tab, setTab]       = useState('users')
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => { loadTab('users') }, [])

  const loadTab = async (t) => {
    setTab(t); setLoading(true); setError('')
    try {
      let url = ''
      if (t === 'users') url = `${API}/master/users?token=${MASTER_TOKEN}`
      if (t === 'all')   url = `${API}/master/all?token=${MASTER_TOKEN}&limit=200`
      const r = await fetch(url)
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      setData(d)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Master Dashboard</h1>
        <p>All users data — admin view</p>
      </div>

      <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap'}}>
        {['users','all'].map(t => (
          <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-secondary'}`}
            onClick={() => loadTab(t)}>
            {t === 'users' ? '👥 Users' : '📊 All Records'}
          </button>
        ))}
        <a href={`${API}/master/export-csv?token=${MASTER_TOKEN}`}>
          <button className="btn btn-secondary btn-sm">⬇ Export CSV</button>
        </a>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading && <div style={{color:'var(--text)',padding:'1rem'}}>Loading...</div>}

      {/* Users tab */}
      {!loading && tab === 'users' && data?.users && (
        <div className="card">
          <div className="card-title">Users ({data.users.length})</div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Email</th><th>Measurements</th></tr></thead>
              <tbody>
                {data.users.map((u,i) => (
                  <tr key={i}>
                    <td style={{color:'var(--text)'}}>{u.email}</td>
                    <td style={{color:'var(--text)'}}>{u.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All records tab */}
      {!loading && tab === 'all' && data?.rows && (
        <div className="card">
          <div className="card-title">All Records ({data.count})</div>
          <div className="tbl-wrap" style={{maxHeight:500}}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Date & Time</th>
                  <th>Rot (°)</th>
                  <th>Time (s)</th>
                  <th>Work (J)</th>
                  <th>Force (N)</th>
                  <th>Power (W)</th>
                  <th>Energy (J)</th>
                  <th>ω (rad/s)</th>
                  <th>Medium</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r,i) => (
                  <tr key={i}>
                    <td style={{color:'var(--text)'}}>{r.email}</td>
                    <td style={{color:'var(--muted)',fontSize:'.68rem',whiteSpace:'nowrap'}}>
                      {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={{color:'var(--text)'}}>{r.cumulative_deg?.toFixed(2) ?? '—'}</td>
                    <td style={{color:'var(--text)'}}>{r.t_lajtner?.toFixed(2) ?? '—'}</td>
                    <td style={{color:'var(--blue)'}}>{fmtSI(r.w_total_air,'J')}</td>
                    <td style={{color:'var(--green)'}}>{fmtSI(r.f_max_air,'N')}</td>
                    <td style={{color:'var(--amber)'}}>{fmtSI(r.p_peak_air,'W')}</td>
                    <td style={{color:'#00bcd4'}}>{fmtSI(r.w_total_air,'J')}</td>
                    <td style={{color:'var(--text)'}}>{r.omega_max?.toFixed(4) ?? '—'}</td>
                    <td style={{color:'var(--muted)'}}>{r.medium}</td>
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