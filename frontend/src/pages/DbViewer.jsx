import { useState, useEffect } from 'react'
import { API } from '../config'
import { useAuth } from '../hooks/useAuth.jsx'
import * as XLSX from 'xlsx'

const MASTER_TOKEN = 'wt_master_2026'
const PAGE_SIZE = 25

// id → real Supabase table name. `special:'samples'` is loaded per job_id.
const TABLES = [
  { id: 'jobs',                label: 'Jobs',                table: 'wt_jobs' },
  { id: 'physics',             label: 'Physics results',     table: 'physics_results' },
  { id: 'users',               label: 'Users',               table: 'wt_users' },
  { id: 'samples',             label: 'Samples (by job id)', special: 'samples' },
  { id: 'forum_posts',         label: 'Forum posts',         table: 'forum_posts' },
  { id: 'forum_comments',      label: 'Forum comments',      table: 'forum_comments' },
  { id: 'forum_likes',         label: 'Forum likes',         table: 'forum_likes' },
  { id: 'forum_notifications', label: 'Forum notifications',  table: 'forum_notifications' },
  { id: 'store_products',      label: 'Store products',      table: 'store_products' },
  { id: 'store_orders',        label: 'Store orders',        table: 'store_orders' },
  { id: 'store_coupons',       label: 'Store coupons',       table: 'store_coupons' },
  { id: 'store_bundle_grants', label: 'Store bundle grants', table: 'store_bundle_grants' },
  { id: 'focus_questionnaire', label: 'Focus questionnaire', table: 'focus_questionnaire' },
  // Computed Odds Ratio tables (one per focus factor) — not raw DB tables
  { id: 'or_q1_illness',     label: '📊 Odds Ratio — Illness',     special: 'oddsratio', factor: 'q1_illness' },
  { id: 'or_q2_loneliness',  label: '📊 Odds Ratio — Loneliness',  special: 'oddsratio', factor: 'q2_loneliness' },
  { id: 'or_q3_sleep',       label: '📊 Odds Ratio — Sleep',       special: 'oddsratio', factor: 'q3_sleep' },
  { id: 'or_q4_homeostasis', label: '📊 Odds Ratio — Hydration/Glucose', special: 'oddsratio', factor: 'q4_homeostasis' },
  { id: 'or_q5_stimulants',  label: '📊 Odds Ratio — Stimulants',  special: 'oddsratio', factor: 'q5_stimulants' },
  { id: 'or_q6_digital',     label: '📊 Odds Ratio — Digital',     special: 'oddsratio', factor: 'q6_digital' },
  { id: 'or_q7_breathing',   label: '📊 Odds Ratio — Breathing',   special: 'oddsratio', factor: 'q7_breathing' },
  { id: 'or_q8_emotional',   label: '📊 Odds Ratio — Emotional',   special: 'oddsratio', factor: 'q8_emotional' },
]

