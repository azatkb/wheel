import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e||'').toLowerCase())

const TYPE_LABELS = {
  subscription_pro:      { label:'Pro Subscription',      icon:'⚡' },
  subscription_ultimate: { label:'Ultimate Subscription', icon:'🌟' },
  video:    { label:'Video',    icon:'🎬' },
  pdf:      { label:'PDF',      icon:'📄' },
  physical: { label:'Physical', icon:'📦' },
}

function ProductModal({ user, product, onClose, onSaved }) {
  const isEdit = !!product
  const [form, setForm] = useState(isEdit ? {
    name: product.name || '',
    description: product.description || '',
    type: product.type || 'video',
    price_usd: product.price_usd || '',
    price_annual: product.price_annual || '',
    file_url: product.file_url || '',
    image_url: product.image_url || '',
    stock: product.stock || '',
    active: product.active ?? true,
    metadata: JSON.stringify(product.metadata || {})
  } : {
    name:'', description:'', type:'video', price_usd:'',
    price_annual:'', file_url:'', image_url:'', stock:'', active:true, metadata:'{}'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!form.name || !form.price_usd) { setError('Name and price required'); return }
    setSaving(true); setError('')
    let metadata = {}
    try { metadata = JSON.parse(form.metadata || '{}') } catch {}
    const body = {
      ...form,
      price_usd: parseFloat(form.price_usd),
      price_annual: form.price_annual ? parseFloat(form.price_annual) : null,
      stock: form.stock ? parseInt(form.stock) : null,
      metadata,
      admin_email: user.email,
    }
    const url = isEdit ? `${API}/store/products/${product.id}` : `${API}/store/products`
    const method = isEdit ? 'PUT' : 'POST'
    const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    if (r.ok) { onSaved() }
    else { const d = await r.json(); setError(d.detail || 'Error') }
    setSaving(false)
  }

  const TYPE_OPTS = {
    subscription_pro: '⚡ Pro Subscription',
    subscription_ultimate: '🌟 Ultimate Subscription',
    video: '💾 Digital Product',
    pdf: '📄 PDF',
    physical: '📦 Physical',
  }

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,.7)',
      zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'
    }} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{
        background:'var(--bg2)',border:'1px solid var(--border)',
        borderRadius:12,width:'100%',maxWidth:600,maxHeight:'90vh',
        overflow:'auto',padding:'1.5rem',position:'relative'
      }}>
        <button onClick={onClose} style={{
          position:'absolute',top:'1rem',right:'1rem',
          background:'none',border:'none',color:'var(--muted)',fontSize:'1.3rem',cursor:'pointer'
        }}>×</button>

        <div style={{fontWeight:700,fontSize:'1rem',color:'var(--text)',marginBottom:'1.25rem'}}>
          {isEdit ? '✏️ Edit Product' : '+ Add Product'}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.75rem'}}>
          {/* Type */}
          <div style={{gridColumn:'1/-1'}}>
            <label className="form-label">Type</label>
            <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
              className="form-input">
              {Object.entries(TYPE_OPTS).map(([k,v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Name */}
          <div style={{gridColumn:'1/-1'}}>
            <label className="form-label">Name *</label>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}
              placeholder="Product name" className="form-input" />
          </div>

          {/* Prices */}
          <div>
            <label className="form-label">Price USD *</label>
            <input value={form.price_usd} onChange={e=>setForm(f=>({...f,price_usd:e.target.value}))}
              type="number" step="0.01" placeholder="19.00" className="form-input" />
          </div>
          <div>
            <label className="form-label">Annual Price (optional)</label>
            <input value={form.price_annual} onChange={e=>setForm(f=>({...f,price_annual:e.target.value}))}
              type="number" step="0.01" placeholder="149.00" className="form-input" />
          </div>

          {/* Image */}
          <div style={{gridColumn:'1/-1'}}>
            <label className="form-label">Image</label>
            <ImageUploader adminEmail={user.email}
              initialUrl={form.image_url}
              onUploaded={url => setForm(f=>({...f,image_url:url}))} />
            <input value={form.image_url} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))}
              placeholder="Or paste URL..." className="form-input" style={{marginTop:'.4rem'}} />
          </div>

          {/* File (for digital) */}
          {['video','pdf'].includes(form.type) && (
            <div style={{gridColumn:'1/-1'}}>
              <label className="form-label">File (video/pdf)</label>
              <FileUploader adminEmail={user.email} fileType={form.type}
                onUploaded={url => setForm(f=>({...f,file_url:url}))} />
              <input value={form.file_url} onChange={e=>setForm(f=>({...f,file_url:e.target.value}))}
                placeholder="Or paste URL..." className="form-input" style={{marginTop:'.4rem'}} />
            </div>
          )}

          {/* Stock */}
          <div>
            <label className="form-label">Stock (empty = unlimited)</label>
            <input value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))}
              type="number" placeholder="20" className="form-input" />
          </div>

          {/* Metadata for physical */}
          {form.type === 'physical' && (
            <div>
              <label className="form-label">Metadata JSON</label>
              <input value={form.metadata} onChange={e=>setForm(f=>({...f,metadata:e.target.value}))}
                placeholder='{"weight_kg":0.3}' className="form-input" />
            </div>
          )}

          {/* Description */}
          <div style={{gridColumn:'1/-1'}}>
            <label className="form-label">Description</label>
            <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="Product description..." className="form-input"
              style={{minHeight:80,resize:'vertical'}} />
          </div>

          {/* Active */}
          <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
            <input type="checkbox" id="modal_active" checked={form.active}
              onChange={e=>setForm(f=>({...f,active:e.target.checked}))}
              style={{accentColor:'var(--green)',width:16,height:16}} />
            <label htmlFor="modal_active" style={{color:'var(--text)',cursor:'pointer'}}>
              Active (visible in store)
            </label>
          </div>
        </div>

        <button onClick={save} disabled={saving} className="btn btn-primary"
          style={{width:'100%',marginTop:'1.25rem'}}>
          {saving ? 'Saving...' : isEdit ? '💾 Save Changes' : '+ Add Product'}
        </button>
      </div>
    </div>
  )
}

