import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e || '').toLowerCase())

// Benefit keys that are not catalog items
const SPECIAL = [
  ['sw_ultimate',  'Software: Ultimate (free period)'],
  ['sw_pro',       'Software: Pro (rest of year)'],
  ['one_more_unit','Discount: one more numbered unit'],
]

/**
 * Catalog & Hardware Value admin — fully editable pricing / benefits.
 * Everything here writes to the DB; the public pages read from it, so a price
 * or legal change needs no redeploy.
 */
export default function CatalogAdmin() {
  const { user } = useAuth()
  if (!user) return null
  if (!isMaster(user.email)) return <div style={{padding:'2rem',color:'var(--red)'}}>Access denied</div>

  const [data, setData] = useState(null)
  const [tab, setTab]   = useState('series')
  const [msg, setMsg]   = useState('')
  const em = encodeURIComponent(user.email)
  const [reviews, setReviews] = useState([])

  const load = async () => {
    const r = await fetch(`${API}/admin/catalog/all?email=${em}`)
    if (r.ok) setData(await r.json())
  }
  const loadReviews = async () => {
    const r = await fetch(`${API}/admin/pioneer/reviews?email=${em}`)
    if (r.ok) setReviews((await r.json()).reviews || [])
  }
  useEffect(() => { load(); loadReviews() }, [])

  const decide = async (id, decision) => {
    const r = await fetch(`${API}/admin/pioneer/decide`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, decision, admin_email: user.email })
    })
    flash(r.ok ? (decision==='approve'?'✓ Approved — guide unlocked':'Rejected') : 'Error')
    loadReviews()
  }

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }
  const post = async (path, body) => {
    const r = await fetch(`${API}/admin/catalog/${path}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...body, admin_email: user.email })
    })
    flash(r.ok ? '✓ Saved' : 'Error saving')
    return r.ok
  }

  if (!data) return <div style={{padding:'2rem',color:'var(--muted)'}}>Loading…</div>

  const catByKey = {}
  ;(data.catalog || []).forEach(c => { catByKey[`item${c.n}`] = c })
  const benKeys = [...(data.catalog||[]).map(c => [`item${c.n}`, c.title]), ...SPECIAL]
  const benMap = {}
  ;(data.benefits || []).forEach(b => { benMap[`${b.series_id}|${b.item_key}`] = b })

  return (
    <div>
      <div className="page-header">
        <h1>🧾 Catalog &amp; Value Editor</h1>
        <p>Edit prices, included items and discounts. Changes are live — no redeploy.</p>
      </div>

      {msg && <div style={{padding:'.5rem 1rem',borderRadius:6,marginBottom:'1rem',fontSize:'.85rem',
        background:'rgba(0,194,113,.12)',color:'var(--green)',border:'1px solid var(--border)'}}>{msg}</div>}

      <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap'}}>
        {[['series','Hardware & prices'],['catalog','Catalog items'],['benefits','Benefits grid'],['config','Config'],['reviews','Pioneer reviews']].map(([id,l]) => (
          <button key={id} onClick={()=>setTab(id)}
            className={`btn btn-sm ${tab===id?'btn-primary':'btn-secondary'}`}>{l}</button>
        ))}
      </div>

      {/* ── Hardware series + prices ── */}
      {tab==='series' && (
        <div className="card">
          <div className="card-title">Hardware series</div>
          <div className="tbl-wrap">
            <table><thead><tr><th>ID</th><th>Name</th><th>Price $</th><th>Units</th><th>Numbering</th><th></th></tr></thead>
              <tbody>
                {data.series.map((s,i) => (
                  <tr key={s.id}>
                    <td style={{color:'var(--muted)'}}>{s.id}</td>
                    <td><input defaultValue={s.name} className="form-input" style={{minWidth:140}}
                      onChange={e=>s.name=e.target.value}/></td>
                    <td><input defaultValue={s.price} type="number" className="form-input" style={{width:100}}
                      onChange={e=>s.price=e.target.value}/></td>
                    <td><input defaultValue={s.units} className="form-input" style={{width:90}}
                      onChange={e=>s.units=e.target.value}/></td>
                    <td><input defaultValue={s.numbering} className="form-input" style={{minWidth:160}}
                      onChange={e=>s.numbering=e.target.value}/></td>
                    <td><button className="btn btn-sm btn-primary"
                      onClick={()=>post('series',{id:s.id,name:s.name,price:parseFloat(s.price)||0,
                        units:s.units,build:s.build,numbering:s.numbering,sort_order:s.sort_order})}>Save</button></td>
                  </tr>
                ))}
              </tbody></table>
          </div>
        </div>
      )}

      {/* ── Catalog items ── */}
      {tab==='catalog' && (
        <div className="card">
          <div className="card-title">Catalog items (retail prices)</div>
          <div className="tbl-wrap" style={{maxHeight:560}}>
            <table><thead><tr><th>#</th><th>Title</th><th>Type</th><th>Retail $</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {data.catalog.map(c => (
                  <tr key={c.id}>
                    <td style={{color:'var(--muted)'}}>{c.n}</td>
                    <td><input defaultValue={c.title} className="form-input" style={{minWidth:220}}
                      onChange={e=>c.title=e.target.value}/></td>
                    <td><input defaultValue={c.type} className="form-input" style={{width:120}}
                      onChange={e=>c.type=e.target.value}/></td>
                    <td><input defaultValue={c.retail_price} type="number" className="form-input" style={{width:90}}
                      onChange={e=>c.retail_price=e.target.value}/></td>
                    <td><input type="checkbox" defaultChecked={c.active}
                      onChange={e=>c.active=e.target.checked} style={{accentColor:'var(--green)'}}/></td>
                    <td><button className="btn btn-sm btn-primary"
                      onClick={()=>post('item',{id:c.id,n:c.n,title:c.title,description:c.description,
                        type:c.type,retail_price:parseFloat(c.retail_price)||0,active:c.active,sort_order:c.sort_order})}>Save</button></td>
                  </tr>
                ))}
              </tbody></table>
          </div>
        </div>
      )}

      {/* ── Benefits grid: series × item → included / discount ── */}
      {tab==='benefits' && (
        <div className="card">
          <div className="card-title">Benefits per series</div>
          <p style={{fontSize:'.8rem',color:'var(--muted)',marginBottom:'.75rem'}}>
            For each series, set the <b>included</b> value (free with hardware) and the <b>discount</b> (saving if bought). 0 = not offered.
          </p>
          {data.series.map(s => (
            <details key={s.id} style={{marginBottom:'.6rem',border:'1px solid var(--border)',borderRadius:8,padding:'.5rem .75rem'}}>
              <summary style={{cursor:'pointer',fontWeight:700,color:'var(--text)'}}>{s.name}</summary>
              <div className="tbl-wrap" style={{marginTop:'.5rem'}}>
                <table><thead><tr><th>Item</th><th>Included $</th><th>Discount $</th><th></th></tr></thead>
                  <tbody>
                    {benKeys.map(([key,label]) => {
                      const b = benMap[`${s.id}|${key}`] || { included:0, discount:0 }
                      const ref = { inc:b.included||0, dis:b.discount||0 }
                      return (
                        <tr key={key}>
                          <td style={{fontSize:'.8rem'}}>{label}</td>
                          <td><input defaultValue={ref.inc} type="number" className="form-input" style={{width:90}}
                            onChange={e=>ref.inc=e.target.value}/></td>
                          <td><input defaultValue={ref.dis} type="number" className="form-input" style={{width:90}}
                            onChange={e=>ref.dis=e.target.value}/></td>
                          <td><button className="btn btn-sm btn-primary"
                            onClick={()=>post('benefit',{series_id:s.id,item_key:key,
                              included:parseFloat(ref.inc)||0,discount:parseFloat(ref.dis)||0})}>Save</button></td>
                        </tr>
                      )
                    })}
                  </tbody></table>
              </div>
            </details>
          ))}
        </div>
      )}

      {/* ── Free-form config ── */}
      {tab==='reviews' && (
        <div className="card">
          <div className="card-title">Pioneer Program — review submissions</div>
          <p style={{fontSize:'.8rem',color:'var(--muted)',marginBottom:'.75rem'}}>
            Approve a review to unlock the guide (“Why Thought Moves Matter”) free for that owner.
          </p>
          <div className="tbl-wrap" style={{maxHeight:520}}>
            <table><thead><tr><th>Email</th><th>Link</th><th>Platform</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {reviews.map(r => (
                  <tr key={r.id}>
                    <td style={{fontSize:'.8rem'}}>{r.email}</td>
                    <td><a href={r.link} target="_blank" rel="noopener noreferrer"
                      style={{color:'var(--blue)',fontSize:'.78rem'}}>open</a></td>
                    <td style={{color:'var(--muted)',fontSize:'.78rem'}}>{r.platform||'—'}</td>
                    <td><span style={{fontSize:'.72rem',fontWeight:600,
                      color: r.status==='approved'?'var(--green)':r.status==='rejected'?'var(--red)':'var(--amber)'}}>{r.status}</span></td>
                    <td style={{display:'flex',gap:'.3rem'}}>
                      {r.status==='pending' && <>
                        <button className="btn btn-sm btn-primary" onClick={()=>decide(r.id,'approve')}>Approve</button>
                        <button className="btn btn-sm btn-secondary" onClick={()=>decide(r.id,'reject')}>Reject</button>
                      </>}
                    </td>
                  </tr>
                ))}
                {reviews.length===0 && <tr><td colSpan={5} style={{color:'var(--muted)',textAlign:'center',padding:'1rem'}}>No submissions yet.</td></tr>}
              </tbody></table>
          </div>
        </div>
      )}

      {tab==='config' && (
        <div className="card">
          <div className="card-title">Config (software months, discount %, labels)</div>
          <div className="tbl-wrap">
            <table><thead><tr><th>Key</th><th>Value</th><th>Note</th><th></th></tr></thead>
              <tbody>
                {(data.config||[]).map(c => (
                  <tr key={c.key}>
                    <td style={{color:'var(--muted)',fontFamily:'monospace',fontSize:'.78rem'}}>{c.key}</td>
                    <td><input defaultValue={c.value} className="form-input" style={{width:120}}
                      onChange={e=>c.value=e.target.value}/></td>
                    <td style={{fontSize:'.78rem',color:'var(--muted)'}}>{c.note}</td>
                    <td><button className="btn btn-sm btn-primary"
                      onClick={()=>post('config',{key:c.key,value:c.value,note:c.note})}>Save</button></td>
                  </tr>
                ))}
              </tbody></table>
          </div>
        </div>
      )}
    </div>
  )
}