function Table({ rows, cols, page, onPage, total }) {
  if (!rows?.length) return <div style={{color:'var(--muted)',padding:'1rem'}}>No data</div>
  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.75rem',whiteSpace:'nowrap'}}>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} style={{padding:'.35rem .6rem',color:'var(--muted)',
                  borderBottom:'1px solid var(--border)',textAlign:'left',
                  position:'sticky',top:0,background:'var(--bg2)',
                  fontSize:'.68rem',textTransform:'uppercase',letterSpacing:'.04em'}}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{borderBottom:'1px solid rgba(30,42,56,.4)'}}>
                {cols.map(c => (
                  <td key={c} style={{padding:'.28rem .6rem',
                    fontFamily:'var(--font-mono)',maxWidth:240,
                    overflow:'hidden',textOverflow:'ellipsis',
                    color: c === 'status' ?
                      (row[c]==='done'?'var(--green)':row[c]==='error'?'var(--red)':'var(--amber)')
                      : 'var(--text)'}}>
                    {row[c] == null ? <span style={{color:'var(--dim)'}}>—</span>
                      : typeof row[c] === 'object' ? JSON.stringify(row[c]).slice(0,60)
                      : typeof row[c] === 'number' && Math.abs(row[c]) < 0.01 && row[c] !== 0
                        ? row[c].toExponential(2)
                        : String(row[c]).slice(0,40)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div style={{display:'flex',gap:'.35rem',flexWrap:'wrap',
          alignItems:'center',marginTop:'.75rem',fontSize:'.78rem'}}>
          <button className="btn btn-secondary btn-sm"
            onClick={() => onPage(0)} disabled={page===0}>«</button>
          <button className="btn btn-secondary btn-sm"
            onClick={() => onPage(page-1)} disabled={page===0}>‹</button>
          {Array.from({length:Math.min(pages,9)}, (_,i) => {
            const p = pages <= 9 ? i
              : page < 5 ? i
              : page > pages-5 ? pages-9+i
              : page-4+i
            return (
              <button key={p} className={`btn btn-sm ${p===page?'btn-primary':'btn-secondary'}`}
                onClick={() => onPage(p)}>{p+1}</button>
            )
          })}
          <button className="btn btn-secondary btn-sm"
            onClick={() => onPage(page+1)} disabled={page>=pages-1}>›</button>
          <button className="btn btn-secondary btn-sm"
            onClick={() => onPage(pages-1)} disabled={page>=pages-1}>»</button>
          <span style={{color:'var(--muted)',marginLeft:'.5rem'}}>
            {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE, total)} of {total}
          </span>
        </div>
      )}
    </div>
  )
}