function ImageUploader({ adminEmail, onUploaded, initialUrl }) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(initialUrl ? (initialUrl.startsWith('/') ? `${API}${initialUrl}` : initialUrl) : null)

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('admin_email', adminEmail)
    const r = await fetch(`${API}/store/upload-image`, { method:'POST', body: fd })
    const d = await r.json()
    if (r.ok) onUploaded(d.url)
    setUploading(false)
  }

  return (
    <div style={{display:'flex',alignItems:'center',gap:'.75rem',flexWrap:'wrap'}}>
      <label style={{
        display:'flex',alignItems:'center',gap:'.4rem',
        padding:'.4rem .85rem',borderRadius:6,cursor:'pointer',
        background:'var(--bg3)',border:'1px solid var(--border)',
        color:'var(--muted)',fontSize:'.82rem'
      }}>
        {uploading ? '⏳ Uploading...' : '📁 Upload Image'}
        <input type="file" accept="image/*" onChange={upload}
          style={{display:'none'}} disabled={uploading} />
      </label>
      {preview && <img src={preview} alt="preview"
        style={{width:48,height:48,objectFit:'cover',borderRadius:6,
          border:'1px solid var(--border)'}} />}
    </div>
  )
}

function FileUploader({ adminEmail, fileType, onUploaded }) {
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('admin_email', adminEmail)
    fd.append('file_type', fileType)
    const r = await fetch(`${API}/store/upload-file`, { method:'POST', body: fd })
    const d = await r.json()
    if (r.ok) { onUploaded(d.url); setDone(true) }
    setUploading(false)
  }

  return (
    <label style={{
      display:'inline-flex',alignItems:'center',gap:'.4rem',
      padding:'.4rem .85rem',borderRadius:6,cursor:'pointer',
      background: done ? 'rgba(0,255,136,.1)' : 'var(--bg3)',
      border:`1px solid ${done ? 'var(--green)' : 'var(--border)'}`,
      color: done ? 'var(--green)' : 'var(--muted)',fontSize:'.82rem'
    }}>
      {uploading ? '⏳ Uploading...' : done ? '✓ File uploaded' : `📁 Upload ${fileType}`}
      <input type="file" accept={fileType === 'video' ? 'video/*' : '.pdf'}
        onChange={upload} style={{display:'none'}} disabled={uploading} />
    </label>
  )
}

