import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e||'').toLowerCase())

const FACTORS = [
  ['q1_illness',     'Illness & Immune Status'],
  ['q2_loneliness',  'Loneliness & Isolation'],
  ['q3_sleep',       'Sleep & Circadian Rhythm'],
  ['q4_homeostasis', 'Hydration & Blood Glucose'],
  ['q5_stimulants',  'Stimulants & Smoking'],
  ['q6_digital',     'Digital Fragmentation'],
  ['q7_breathing',   'Breathing & Oxygenation'],
  ['q8_emotional',   'Emotional Noise & Anxiety'],
]

export default function Statistics() {
  const { user } = useAuth()
  const master = isMaster(user?.email)
  const canUse = master || user?.plan === 'ultimate'

  const [factor, setFactor] = useState('q1_illness')
  const [factorResult, setFactorResult] = useState(null)
  const [factorLoading, setFactorLoading] = useState(false)
  const [myFactors, setMyFactors] = useState(null)   // non-master: keys the user answered
  const [g1, setG1] = useState('Group 1')
  const [g2, setG2] = useState('Group 2')
  const [A, setA] = useState(''); const [B, setB] = useState('')
  const [C, setC] = useState(''); const [D, setD] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Non-master Ultimate user: which factors did they answer?
  useEffect(() => {
    if (!user || master) return
    fetch(`${API}/questionnaire/my?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(d => {
        const marked = FACTORS.map(([k]) => k).filter(k => d && +d[k] > 0)
        setMyFactors(marked)
        if (marked.length && !marked.includes(factor)) setFactor(marked[0])
      })
      .catch(() => setMyFactors([]))
  }, [user, master])

  const runFactor = async (f) => {
    setFactorLoading(true); setFactorResult(null)
    try {
      const r = await fetch(`${API}/stats/factor-analysis?factor=${f}&admin_email=${encodeURIComponent(user.email)}`)
      const d = await r.json()
      setFactorResult(d)
    } catch {}
    finally { setFactorLoading(false) }
  }

  const compute = async () => {
    setError(''); setResult(null)
    const vals = [A, B, C, D].map(v => parseInt(v))
    if (vals.some(v => isNaN(v) || v < 0)) {
      setError('Enter valid non-negative numbers for A, B, C, D'); return
    }
    setLoading(true)
    try {
      const r = await fetch(`${API}/stats/odds-ratio`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ A: vals[0], B: vals[1], C: vals[2], D: vals[3],
          group1_label: g1, group2_label: g2 })
      })
      const d = await r.json()
      if (!r.ok) { setError(d.detail || 'Error'); return }
      setResult(d)
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  const copyFootnote = () => { if (result?.footnote) navigator.clipboard.writeText(result.footnote) }

  if (!user) return null
  if (!canUse) return (
    <div>
      <div className="page-header"><h1>📊 Statistics — Odds Ratio</h1></div>
      <div className="card" style={{textAlign:'center',padding:'2rem'}}>
        <div style={{fontSize:'1rem',fontWeight:700,marginBottom:'.4rem'}}>Ultimate feature</div>
        <p style={{color:'var(--muted)',marginBottom:'1rem'}}>
          The Odds Ratio analysis is part of the Ultimate plan. Upgrade to see how each focus
          factor relates to your power results.
        </p>
        <a href={(import.meta.env.PROD ? '/kinetic' : '') + '/subscription'}>
          <button className="btn btn-primary">Upgrade to Ultimate</button>
        </a>
      </div>
    </div>
  )

  const visibleFactors = master ? FACTORS : FACTORS.filter(([k]) => (myFactors || []).includes(k))

  return (
    <div>
      <div className="page-header">
        <h1>📊 Statistics — Odds Ratio</h1>
        <p>Measure the association between a focus factor and high/low results</p>
      </div>

      <div className="card">
        <div className="card-title">How it works</div>
        <p style={{fontSize:'.88rem',color:'var(--muted)',lineHeight:1.7}}>
          The Odds Ratio (OR) measures how strongly a focus factor (e.g. good sleep vs poor sleep)
          is associated with achieving a high power result. The 2×2 table is built automatically
          from everyone's questionnaire answers and measured power (High = at/above average power).
        </p>
      </div>

      {/* Auto factor analysis */}
      <div className="card">
        <div className="card-title">Focus Factor vs Power</div>
        <p style={{fontSize:'.88rem',color:'var(--muted)',marginBottom:'.85rem',lineHeight:1.6}}>
          {master
            ? 'Pick one of the 8 focus factors. The 2×2 table is built from all questionnaire answers and measured power.'
            : 'Pick one of the factors you answered in the Focus Test. The result is computed across all users (no personal data shown).'}
        </p>

        {!master && myFactors !== null && visibleFactors.length === 0 ? (
          <div style={{padding:'.75rem',borderRadius:8,background:'rgba(255,136,0,.1)',
            color:'var(--amber)',fontSize:'.88rem'}}>
            Answer at least one factor in the Focus Test to unlock your tables.
          </div>
        ) : (
          <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',alignItems:'flex-end'}}>
            <div style={{flex:1,minWidth:220}}>
              <label className="form-label">Focus factor</label>
              <select value={factor} onChange={e=>setFactor(e.target.value)} className="form-input">
                {visibleFactors.map(([k,l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <button onClick={() => runFactor(factor)} disabled={factorLoading}
              className="btn btn-primary">
              {factorLoading ? '...' : 'Analyze'}
            </button>
          </div>
        )}

        {factorResult && (
          factorResult.error ? (
            <div style={{marginTop:'1rem',padding:'.75rem',borderRadius:8,
              background:'rgba(255,136,0,.1)',color:'var(--amber)',fontSize:'.85rem'}}>
              {factorResult.error}
            </div>
          ) : (
            <div style={{marginTop:'1rem'}}>
              <div style={{textAlign:'center',padding:'1rem',
                background: factorResult.significant ? 'rgba(0,255,136,.06)' : 'rgba(255,136,0,.06)',
                borderRadius:10,
                border:`1px solid ${factorResult.significant ? 'rgba(0,255,136,.3)' : 'rgba(255,136,0,.3)'}`}}>
                <div style={{fontSize:'.78rem',color:'var(--muted)'}}>Odds Ratio</div>
                <div style={{fontSize:'2.2rem',fontWeight:800,fontFamily:'monospace',
                  color: factorResult.significant ? 'var(--green)' : 'var(--amber)'}}>
                  {factorResult.odds_ratio}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',
                gap:'.5rem',marginTop:'.75rem'}}>
                <div className="metric-box"><div className="metric-val" style={{fontSize:'.95rem'}}>
                  {factorResult.ci_lower}–{factorResult.ci_upper}</div>
                  <div className="metric-label">95% CI</div></div>
                <div className="metric-box"><div className="metric-val" style={{fontSize:'1rem'}}>
                  {factorResult.chi2}</div><div className="metric-label">Chi²</div></div>
                <div className="metric-box"><div className="metric-val" style={{fontSize:'1rem',
                  color: factorResult.p_value<0.05?'var(--green)':'var(--amber)'}}>
                  {factorResult.p_value<0.001?'<0.001':factorResult.p_value}</div>
                  <div className="metric-label">p-value</div></div>
                <div className="metric-box"><div className="metric-val" style={{fontSize:'1rem'}}>
                  {factorResult.N}</div><div className="metric-label">N</div></div>
              </div>
              <div style={{textAlign:'center',fontSize:'.92rem',color:'var(--text)',
                fontWeight:600,margin:'.85rem 0 0',padding:'.6rem',
                background:'var(--bg3)',borderRadius:8}}>
                „Our confidence level is 95%"
              </div>
            </div>
          )
        )}
      </div>

      {/* Manual 2×2 — master only */}
      {master && (
        <div className="card">
          <div className="card-title">Manual 2×2 Contingency Table</div>
          <div style={{display:'flex',gap:'.75rem',marginBottom:'1rem',flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:160}}>
              <label className="form-label">Group 1 name</label>
              <input value={g1} onChange={e=>setG1(e.target.value)} className="form-input" placeholder="e.g. Smoker" />
            </div>
            <div style={{flex:1,minWidth:160}}>
              <label className="form-label">Group 2 name</label>
              <input value={g2} onChange={e=>setG2(e.target.value)} className="form-input" placeholder="e.g. Non-smoker" />
            </div>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:'1rem'}}>
            <thead><tr>
              <th style={{padding:'.5rem',textAlign:'left',color:'var(--muted)',fontSize:'.78rem'}}></th>
              <th style={{padding:'.5rem',color:'var(--green)',fontSize:'.8rem'}}>High Result</th>
              <th style={{padding:'.5rem',color:'var(--dim)',fontSize:'.8rem'}}>Low Result</th>
            </tr></thead>
            <tbody>
              <tr>
                <td style={{padding:'.5rem',color:'var(--text)',fontWeight:600,fontSize:'.85rem'}}>{g1}</td>
                <td style={{padding:'.4rem'}}><input value={A} onChange={e=>setA(e.target.value)} type="number" min="0" className="form-input" placeholder="A" style={{textAlign:'center'}} /></td>
                <td style={{padding:'.4rem'}}><input value={B} onChange={e=>setB(e.target.value)} type="number" min="0" className="form-input" placeholder="B" style={{textAlign:'center'}} /></td>
              </tr>
              <tr>
                <td style={{padding:'.5rem',color:'var(--text)',fontWeight:600,fontSize:'.85rem'}}>{g2}</td>
                <td style={{padding:'.4rem'}}><input value={C} onChange={e=>setC(e.target.value)} type="number" min="0" className="form-input" placeholder="C" style={{textAlign:'center'}} /></td>
                <td style={{padding:'.4rem'}}><input value={D} onChange={e=>setD(e.target.value)} type="number" min="0" className="form-input" placeholder="D" style={{textAlign:'center'}} /></td>
              </tr>
            </tbody>
          </table>
          {error && <div className="error-msg">{error}</div>}
          <button onClick={compute} disabled={loading} className="btn btn-primary" style={{width:'100%'}}>
            {loading ? 'Computing...' : 'Calculate Odds Ratio'}
          </button>
        </div>
      )}

      {master && result && (
        <div className="card">
          <div className="card-title">Result</div>
          <div style={{textAlign:'center',padding:'1rem 0',
            background: result.significant ? 'rgba(0,255,136,.06)' : 'rgba(255,136,0,.06)',
            borderRadius:10,marginBottom:'1rem',
            border:`1px solid ${result.significant ? 'rgba(0,255,136,.3)' : 'rgba(255,136,0,.3)'}`}}>
            <div style={{fontSize:'.78rem',color:'var(--muted)',marginBottom:'.2rem'}}>Odds Ratio</div>
            <div style={{fontSize:'2.5rem',fontWeight:800,
              color: result.significant ? 'var(--green)' : 'var(--amber)',fontFamily:'monospace'}}>
              {result.odds_ratio}
            </div>
            <div style={{fontSize:'.85rem',color:'var(--text)',marginTop:'.3rem',padding:'0 1rem'}}>{result.summary}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'.75rem',marginBottom:'1rem'}}>
            <div className="metric-box"><div className="metric-val" style={{fontSize:'1rem'}}>{result.ci_lower}–{result.ci_upper}</div><div className="metric-label">95% CI</div></div>
            <div className="metric-box"><div className="metric-val" style={{fontSize:'1.1rem'}}>{result.chi2}</div><div className="metric-label">Chi-square</div></div>
            <div className="metric-box"><div className="metric-val" style={{fontSize:'1.1rem',color: result.p_value < 0.05 ? 'var(--green)' : 'var(--amber)'}}>{result.p_value < 0.001 ? '<0.001' : result.p_value}</div><div className="metric-label">p-value</div></div>
            <div className="metric-box"><div className="metric-val" style={{fontSize:'1.1rem'}}>{result.N}</div><div className="metric-label">Sample (N)</div></div>
          </div>
          <div style={{padding:'.85rem 1rem',borderRadius:8,marginBottom:'1rem',
            background: result.significant ? 'rgba(0,255,136,.1)' : 'rgba(255,136,0,.1)',
            border:`1px solid ${result.significant ? 'rgba(0,255,136,.3)' : 'rgba(255,136,0,.3)'}`,
            color: result.significant ? 'var(--green)' : 'var(--amber)',fontSize:'.88rem',fontWeight:600}}>
            {result.significant
              ? (result.ci_lower > 1 ? '✓ Statistically SIGNIFICANT positive relationship — mathematically sound'
                : result.ci_upper < 1 ? '✓ Statistically SIGNIFICANT negative relationship — mathematically sound'
                : '✓ Statistically significant (p < 0.05)')
              : '⚠ NOT statistically significant — more data needed'}
          </div>
          <div style={{background:'var(--bg3)',borderRadius:8,padding:'.85rem 1rem',border:'1px solid var(--border)'}}>
            <div style={{fontSize:'.7rem',color:'var(--dim)',marginBottom:'.3rem',textTransform:'uppercase',letterSpacing:'.05em'}}>
              Scientific footnote (copy to your slide/document)
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'.5rem'}}>
              <code style={{fontSize:'.85rem',color:'var(--text)',fontFamily:'monospace'}}>{result.footnote}</code>
              <button onClick={copyFootnote} className="btn btn-secondary btn-sm">Copy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}