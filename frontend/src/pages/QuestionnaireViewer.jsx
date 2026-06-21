import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e||'').toLowerCase())

// Map column → option labels (1=first, 2=second, 0=not answered)
const Q_LABELS = {
  q1_illness:     ['Illness',      ['Yes','No']],
  q2_loneliness:  ['Loneliness',   ['Lonely','Company']],
  q3_sleep:       ['Sleep',        ['Good','Bad']],
  q4_homeostasis: ['Homeostasis',  ['Good','Bad']],
  q5_stimulants:  ['Stimulants',   ['Regularly','Occasionally']],
  q6_digital:     ['Digital',      ['Yes','No']],
  q7_breathing:   ['Breathing',    ['Okay','Not okay']],
  q8_emotional:   ['Emotional',    ['Problem','No problem']],
}
const Q_KEYS = Object.keys(Q_LABELS)

function cellVal(v, key) {
  if (!v || v === 0) return '—'
  return Q_LABELS[key][1][v - 1] || v
}

export default function QuestionnaireViewer() {
  const { user } = useAuth()
  if (!user) return null
  if (!isMaster(user.email)) return (
    <div style={{padding:'2rem',color:'var(--red)'}}>Access denied</div>
  )

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')  // all | measurement | non-measurement

  const em = encodeURIComponent(user.email)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/questionnaire/all?admin_email=${em}&limit=1000`)
      const d = await r.json()
      setRows(d.responses || [])
    } catch {}
    finally { setLoading(false) }
  }

  const downloadCSV = () => {
    window.open(`${API}/questionnaire/export-csv?admin_email=${em}`, '_blank')
  }

  const filtered = rows.filter(r =>
    filter === 'all' ? true :
    filter === 'measurement' ? r.is_measurement :
    !r.is_measurement
  )

  const measCount = rows.filter(r => r.is_measurement).length
  const nonMeasCount = rows.length - measCount

  return (
    <div>
      <div className="page-header">
        <h1>🗄 Questionnaire Database</h1>
        <p>All 8-factor mental focus responses</p>
      </div>

      {/* Toolbar */}
      <div style={{display:'flex',gap:'.5rem',marginBottom:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
        {[['all',`All (${rows.length})`],
          ['measurement',`Measurements (${measCount})`],
          ['non-measurement',`Non-measurements (${nonMeasCount})`]].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`btn btn-sm ${filter===k?'btn-primary':'btn-secondary'}`}>
            {l}
          </button>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={load}>↺ Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={downloadCSV}>↓ Export CSV</button>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div style={{color:'var(--muted)',padding:'2rem',textAlign:'center'}}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{color:'var(--dim)',padding:'2rem',textAlign:'center'}}>No data yet</div>
        ) : (
          <div className="tbl-wrap" style={{maxHeight:600,overflowX:'auto'}}>
            <table style={{fontSize:'.75rem',whiteSpace:'nowrap'}}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Email</th>
                  <th>Type</th>
                  <th>#</th>
                  {Q_KEYS.map(k => <th key={k}>{Q_LABELS[k][0]}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td style={{color:'var(--muted)',fontSize:'.68rem'}}>
                      {r.created_at?.slice(0,16)}
                    </td>
                    <td style={{color:'var(--text)'}}>{r.user_email}</td>
                    <td>
                      <span style={{fontSize:'.65rem',padding:'.1rem .4rem',borderRadius:4,
                        background: r.is_measurement ? 'rgba(0,255,136,.15)' : 'rgba(255,136,0,.15)',
                        color: r.is_measurement ? 'var(--green)' : 'var(--amber)'}}>
                        {r.is_measurement ? 'real' : 'seed'}
                      </span>
                    </td>
                    <td style={{color:'var(--dim)',textAlign:'center'}}>{r.answered_count}</td>
                    {Q_KEYS.map(k => (
                      <td key={k} style={{
                        color: r[k] ? 'var(--text)' : 'var(--dim)',
                        textAlign:'center'
                      }}>
                        {cellVal(r[k], k)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{fontSize:'.72rem',color:'var(--dim)',marginTop:'.5rem'}}>
        CSV grows with every new user upload. Real responses marked "real", seed/fictitious marked "seed".
      </div>
    </div>
  )
}