// ── Visual Bundle Builder — no JSON, all controls ──────────────────────────
function BundleBuilder({ user, products, showMsg }) {
  const em = encodeURIComponent(user.email)
  const physicalProducts = products.filter(p => p.type === 'physical')
  const digitalProducts  = products.filter(p => ['video','pdf'].includes(p.type))

  const [productId, setProductId] = useState('')
  const [grants, setGrants] = useState([])          // list of grant rows (visual)
  const [existing, setExisting] = useState([])       // saved bundles for the selected product
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  // load existing bundle grants when a physical product is selected
  useEffect(() => {
    if (!productId) { setGrants([]); setExisting([]); return }
    ;(async () => {
      setLoading(true)
      try {
        const r = await fetch(`${API}/store/bundles?product_id=${productId}&admin_email=${em}`)
        if (r.ok) {
          const d = await r.json()
          const g = d.grants || d.bundle?.grants || []
          setExisting(Array.isArray(g) ? g : [])
          setGrants(Array.isArray(g) ? g.map(normalizeGrant) : [])
        } else { setExisting([]); setGrants([]) }
      } catch { setExisting([]); setGrants([]) }
      setLoading(false)
    })()
  }, [productId])

  function normalizeGrant(g) {
    if (g.type === 'product') return { kind:'product', product_id:g.product_id || '', months:'' }
    return { kind: g.type, product_id:'', months: g.months || 12 }
  }

  const addGrant = (kind) => {
    if (kind === 'product') setGrants(gs => [...gs, { kind:'product', product_id:'', months:'' }])
    else setGrants(gs => [...gs, { kind, product_id:'', months: 12 }])
  }
  const removeGrant = (i) => setGrants(gs => gs.filter((_,idx) => idx !== i))
  const updateGrant = (i, patch) => setGrants(gs => gs.map((g,idx) => idx===i ? {...g,...patch} : g))

  const toPayload = () => grants.map(g => {
    if (g.kind === 'product') return { type:'product', product_id: g.product_id }
    return { type: g.kind, months: parseInt(g.months) || 12 }
  }).filter(g => g.type !== 'product' || g.product_id)

  const save = async () => {
    if (!productId) { showMsg('Select a physical product first'); return }
    setSaving(true)
    const r = await fetch(`${API}/store/bundles`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ product_id: productId, grants: toPayload(), admin_email: user.email })
    })
    showMsg(r.ok ? '✓ Bundle saved!' : 'Error saving bundle')
    if (r.ok) setExisting(toPayload())
    setSaving(false)
  }

  const grantLabel = (g) => {
    if (g.kind === 'subscription_pro')      return '⚡ Pro subscription'
    if (g.kind === 'subscription_ultimate') return '🌟 Ultimate subscription'
    if (g.kind === 'product')               return '🎬 Free digital product'
    return g.kind
  }

  return (
    <div className="card">
      <div className="card-title">🎁 Bundle Builder</div>
      <p style={{fontSize:'.82rem',color:'var(--muted)',marginBottom:'1rem'}}>
        Pick a physical product, then add what buyers get for free with it. No JSON — just add rows.
      </p>

      {/* Step 1: pick physical product */}
      <label className="form-label">1 · Physical product</label>
      <select value={productId} onChange={e=>setProductId(e.target.value)} className="form-input">
        <option value="">— Select a physical product —</option>
        {physicalProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {physicalProducts.length === 0 && (
        <div style={{fontSize:'.75rem',color:'var(--amber)',marginTop:'.35rem'}}>
          No physical products yet — add one in the Products tab first.
        </div>
      )}

      {productId && (
        <>
          {/* Step 2: grants list */}
          <div style={{marginTop:'1.25rem'}}>
            <label className="form-label">2 · What the buyer gets for free</label>

            {loading ? (
              <div style={{color:'var(--muted)',fontSize:'.85rem',padding:'.5rem 0'}}>Loading…</div>
            ) : grants.length === 0 ? (
              <div style={{color:'var(--dim)',fontSize:'.82rem',padding:'.75rem',
                border:'1px dashed var(--border)',borderRadius:8,textAlign:'center'}}>
                No grants yet. Add one below.
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'.5rem'}}>
                {grants.map((g, i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:'.6rem',
                    background:'var(--bg3)',border:'1px solid var(--border)',
                    borderRadius:8,padding:'.55rem .7rem',flexWrap:'wrap'}}>
                    <span style={{fontSize:'.85rem',color:'var(--text)',minWidth:170,fontWeight:600}}>
                      {grantLabel(g)}
                    </span>

                    {/* subscription → months */}
                    {(g.kind === 'subscription_pro' || g.kind === 'subscription_ultimate') && (
                      <span style={{display:'flex',alignItems:'center',gap:'.4rem'}}>
                        <input type="number" min="1" value={g.months}
                          onChange={e=>updateGrant(i,{months:e.target.value})}
                          className="form-input" style={{width:80,padding:'.3rem .5rem'}} />
                        <span style={{fontSize:'.8rem',color:'var(--muted)'}}>months</span>
                      </span>
                    )}

                    {/* product → which digital product */}
                    {g.kind === 'product' && (
                      <select value={g.product_id}
                        onChange={e=>updateGrant(i,{product_id:e.target.value})}
                        className="form-input" style={{flex:1,minWidth:180,padding:'.3rem .5rem'}}>
                        <option value="">— choose digital product —</option>
                        {digitalProducts.map(p => (
                          <option key={p.id} value={p.id}>{TYPE_LABELS[p.type]?.icon} {p.name}</option>
                        ))}
                      </select>
                    )}

                    <button onClick={()=>removeGrant(i)} title="Remove"
                      style={{marginLeft:'auto',background:'none',border:'none',
                        color:'var(--red)',cursor:'pointer',fontSize:'1rem'}}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* add-grant buttons */}
            <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginTop:'.75rem'}}>
              <button onClick={()=>addGrant('subscription_pro')} className="btn btn-sm btn-secondary">
                + ⚡ Pro subscription
              </button>
              <button onClick={()=>addGrant('subscription_ultimate')} className="btn btn-sm btn-secondary">
                + 🌟 Ultimate subscription
              </button>
              <button onClick={()=>addGrant('product')} className="btn btn-sm btn-secondary">
                + 🎬 Free digital product
              </button>
            </div>
          </div>

          {/* Step 3: preview + save */}
          <div style={{marginTop:'1.25rem',background:'rgba(68,170,255,.06)',
            border:'1px solid rgba(68,170,255,.18)',borderRadius:8,padding:'.75rem'}}>
            <div style={{fontSize:'.72rem',color:'var(--blue)',textTransform:'uppercase',
              letterSpacing:'.05em',marginBottom:'.4rem'}}>Preview — buyer gets</div>
            {toPayload().length === 0 ? (
              <div style={{color:'var(--dim)',fontSize:'.82rem'}}>Nothing yet.</div>
            ) : (
              <ul style={{margin:0,paddingLeft:'1.1rem',color:'var(--text)',fontSize:'.85rem'}}>
                {grants.map((g,i) => {
                  if (g.kind === 'product') {
                    const p = digitalProducts.find(x => x.id === g.product_id)
                    return <li key={i}>Free: {p ? p.name : '(choose a product)'}</li>
                  }
                  const label = g.kind === 'subscription_pro' ? 'Pro' : 'Ultimate'
                  return <li key={i}>{label} subscription — {g.months} months</li>
                })}
              </ul>
            )}
          </div>

          <button onClick={save} disabled={saving} className="btn btn-primary"
            style={{marginTop:'1rem'}}>
            {saving ? 'Saving…' : '💾 Save Bundle'}
          </button>
        </>
      )}
    </div>
  )
}