export default function DbViewer() {
  const { user } = useAuth()
  const [activeTable, setActiveTable] = useState('jobs')
  const [data, setData] = useState({})
  const [orData, setOrData] = useState({})       // factor -> odds ratio result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pages, setPages] = useState({})
  const [search, setSearch] = useState('')
  const [samplesJobId, setSamplesJobId] = useState('')
  const [samplesInput, setSamplesInput] = useState('')

  useEffect(() => { loadTable(activeTable) }, [activeTable])

  const meta = (id) => TABLES.find(t => t.id === id)

  const loadTable = async (id) => {
    const tbl = meta(id)
    if (tbl?.special === 'samples') return   // loaded via job id
    if (tbl?.special === 'oddsratio') {       // computed Odds Ratio table
      if (orData[id]) return
      setLoading(true); setError('')
      try {
        const r = await fetch(`${API}/stats/factor-analysis?factor=${tbl.factor}&admin_email=${encodeURIComponent(user?.email || '')}`)
        const d = await r.json()
        if (!r.ok) throw new Error(d.detail || 'Error')
        setOrData(prev => ({ ...prev, [id]: d }))
      } catch(e) { setError(e.message) }
      finally { setLoading(false) }
      return
    }
    if (data[id]) return
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/master/table?name=${tbl.table}&token=${MASTER_TOKEN}&limit=5000`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      let rows = d.rows || []
      if (id === 'physics') rows = rows.map(r => ({ ...r, energy_J: r.w_total_air })) // Energy = rotational Work
      setData(prev => ({...prev, [id]: rows}))
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadSamples = async (jobId) => {
    if (!jobId.trim()) return
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/results/${jobId.trim()}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      setData(prev => ({...prev, samples: d || []}))
      setSamplesJobId(jobId.trim())
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const reload = () => {
    setData(prev => ({...prev, [activeTable]: null}))
    setOrData(prev => ({...prev, [activeTable]: undefined}))
    setTimeout(() => loadTable(activeTable), 50)
  }

  const isOdds = meta(activeTable)?.special === 'oddsratio'
  const orRes = orData[activeTable]

  const rows = activeTable === 'samples' && !samplesJobId ? [] : (data[activeTable] || [])
  const filtered = search
    ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
    : rows
  const page = pages[activeTable] || 0
  const pageRows = filtered.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE)
  const cols = rows.length ? Object.keys(rows[0]) : []

  const exportXLSX = () => {
    if (!filtered.length) return
    const colKeys = Object.keys(filtered[0])
    const sheetData = [
      colKeys,
      ...filtered.map(r => colKeys.map(c => {
        const v = r[c]
        if (v == null) return ''
        if (typeof v === 'object') return JSON.stringify(v)
        return v
      }))
    ]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    ws['!cols'] = colKeys.map(c => ({
      wch: Math.min(40, Math.max(c.length,
        ...filtered.slice(0,50).map(r => String(r[c]??'').length)))
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, activeTable)
    XLSX.writeFile(wb, `${activeTable}_export.xlsx`)
  }

  const exportCSV = () => {
    if (!filtered.length) return
    const colKeys = Object.keys(filtered[0])
    const esc = (v) => {
      if (v == null) return ''
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const lines = [colKeys.join(','),
      ...filtered.map(r => colKeys.map(c => esc(r[c])).join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${activeTable}_export.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const sqlTableUrl = () => {
    const tbl = meta(activeTable)
    const name = tbl?.table || ''
    return `${API}/master/export-sql?name=${name}&token=${MASTER_TOKEN}`
  }

  return (
    <div>
      <div className="page-header">
        <h1>Database Viewer</h1>
        <p>All tables · choose one from the menu · search · paginate · export</p>
      </div>

      {/* Controls */}
      <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap',alignItems:'center'}}>
        <label style={{fontSize:'.78rem',color:'var(--muted)'}}>Table:</label>
        <select className="form-input"
          value={activeTable}
          onChange={e => { setActiveTable(e.target.value); setSearch('') }}
          style={{padding:'.45rem .65rem',minWidth:220}}>
          {TABLES.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}{data[t.id] ? ` (${data[t.id].length})` : ''}
            </option>
          ))}
        </select>

        <button className="btn btn-secondary btn-sm" onClick={reload}>↺ Reload</button>

        <span style={{width:1,height:22,background:'var(--border)',margin:'0 .25rem'}} />

        {/* This-table exports */}
        <button className="btn btn-secondary btn-sm" onClick={exportCSV}
          disabled={!filtered.length}>⬇ CSV</button>
        <button className="btn btn-secondary btn-sm" onClick={exportXLSX}
          disabled={!filtered.length}>⬇ XLSX</button>
        {meta(activeTable)?.table && (
          <a href={sqlTableUrl()}>
            <button className="btn btn-secondary btn-sm">⬇ SQL (this table)</button>
          </a>
        )}

        <span style={{width:1,height:22,background:'var(--border)',margin:'0 .25rem'}} />

        {/* Whole-DB exports */}
        <a href={`${API}/master/export-sql?token=${MASTER_TOKEN}`}>
          <button className="btn btn-primary btn-sm">⬇ Full DB · SQL</button>
        </a>
        <a href={`${API}/master/export-csv?token=${MASTER_TOKEN}`}>
          <button className="btn btn-secondary btn-sm">⬇ Full DB · CSV</button>
        </a>
      </div>

      {activeTable === 'samples' && (
        <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={{flex:1,minWidth:280}}>
            <label className="form-label">Job ID</label>
            <input className="form-input" value={samplesInput}
              onChange={e => setSamplesInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && loadSamples(samplesInput)}
              placeholder="Paste job_id from Jobs table..."
              style={{padding:'.45rem .65rem'}} />
          </div>
          <button className="btn btn-primary btn-sm"
            onClick={() => loadSamples(samplesInput)}>
            Load Samples
          </button>
          {samplesJobId && (
            <span style={{color:'var(--muted)',fontSize:'.75rem',alignSelf:'center'}}>
              Job: {samplesJobId.slice(0,8)}...
            </span>
          )}
        </div>
      )}

      <div style={{marginBottom:'1rem'}}>
        <input className="form-input" value={search}
          onChange={e => { setSearch(e.target.value); setPages(p=>({...p,[activeTable]:0})) }}
          placeholder="Search in all columns..."
          style={{padding:'.45rem .65rem',maxWidth:400}} />
        {search && <span style={{color:'var(--muted)',fontSize:'.78rem',marginLeft:'.75rem'}}>
          {filtered.length} / {rows.length} records
        </span>}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading && <div style={{color:'var(--muted)',padding:'1rem'}}>Loading...</div>}

      {!loading && isOdds && (
        <div className="card" style={{padding:'1rem'}}>
          <div className="card-title">{meta(activeTable)?.label}</div>
          {!orRes ? <div style={{color:'var(--muted)'}}>—</div>
            : orRes.error ? (
              <div style={{padding:'.75rem',borderRadius:8,background:'rgba(255,136,0,.1)',
                color:'var(--amber)',fontSize:'.88rem'}}>{orRes.error}</div>
            ) : (
              <>
                <table style={{width:'100%',maxWidth:480,borderCollapse:'collapse',margin:'.25rem 0 1rem',fontSize:'.85rem'}}>
                  <thead><tr>
                    <th style={{padding:'.5rem',textAlign:'left',color:'var(--muted)'}}></th>
                    <th style={{padding:'.5rem',color:'var(--green)'}}>Power ≥ avg</th>
                    <th style={{padding:'.5rem',color:'var(--dim)'}}>Power &lt; avg</th>
                  </tr></thead>
                  <tbody>
                    <tr><td style={{padding:'.5rem',fontWeight:600}}>Answer 1</td>
                      <td style={{padding:'.5rem',textAlign:'center',fontFamily:'var(--font-mono)'}}>{orRes.cells?.A}</td>
                      <td style={{padding:'.5rem',textAlign:'center',fontFamily:'var(--font-mono)'}}>{orRes.cells?.B}</td></tr>
                    <tr><td style={{padding:'.5rem',fontWeight:600}}>Answer 2</td>
                      <td style={{padding:'.5rem',textAlign:'center',fontFamily:'var(--font-mono)'}}>{orRes.cells?.C}</td>
                      <td style={{padding:'.5rem',textAlign:'center',fontFamily:'var(--font-mono)'}}>{orRes.cells?.D}</td></tr>
                  </tbody>
                </table>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'.5rem'}}>
                  <div className="metric-box"><div className="metric-val">{orRes.odds_ratio}</div><div className="metric-label">Odds Ratio</div></div>
                  <div className="metric-box"><div className="metric-val" style={{fontSize:'.95rem'}}>{orRes.ci_lower}–{orRes.ci_upper}</div><div className="metric-label">95% CI</div></div>
                  <div className="metric-box"><div className="metric-val" style={{fontSize:'1rem'}}>{orRes.chi2}</div><div className="metric-label">Chi²</div></div>
                  <div className="metric-box"><div className="metric-val" style={{fontSize:'1rem'}}>{orRes.p_value<0.001?'<0.001':orRes.p_value}</div><div className="metric-label">p-value</div></div>
                  <div className="metric-box"><div className="metric-val">{orRes.n}</div><div className="metric-label">N</div></div>
                </div>
                <div style={{fontSize:'.75rem',color:'var(--dim)',marginTop:'.6rem'}}>
                  avg power = {orRes.avg_power} · rows = focus answer (1/2), cols = power vs average across all users
                </div>
              </>
            )}
        </div>
      )}

      {!loading && !isOdds && (
        <div className="card" style={{padding:'1rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',
            alignItems:'center',marginBottom:'.75rem',flexWrap:'wrap',gap:'.5rem'}}>
            <div className="card-title" style={{margin:0}}>
              {meta(activeTable)?.label} table
            </div>
            <span style={{color:'var(--muted)',fontSize:'.75rem'}}>
              {filtered.length} records · {cols.length} columns
            </span>
          </div>
          <Table
            rows={pageRows}
            cols={cols}
            page={page}
            total={filtered.length}
            onPage={p => setPages(prev => ({...prev, [activeTable]: p}))}
          />
        </div>
      )}
    </div>
  )
}