export default function StoreAdmin() {
  const { user } = useAuth()
  if (!user) return null
  if (!isMaster(user.email)) return (
    <div style={{padding:'2rem',color:'var(--red)'}}>Access denied</div>
  )

  const [tab, setTab] = useState('orders')
  const [products, setProducts] = useState([])
  const [coupons, setCoupons] = useState([])
  const [orders, setOrders] = useState([])
  const [couponForm, setCouponForm] = useState({
    code:'', type:'percent', value:'', global:true,
    user_email:'', max_uses:'', valid_until:''
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [editProduct, setEditProduct] = useState(null)  // null=closed, {}=add, {id,...}=edit

  const em = encodeURIComponent(user.email)

  useEffect(() => {
    if (tab === 'products' || tab === 'bundles') loadProducts()
    if (tab === 'coupons'  || tab === 'add_coupon')  loadCoupons()
    if (tab === 'orders')   loadOrders()
  }, [tab])

  const loadProducts = async () => {
    const r = await fetch(`${API}/store/products?include_inactive=true&admin_email=${em}`)
    const d = await r.json(); setProducts(d.products || [])
  }
  const loadCoupons = async () => {
    const r = await fetch(`${API}/store/coupons?admin_email=${em}`)
    const d = await r.json(); setCoupons(d.coupons || [])
  }
  const loadOrders = async () => {
    const r = await fetch(`${API}/store/orders?admin_email=${em}&limit=200`)
    const d = await r.json(); setOrders(d.orders || [])
  }

  const showMsg = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addCoupon = async () => {
    setSaving(true)
    const r = await fetch(`${API}/store/coupons`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({...couponForm, admin_email: user.email,
        value: parseFloat(couponForm.value) || 0,
        max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null,
        global: couponForm.global === true || couponForm.global === 'true' })
    })
    const d = await r.json()
    showMsg(r.ok ? '✓ Coupon created!' : 'Error: ' + d.detail)
    if (r.ok) { loadCoupons() }
    setSaving(false)
  }

  const toggleProduct = async (id, active) => {
    await fetch(`${API}/store/products/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ active: !active, admin_email: user.email })
    }); loadProducts()
  }

  const TABS = [
    { id:'orders',      label:'📋 Orders' },
    { id:'products',    label:'📦 Products' },
    { id:'add_product', label:'+ Product', action: () => setEditProduct({}) },
    { id:'coupons',     label:'🏷 Coupons' },
    { id:'add_coupon',  label:'+ Coupon' },
    { id:'bundles',     label:'🎁 Bundles' },
  ]

  return (
    <div>
      <div className="page-header">
        <h1>⬡ Store Admin</h1>
        <p>Manage products, coupons, bundles and orders</p>
      </div>

      <div style={{display:'flex',gap:'.4rem',marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => t.action ? t.action() : setTab(t.id)}
            className={`btn btn-sm ${tab===t.id ? 'btn-primary' : 'btn-secondary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div style={{padding:'.5rem 1rem',borderRadius:6,marginBottom:'1rem',fontSize:'.85rem',
          background: msg.startsWith('✓') ? 'rgba(0,255,136,.1)' : 'rgba(255,68,68,.1)',
          color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${msg.startsWith('✓') ? 'rgba(0,255,136,.3)' : 'rgba(255,68,68,.3)'}`}}>
          {msg}
        </div>
      )}

      {/* ── Orders ── */}
      {tab === 'orders' && (
        <div className="card">
          <div className="card-title">All Orders ({orders.length})</div>
          <div className="tbl-wrap" style={{maxHeight:500}}>
            <table>
              <thead><tr>
                <th>Date</th><th>Email</th><th>Items</th>
                <th>Total</th><th>Discount</th><th>Status</th>
                <th>Coupon</th><th>Shipping</th>
              </tr></thead>
              <tbody>
                {orders.map(o => {
                  let items = []; try { items = JSON.parse(o.items||'[]') } catch {}
                  return (
                    <tr key={o.id}>
                      <td style={{color:'var(--muted)',fontSize:'.7rem',whiteSpace:'nowrap'}}>
                        {o.created_at?.slice(0,16)}
                      </td>
                      <td style={{color:'var(--text)',fontSize:'.78rem'}}>{o.user_email}</td>
                      <td style={{color:'var(--muted)',fontSize:'.72rem'}}>
                        {items.map(i=>i.name).join(', ')}
                      </td>
                      <td style={{color:'var(--green)',fontWeight:700}}>${o.total_usd}</td>
                      <td style={{color:'var(--amber)'}}>{o.discount_usd > 0 ? `-$${o.discount_usd}` : '—'}</td>
                      <td>
                        <span style={{fontSize:'.7rem',padding:'.15rem .4rem',borderRadius:4,fontWeight:600,
                          background: o.status==='fulfilled' ? 'rgba(0,255,136,.15)'
                                   : o.status==='paid'       ? 'rgba(68,170,255,.15)'
                                   : 'rgba(255,136,0,.15)',
                          color: o.status==='fulfilled' ? 'var(--green)'
                               : o.status==='paid'       ? 'var(--blue)' : 'var(--amber)'}}>
                          {o.status}
                        </span>
                      </td>
                      <td style={{color:'var(--amber)',fontSize:'.75rem'}}>{o.coupon_code||'—'}</td>
                      <td style={{color:'var(--muted)',fontSize:'.7rem'}}>
                        {o.shipping_country ? `${o.shipping_city||''}, ${o.shipping_country}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Products list ── */}
      {tab === 'products' && (
        <div className="card">
          <div className="card-title">Products ({products.length})</div>
          <div className="tbl-wrap" style={{maxHeight:450}}>
            <table>
              <thead><tr>
                <th>Name</th><th>Type</th><th>Monthly</th>
                <th>Annual</th><th>Stock</th><th>Active</th><th></th>
              </tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td style={{color:'var(--text)',fontWeight:500}}>{p.name}</td>
                    <td style={{color:'var(--muted)',fontSize:'.72rem'}}>
                      {TYPE_LABELS[p.type]?.icon} {p.type}
                    </td>
                    <td style={{color:'var(--green)'}}>${p.price_usd}</td>
                    <td style={{color:'var(--dim)'}}>{p.price_annual ? `$${p.price_annual}` : '—'}</td>
                    <td style={{color:'var(--muted)'}}>{p.stock ?? '∞'}</td>
                    <td>
                      <button onClick={() => toggleProduct(p.id, p.active)} style={{
                        fontSize:'.72rem',padding:'.15rem .5rem',borderRadius:4,cursor:'pointer',border:'none',
                        background: p.active ? 'rgba(0,255,136,.15)' : 'rgba(255,68,68,.1)',
                        color: p.active ? 'var(--green)' : 'var(--red)'}}>
                        {p.active ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td style={{display:'flex',gap:'.3rem'}}>
                      <button onClick={() => setEditProduct(p)}
                        style={{background:'none',border:'1px solid var(--border)',
                          borderRadius:4,color:'var(--blue)',cursor:'pointer',
                          fontSize:'.72rem',padding:'.15rem .4rem'}}>Edit</button>
                      <button onClick={async () => {
                        if (!confirm('Deactivate?')) return
                        await fetch(`${API}/store/products/${p.id}?admin_email=${em}`, {method:'DELETE'})
                        loadProducts()
                      }} style={{background:'none',border:'none',color:'var(--dim)',
                        cursor:'pointer',fontSize:'.75rem'}}>Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Coupons list ── */}
      {tab === 'coupons' && (
        <div className="card">
          <div className="card-title">Coupons ({coupons.length})</div>
          <div className="tbl-wrap" style={{maxHeight:450}}>
            <table>
              <thead><tr>
                <th>Code</th><th>Type</th><th>Value</th>
                <th>Global</th><th>User</th><th>Uses</th><th>Expires</th><th>Active</th>
              </tr></thead>
              <tbody>
                {coupons.map(c => (
                  <tr key={c.id}>
                    <td style={{color:'var(--amber)',fontFamily:'monospace',fontWeight:700,
                      letterSpacing:'.05em'}}>{c.code}</td>
                    <td style={{color:'var(--muted)',fontSize:'.75rem'}}>{c.type}</td>
                    <td style={{color:'var(--green)',fontWeight:600}}>
                      {c.type==='percent' ? `${c.value}%` :
                       c.type==='fixed'   ? `$${c.value}` : 'FREE'}
                    </td>
                    <td style={{color: c.global ? 'var(--green)' : 'var(--dim)'}}>
                      {c.global ? 'Yes' : 'No'}
                    </td>
                    <td style={{color:'var(--muted)',fontSize:'.72rem'}}>{c.user_email||'—'}</td>
                    <td style={{color:'var(--dim)'}}>
                      {c.used_count||0}{c.max_uses ? `/${c.max_uses}` : ''}
                    </td>
                    <td style={{color:'var(--dim)',fontSize:'.72rem'}}>
                      {c.valid_until ? c.valid_until.slice(0,10) : '∞'}
                    </td>
                    <td style={{color: c.active ? 'var(--green)' : 'var(--red)',fontSize:'.75rem'}}>
                      {c.active ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add coupon ── */}
      {tab === 'add_coupon' && (
        <div className="card">
          <div className="card-title">Create Coupon</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.75rem'}}>
            <div style={{gridColumn:'1/-1'}}>
              <label className="form-label">Type</label>
              <select value={couponForm.type}
                onChange={e=>setCouponForm(f=>({...f,type:e.target.value}))}
                className="form-input">
                <option value="percent">Percent % off</option>
                <option value="fixed">Fixed $ amount off</option>
                <option value="free">Free (100% off)</option>
              </select>
            </div>
            {[
              ['code','Code (e.g. SAVE25) *'],
              ['value','Value (25 for 25%, or 10 for $10)'],
              ['user_email','Specific user email (personal coupon)'],
              ['max_uses','Max uses (empty = unlimited)'],
              ['valid_until','Valid until (YYYY-MM-DD)'],
            ].map(([k,pl]) => (
              <div key={k}>
                <label className="form-label">{pl}</label>
                <input value={couponForm[k]}
                  onChange={e=>setCouponForm(f=>({...f,[k]:e.target.value}))}
                  placeholder={pl} className="form-input" />
              </div>
            ))}
            <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
              <input type="checkbox" id="global_c" checked={couponForm.global}
                onChange={e=>setCouponForm(f=>({...f,global:e.target.checked}))}
                style={{accentColor:'var(--green)',width:16,height:16}} />
              <label htmlFor="global_c" style={{color:'var(--text)',cursor:'pointer'}}>
                Global (all users)
              </label>
            </div>
            <div style={{gridColumn:'1/-1',background:'rgba(255,136,0,.08)',
              border:'1px solid rgba(255,136,0,.2)',borderRadius:8,padding:'.75rem',
              fontSize:'.8rem',color:'var(--muted)'}}>
              <strong style={{color:'var(--amber)'}}>Examples:</strong><br/>
              • 25% off all users: type=percent, value=25, global=✓<br/>
              • Free for one user: type=free, value=0, user_email=john@..., max_uses=1, global=✗<br/>
              • $10 off promo: type=fixed, value=10, max_uses=500, global=✓
            </div>
            <button onClick={addCoupon} disabled={saving}
              className="btn btn-primary" style={{gridColumn:'1/-1'}}>
              {saving ? 'Saving...' : '+ Create Coupon'}
            </button>
          </div>
        </div>
      )}

      {/* ── Bundles (visual builder) ── */}
      {tab === 'bundles' && (
        <BundleBuilder user={user} products={products} showMsg={showMsg} />
      )}

      {/* Product Add/Edit Modal */}
      {editProduct !== null && (
        <ProductModal
          user={user}
          product={Object.keys(editProduct).length > 0 ? editProduct : null}
          onClose={() => setEditProduct(null)}
          onSaved={() => { setEditProduct(null); loadProducts(); showMsg('✓ Saved!') }}
        />
      )}
    </div>
  )
}