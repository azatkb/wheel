import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e||'').toLowerCase())

const TYPE_LABELS = {
  subscription_pro:      { label:'Pro Subscription', icon:'⚡', color:'var(--green)' },
  subscription_ultimate: { label:'Ultimate Subscription', icon:'🌟', color:'var(--amber)' },
  video:    { label:'Digital Product', icon:'🎬', color:'var(--blue)' },
  pdf:      { label:'PDF',   icon:'📄', color:'var(--muted)' },
  physical: { label:'Physical', icon:'📦', color:'#00bcd4' },
}

function fmtPrice(p) {
  return p === 0 ? 'Free' : `$${p.toFixed(2)}`
}

// ── Product Card ────────────────────────────────────────────────
function ProductCard({ product, onAdd }) {
  const t = TYPE_LABELS[product.type] || { label: product.type, icon:'🛒', color:'var(--muted)' }
  const isUltimate = product.type === 'subscription_ultimate'
  const [billing, setBilling] = useState('monthly')

  const price = billing === 'annual' && product.price_annual
    ? product.price_annual : product.price_usd
  const perDay = billing === 'annual' && product.price_annual
    ? (product.price_annual / 365).toFixed(2)
    : (product.price_usd / 30).toFixed(2)
  const isSubscription = product.type.startsWith('subscription')

  return (
    <div style={{
      background:'var(--bg2)', border:'1px solid var(--border)',
      borderRadius:12, overflow:'hidden',
      opacity: isUltimate ? 0.7 : 1,
      display:'flex', flexDirection:'column'
    }}>
      {/* Image */}
      {product.image_url ? (
        <img src={(() => {
            const u = product.image_url
            if (!u) return ''
            if (u.startsWith('http')) return u
            if (u.startsWith('/')) return `${API}${u}`
            return `${API}/store/images/${u}`
          })()}
          alt={product.name}
          onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }}
          style={{width:'100%',height:160,objectFit:'cover'}} />
      ) : null}
      <div style={{height:120,background:'var(--bg3)',
        display: product.image_url ? 'none' : 'flex',
        alignItems:'center',justifyContent:'center',fontSize:'3rem'}}>
        {t.icon}
      </div>

      <div style={{padding:'1rem',flex:1,display:'flex',flexDirection:'column'}}>
        {/* Badge */}
        <div style={{display:'flex',gap:'.4rem',marginBottom:'.5rem',flexWrap:'wrap'}}>
          <span style={{fontSize:'.68rem',padding:'.15rem .5rem',borderRadius:4,
            border:`1px solid ${t.color}33`, color:t.color, fontWeight:600}}>
            {t.icon} {t.label}
          </span>
          {isUltimate && (
            <span style={{fontSize:'.68rem',padding:'.15rem .5rem',borderRadius:4,
              background:'rgba(255,136,0,.15)',color:'var(--amber)',fontWeight:700}}>
              Coming Soon
            </span>
          )}
        </div>

        <div style={{fontWeight:700,fontSize:'1rem',color:'var(--text)',marginBottom:'.3rem'}}>
          {product.name}
        </div>
        {product.description && (
          <div style={{fontSize:'.8rem',color:'var(--muted)',marginBottom:'.75rem',
            flex:1,lineHeight:1.6}}>
            {product.description}
          </div>
        )}

        {/* Billing toggle for subscriptions */}
        {isSubscription && product.price_annual && (
          <div style={{display:'flex',gap:'.3rem',marginBottom:'.75rem'}}>
            {['monthly','annual'].map(b => (
              <button key={b} onClick={() => setBilling(b)} style={{
                flex:1, padding:'.3rem', borderRadius:6, fontSize:'.75rem',
                border:`1px solid ${billing===b ? t.color : 'var(--border)'}`,
                background: billing===b ? `${t.color}22` : 'none',
                color: billing===b ? t.color : 'var(--muted)', cursor:'pointer'
              }}>
                {b === 'monthly' ? 'Monthly' : 'Annual'}
                {b === 'annual' && <span style={{display:'block',fontSize:'.65rem',color:'var(--green)'}}>Save!</span>}
              </button>
            ))}
          </div>
        )}

        {/* Price */}
        <div style={{marginBottom:'.75rem'}}>
          <div style={{fontSize:'1.4rem',fontWeight:800,color:t.color}}>
            {fmtPrice(price)}
            {isSubscription && <span style={{fontSize:'.75rem',fontWeight:400,
              color:'var(--muted)',marginLeft:'.3rem'}}>
              /{billing === 'annual' ? 'year' : 'month'}
            </span>}
          </div>
          {isSubscription && (
            <div style={{fontSize:'.72rem',color:'var(--dim)'}}>
              ${perDay}/day
              {billing === 'annual' && product.type === 'subscription_ultimate' && (
                <span style={{color:'var(--green)',marginLeft:'.4rem'}}>· 2 months free!</span>
              )}
            </div>
          )}
        </div>

        <button
          disabled={isUltimate}
          onClick={() => !isUltimate && onAdd({...product, billing})}
          className={`btn ${isUltimate ? 'btn-secondary' : 'btn-primary'} btn-sm`}
          style={{width:'100%'}}>
          {isUltimate ? '🔔 Coming Soon' : '+ Add to Cart'}
        </button>
      </div>
    </div>
  )
}

// ── Cart ────────────────────────────────────────────────────────
function Cart({ items, onRemove, onCheckout, user }) {
  const [coupon, setCoupon] = useState('')
  const [couponData, setCouponData] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [shipping, setShipping] = useState({ name:'', addr:'', city:'', country:'', zip:'' })
  const [billing, setBilling] = useState({ same: true, name:'', addr:'', city:'', country:'', zip:'' })
  const [shippingCost, setShippingCost] = useState(0)
  const [loadingShip, setLoadingShip] = useState(false)

  const hasPhysical = items.some(i => i.type === 'physical')
  const subtotal = items.reduce((s, i) => {
    const price = i.billing === 'annual' && i.price_annual ? i.price_annual : i.price_usd
    return s + price * (i.qty || 1)
  }, 0)
  const discount = couponData
    ? (couponData.type === 'percent' ? subtotal * couponData.value / 100
       : couponData.type === 'fixed'  ? Math.min(couponData.value, subtotal)
       : couponData.type === 'free'   ? subtotal : 0)
    : 0
  const total = Math.max(0, subtotal - discount + shippingCost)

  const validateCoupon = async () => {
    setCouponError('')
    try {
      const r = await fetch(`${API}/store/validate-coupon`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ code: coupon, user_email: user.email })
      })
      const d = await r.json()
      if (!r.ok) { setCouponError(d.detail || 'Invalid'); return }
      setCouponData(d.coupon)
    } catch { setCouponError('Network error') }
  }

  const estimateShipping = async () => {
    if (!shipping.country) return
    setLoadingShip(true)
    const weight = items.filter(i=>i.type==='physical')
      .reduce((s,i) => s + (i.metadata?.weight_kg || 0.3) * (i.qty||1), 0)
    const r = await fetch(`${API}/store/shipping-estimate?country=${shipping.country}&postal_code=${shipping.zip}&weight_kg=${weight}`)
    const d = await r.json()
    setShippingCost(d.cost_usd || 0)
    setLoadingShip(false)
  }

  if (items.length === 0) return (
    <div style={{textAlign:'center',padding:'2rem',color:'var(--dim)'}}>
      <div style={{fontSize:'2rem',marginBottom:'.5rem'}}>🛒</div>
      Cart is empty
    </div>
  )

  return (
    <div>
      {items.map((item, i) => {
        const price = item.billing === 'annual' && item.price_annual ? item.price_annual : item.price_usd
        return (
          <div key={i} style={{display:'flex',justifyContent:'space-between',
            alignItems:'center',padding:'.6rem 0',
            borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{fontSize:'.88rem',fontWeight:600,color:'var(--text)'}}>{item.name}</div>
              <div style={{fontSize:'.72rem',color:'var(--muted)'}}>
                {item.billing === 'annual' ? 'Annual' : item.type.startsWith('subscription') ? 'Monthly' : ''}
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'.75rem'}}>
              <span style={{fontWeight:700,color:'var(--green)'}}>{fmtPrice(price)}</span>
              <button onClick={() => onRemove(i)} style={{
                background:'none',border:'none',color:'var(--dim)',cursor:'pointer',fontSize:'.85rem'
              }}>✕</button>
            </div>
          </div>
        )
      })}

      {/* Coupon */}
      <div style={{marginTop:'1rem',display:'flex',gap:'.4rem'}}>
        <input value={coupon} onChange={e=>setCoupon(e.target.value.toUpperCase())}
          placeholder="Coupon code" className="form-input"
          style={{flex:1,padding:'.4rem .7rem',fontSize:'.85rem'}} />
        <button onClick={validateCoupon} className="btn btn-secondary btn-sm">Apply</button>
      </div>
      {couponError && <div style={{fontSize:'.75rem',color:'var(--red)',marginTop:'.3rem'}}>{couponError}</div>}
      {couponData && <div style={{fontSize:'.75rem',color:'var(--green)',marginTop:'.3rem'}}>
        ✓ Coupon applied: {couponData.type === 'percent' ? `${couponData.value}% off` :
                           couponData.type === 'fixed' ? `$${couponData.value} off` : 'Free!'}
      </div>}

      {/* Billing address - always */}
      <div style={{marginTop:'1rem',padding:'.85rem',background:'var(--bg3)',
        borderRadius:8,border:'1px solid var(--border)'}}>
        <div style={{fontSize:'.75rem',fontWeight:600,color:'var(--muted)',
          marginBottom:'.6rem',textTransform:'uppercase',letterSpacing:'.05em'}}>
          Billing Address
        </div>
        {[['billing_name','Full Name'],['billing_addr','Address'],
          ['billing_city','City'],['billing_country','Country'],['billing_zip','Postal Code']
        ].map(([k,pl]) => (
          <input key={k} value={shipping[k]||''}
            onChange={e => setShipping(s=>({...s,[k]:e.target.value}))}
            placeholder={pl} className="form-input"
            style={{marginBottom:'.4rem',padding:'.4rem .7rem',fontSize:'.82rem'}} />
        ))}
      </div>

      {/* Shipping form for physical */}
      {hasPhysical && (
        <>
          <div style={{marginTop:'1rem',padding:'.85rem',background:'var(--bg3)',
            borderRadius:8,border:'1px solid var(--border)'}}>
            <div style={{fontSize:'.75rem',fontWeight:600,color:'var(--muted)',
              marginBottom:'.6rem',textTransform:'uppercase',letterSpacing:'.05em'}}>
              Shipping Address
            </div>
            {[['name','Full Name'],['addr','Address'],['city','City'],
              ['country','Country (e.g. HU, DE, US)'],['zip','Postal Code']].map(([k,pl]) => (
              <input key={k} value={shipping[k]}
                onChange={e => setShipping(s=>({...s,[k]:e.target.value}))}
                placeholder={pl} className="form-input"
                style={{marginBottom:'.4rem',padding:'.4rem .7rem',fontSize:'.82rem'}} />
            ))}
            <button onClick={estimateShipping} disabled={loadingShip}
              className="btn btn-secondary btn-sm" style={{width:'100%',marginTop:'.4rem'}}>
              {loadingShip ? '...' : '📦 Estimate Shipping (DHL)'}
            </button>
          </div>
          {/* Billing address */}
          <div style={{marginTop:'.75rem',padding:'.85rem',background:'var(--bg3)',
            borderRadius:8,border:'1px solid var(--border)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'.5rem',marginBottom:'.6rem'}}>
              <input type="checkbox" id="same_billing" checked={billing.same}
                onChange={e=>setBilling(b=>({...b,same:e.target.checked}))}
                style={{accentColor:'var(--green)',width:15,height:15}} />
              <label htmlFor="same_billing" style={{fontSize:'.8rem',color:'var(--text)',cursor:'pointer'}}>
                Billing address same as shipping
              </label>
            </div>
            {!billing.same && (
              <>
                <div style={{fontSize:'.75rem',fontWeight:600,color:'var(--muted)',
                  marginBottom:'.6rem',textTransform:'uppercase',letterSpacing:'.05em'}}>
                  Billing Address
                </div>
                {[['name','Full Name'],['addr','Address'],['city','City'],
                  ['country','Country'],['zip','Postal Code']].map(([k,pl]) => (
                  <input key={k} value={billing[k]}
                    onChange={e => setBilling(b=>({...b,[k]:e.target.value}))}
                    placeholder={pl} className="form-input"
                    style={{marginBottom:'.4rem',padding:'.4rem .7rem',fontSize:'.82rem'}} />
                ))}
              </>
            )}
          </div>
          {shippingCost > 0 && (
            <div style={{fontSize:'.8rem',color:'var(--blue)',marginTop:'.5rem',
              padding:'.4rem .7rem',background:'rgba(68,170,255,.08)',borderRadius:6}}>
              📦 Estimated shipping: ${shippingCost.toFixed(2)}
            </div>
          )}
        </>
      )}

      {/* Totals */}
      <div style={{marginTop:'1rem',padding:'.75rem',background:'var(--bg3)',borderRadius:8}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'.85rem',
          color:'var(--muted)',marginBottom:'.3rem'}}>
          <span>Subtotal</span><span>{fmtPrice(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'.85rem',
            color:'var(--green)',marginBottom:'.3rem'}}>
            <span>Discount</span><span>-{fmtPrice(discount)}</span>
          </div>
        )}
        {shippingCost > 0 && (
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'.85rem',
            color:'var(--muted)',marginBottom:'.3rem'}}>
            <span>Shipping</span><span>{fmtPrice(shippingCost)}</span>
          </div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,
          fontSize:'1.1rem',color:'var(--text)',borderTop:'1px solid var(--border)',paddingTop:'.5rem'}}>
          <span>Total</span><span style={{color:'var(--green)'}}>{fmtPrice(total)}</span>
        </div>
      </div>

      <button onClick={() => onCheckout({ coupon_code: coupon, couponData,
          shipping, shipping_cost: shippingCost, total })}
        className="btn btn-primary" style={{width:'100%',marginTop:'1rem',fontSize:'1rem',padding:'.85rem'}}>
        {total === 0 ? '🎁 Claim for Free' : '💳 Checkout'}
      </button>
    </div>
  )
}

// ── Admin Panel ─────────────────────────────────────────────────
function AdminPanel({ user }) {
  const [tab, setTab] = useState('products')
  const [products, setProducts] = useState([])
  const [coupons, setCoupons] = useState([])
  const [orders, setOrders] = useState([])
  const [form, setForm] = useState({
    name:'', description:'', type:'video', price_usd:'',
    price_annual:'', file_url:'', image_url:'', stock:'', active:true
  })
  const [couponForm, setCouponForm] = useState({
    code:'', type:'percent', value:'', global:true,
    user_email:'', max_uses:'', valid_until:''
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (tab === 'products') loadProducts()
    if (tab === 'coupons')  loadCoupons()
    if (tab === 'orders')   loadOrders()
  }, [tab])

  const loadProducts = async () => {
    const r = await fetch(`${API}/store/products?include_inactive=true&admin_email=${encodeURIComponent(user.email)}`)
    const d = await r.json(); setProducts(d.products || [])
  }
  const loadCoupons = async () => {
    const r = await fetch(`${API}/store/coupons?admin_email=${encodeURIComponent(user.email)}`)
    const d = await r.json(); setCoupons(d.coupons || [])
  }
  const loadOrders = async () => {
    const r = await fetch(`${API}/store/orders?admin_email=${encodeURIComponent(user.email)}&limit=100`)
    const d = await r.json(); setOrders(d.orders || [])
  }

  const addProduct = async () => {
    setSaving(true); setMsg('')
    const r = await fetch(`${API}/store/products`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({...form, admin_email: user.email,
        price_usd: parseFloat(form.price_usd),
        price_annual: form.price_annual ? parseFloat(form.price_annual) : null,
        stock: form.stock ? parseInt(form.stock) : null })
    })
    if (r.ok) { setMsg('Product added!'); loadProducts() }
    else { const d = await r.json(); setMsg('Error: ' + d.detail) }
    setSaving(false)
  }

  const addCoupon = async () => {
    setSaving(true); setMsg('')
    const r = await fetch(`${API}/store/coupons`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({...couponForm, admin_email: user.email,
        value: parseFloat(couponForm.value) || 0,
        max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null,
        global: couponForm.global === true || couponForm.global === 'true' })
    })
    if (r.ok) { setMsg('Coupon created!'); loadCoupons() }
    else { const d = await r.json(); setMsg('Error: ' + d.detail) }
    setSaving(false)
  }

  const toggleProduct = async (id, active) => {
    await fetch(`${API}/store/products/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ active: !active, admin_email: user.email })
    }); loadProducts()
  }

  return (
    <div style={{marginTop:'2rem',padding:'1.5rem',background:'var(--bg3)',
      border:'1px solid var(--border)',borderRadius:12}}>
      <div style={{fontWeight:700,color:'var(--amber)',marginBottom:'1rem',fontSize:'.9rem'}}>
        ⬡ Store Admin Panel
      </div>

      <div style={{display:'flex',gap:'.4rem',marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {['products','add_product','coupons','add_coupon','orders'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`btn btn-sm ${tab===t?'btn-primary':'btn-secondary'}`}>
            {t === 'products' ? '📦 Products'
             : t === 'add_product' ? '+ Add Product'
             : t === 'coupons' ? '🏷 Coupons'
             : t === 'add_coupon' ? '+ Add Coupon'
             : '📋 Orders'}
          </button>
        ))}
      </div>

      {msg && <div style={{padding:'.5rem .85rem',borderRadius:6,marginBottom:'.75rem',
        background: msg.startsWith('Error') ? 'rgba(255,68,68,.1)' : 'rgba(0,255,136,.1)',
        color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)',
        fontSize:'.82rem'}}>{msg}</div>}

      {/* Products list */}
      {tab === 'products' && (
        <div className="tbl-wrap" style={{maxHeight:350}}>
          <table>
            <thead><tr>
              <th>Name</th><th>Type</th><th>Price</th><th>Annual</th><th>Stock</th><th>Active</th><th></th>
            </tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td style={{color:'var(--text)'}}>{p.name}</td>
                  <td style={{color:'var(--muted)',fontSize:'.7rem'}}>{p.type}</td>
                  <td style={{color:'var(--green)'}}>${p.price_usd}</td>
                  <td style={{color:'var(--dim)'}}>{p.price_annual ? `$${p.price_annual}` : '—'}</td>
                  <td style={{color:'var(--muted)'}}>{p.stock ?? '∞'}</td>
                  <td>
                    <button onClick={() => toggleProduct(p.id, p.active)}
                      style={{fontSize:'.72rem',padding:'.15rem .4rem',borderRadius:4,
                        background: p.active ? 'rgba(0,255,136,.15)' : 'rgba(255,68,68,.1)',
                        border:'none',color: p.active ? 'var(--green)' : 'var(--red)',cursor:'pointer'}}>
                      {p.active ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td><button onClick={async () => {
                    await fetch(`${API}/store/products/${p.id}?admin_email=${encodeURIComponent(user.email)}`,
                      { method:'DELETE' }); loadProducts()
                  }} style={{background:'none',border:'none',color:'var(--dim)',cursor:'pointer',fontSize:'.75rem'}}>
                    Delete
                  </button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add product form */}
      {tab === 'add_product' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.6rem'}}>
          {[
            ['name','Product Name','text'],
            ['price_usd','Price USD','number'],
            ['price_annual','Annual Price (optional)','number'],
            ['file_url','File URL (video/pdf)','text'],
            ['image_url','Image URL','text'],
            ['stock','Stock (empty = unlimited)','number'],
          ].map(([k,pl,t]) => (
            <div key={k}>
              <label className="form-label" style={{fontSize:'.7rem'}}>{pl}</label>
              <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}
                type={t} placeholder={pl} className="form-input"
                style={{padding:'.4rem .65rem',fontSize:'.82rem'}} />
            </div>
          ))}
          <div>
            <label className="form-label" style={{fontSize:'.7rem'}}>Type</label>
            <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
              className="form-input" style={{padding:'.4rem .65rem',fontSize:'.82rem'}}>
              {Object.keys(TYPE_LABELS).map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t].label}</option>
              ))}
            </select>
          </div>
          <div style={{gridColumn:'1/-1'}}>
            <label className="form-label" style={{fontSize:'.7rem'}}>Description</label>
            <textarea value={form.description}
              onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="Product description..." className="form-input"
              style={{minHeight:60,resize:'vertical',fontSize:'.82rem'}} />
          </div>
          <button onClick={addProduct} disabled={saving}
            className="btn btn-primary btn-sm" style={{gridColumn:'1/-1'}}>
            {saving ? '...' : '+ Add Product'}
          </button>
        </div>
      )}

      {/* Coupons list */}
      {tab === 'coupons' && (
        <div className="tbl-wrap" style={{maxHeight:350}}>
          <table>
            <thead><tr>
              <th>Code</th><th>Type</th><th>Value</th><th>Global</th>
              <th>User</th><th>Uses</th><th>Expires</th>
            </tr></thead>
            <tbody>
              {coupons.map(c => (
                <tr key={c.id}>
                  <td style={{color:'var(--amber)',fontFamily:'monospace',fontWeight:700}}>{c.code}</td>
                  <td style={{color:'var(--muted)',fontSize:'.72rem'}}>{c.type}</td>
                  <td style={{color:'var(--green)'}}>
                    {c.type==='percent' ? `${c.value}%` :
                     c.type==='fixed'   ? `$${c.value}` : 'FREE'}
                  </td>
                  <td style={{color: c.global ? 'var(--green)' : 'var(--dim)'}}>
                    {c.global ? 'Yes' : 'No'}
                  </td>
                  <td style={{color:'var(--muted)',fontSize:'.72rem'}}>
                    {c.user_email || '—'}
                  </td>
                  <td style={{color:'var(--dim)'}}>
                    {c.used_count || 0}{c.max_uses ? `/${c.max_uses}` : ''}
                  </td>
                  <td style={{color:'var(--dim)',fontSize:'.7rem'}}>
                    {c.valid_until ? c.valid_until.slice(0,10) : '∞'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add coupon form */}
      {tab === 'add_coupon' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.6rem'}}>
          {[
            ['code','CODE (e.g. SAVE25)'],
            ['value','Value (number)'],
            ['user_email','User email (for personal)'],
            ['max_uses','Max uses (empty = unlimited)'],
            ['valid_until','Valid until (YYYY-MM-DD)'],
          ].map(([k,pl]) => (
            <div key={k}>
              <label className="form-label" style={{fontSize:'.7rem'}}>{pl}</label>
              <input value={couponForm[k]} onChange={e=>setCouponForm(f=>({...f,[k]:e.target.value}))}
                placeholder={pl} className="form-input"
                style={{padding:'.4rem .65rem',fontSize:'.82rem'}} />
            </div>
          ))}
          <div>
            <label className="form-label" style={{fontSize:'.7rem'}}>Type</label>
            <select value={couponForm.type} onChange={e=>setCouponForm(f=>({...f,type:e.target.value}))}
              className="form-input" style={{padding:'.4rem .65rem',fontSize:'.82rem'}}>
              <option value="percent">Percent % off</option>
              <option value="fixed">Fixed $ off</option>
              <option value="free">Free (100%)</option>
            </select>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
            <input type="checkbox" id="global" checked={couponForm.global}
              onChange={e=>setCouponForm(f=>({...f,global:e.target.checked}))}
              style={{accentColor:'var(--green)',width:16,height:16}} />
            <label htmlFor="global" style={{fontSize:'.82rem',color:'var(--text)',cursor:'pointer'}}>
              Global (all users)
            </label>
          </div>
          <button onClick={addCoupon} disabled={saving}
            className="btn btn-primary btn-sm" style={{gridColumn:'1/-1'}}>
            {saving ? '...' : '+ Create Coupon'}
          </button>
        </div>
      )}

      {/* Orders */}
      {tab === 'orders' && (
        <div className="tbl-wrap" style={{maxHeight:400}}>
          <table>
            <thead><tr>
              <th>Date</th><th>Email</th><th>Total</th><th>Status</th><th>Coupon</th><th>Shipping</th>
            </tr></thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td style={{fontSize:'.7rem',color:'var(--muted)'}}>
                    {o.created_at?.slice(0,16)}
                  </td>
                  <td style={{color:'var(--text)',fontSize:'.78rem'}}>{o.user_email}</td>
                  <td style={{color:'var(--green)',fontWeight:700}}>${o.total_usd}</td>
                  <td>
                    <span style={{fontSize:'.7rem',padding:'.15rem .4rem',borderRadius:4,
                      background: o.status==='fulfilled' ? 'rgba(0,255,136,.15)'
                               : o.status==='paid'       ? 'rgba(68,170,255,.15)'
                               : o.status==='pending'    ? 'rgba(255,136,0,.15)' : 'transparent',
                      color: o.status==='fulfilled' ? 'var(--green)'
                           : o.status==='paid'       ? 'var(--blue)'
                           : 'var(--amber)'}}>
                      {o.status}
                    </span>
                  </td>
                  <td style={{color:'var(--amber)',fontSize:'.75rem'}}>{o.coupon_code || '—'}</td>
                  <td style={{color:'var(--muted)',fontSize:'.72rem'}}>
                    {o.shipping_country ? `${o.shipping_city}, ${o.shipping_country}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── My Orders ───────────────────────────────────────────────────
function MyOrders({ user }) {
  const [orders, setOrders] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) load()
  }, [open])

  const load = async () => {
    const r = await fetch(`${API}/store/orders/my?email=${encodeURIComponent(user.email)}`)
    const d = await r.json(); setOrders(d.orders || [])
  }

  return (
    <div style={{marginBottom:'1.5rem'}}>
      <button className="btn btn-secondary btn-sm"
        onClick={() => setOpen(v=>!v)}>
        📋 My Orders {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{marginTop:'.75rem',background:'var(--bg2)',border:'1px solid var(--border)',
          borderRadius:10,overflow:'hidden'}}>
          {orders.length === 0 ? (
            <div style={{padding:'1rem',color:'var(--dim)',textAlign:'center',fontSize:'.85rem'}}>
              No orders yet
            </div>
          ) : orders.map(o => {
            let items = []
            try { items = JSON.parse(o.items || '[]') } catch {}
            return (
              <div key={o.id} style={{padding:'.85rem 1rem',
                borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:'.5rem'}}>
                  <div>
                    <div style={{fontSize:'.78rem',color:'var(--text)',fontWeight:600}}>
                      {items.map(i=>i.name).join(', ') || 'Order'}
                    </div>
                    <div style={{fontSize:'.7rem',color:'var(--muted)'}}>
                      {o.created_at?.slice(0,10)} · ${o.total_usd}
                      {o.coupon_code && <span style={{color:'var(--green)',marginLeft:'.4rem'}}>
                        (Coupon: {o.coupon_code})
                      </span>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'.5rem',alignItems:'center'}}>
                    <span style={{fontSize:'.72rem',padding:'.15rem .4rem',borderRadius:4,
                      background: o.status==='fulfilled' ? 'rgba(0,255,136,.15)' : 'rgba(255,136,0,.15)',
                      color: o.status==='fulfilled' ? 'var(--green)' : 'var(--amber)'}}>
                      {o.status}
                    </span>
                    {o.status === 'fulfilled' && items.some(i=>i.file_url) && (
                      <a href={`${API}/store/download/${o.id}?email=${encodeURIComponent(user.email)}`}>
                        <button className="btn btn-secondary btn-sm">↓ Download</button>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Store Page ─────────────────────────────────────────────
export default function Store() {
  const { user } = useAuth()
  if (!user) return null

  const [products, setProducts] = useState([])
  const [cart, setCart]         = useState([])
  const [showCart, setShowCart] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [checkoutMsg, setCheckoutMsg] = useState('')
  const [filter, setFilter]     = useState('all')

  useEffect(() => { loadProducts() }, [])

  // Check success/cancel from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success')) setCheckoutMsg('✅ Payment successful! Your order is being processed.')
    if (params.get('cancel'))  setCheckoutMsg('❌ Payment cancelled.')
  }, [])

  const loadProducts = async () => {
    setLoading(true)
    const r = await fetch(`${API}/store/products`)
    const d = await r.json()
    setProducts(d.products || [])
    setLoading(false)
  }

  const addToCart = (product) => {
    setCart(c => [...c, {...product, qty:1}])
    setShowCart(true)
  }

  const removeFromCart = (i) => setCart(c => c.filter((_,j) => j !== i))

  const checkout = async ({ coupon_code, shipping, shipping_cost }) => {
    setCheckoutMsg('')
    const r = await fetch(`${API}/store/checkout`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        user_email:    user.email,
        items:         cart.map(i => ({
          product_id: i.id, qty: i.qty || 1, billing: i.billing || 'monthly'
        })),
        coupon_code,
        shipping,
        shipping_cost,
      })
    })
    const d = await r.json()
    if (d.free) {
      setCheckoutMsg('🎁 Order fulfilled for free!')
      setCart([])
    } else if (d.checkout_url) {
      window.location.href = d.checkout_url
    } else {
      setCheckoutMsg('Error: ' + (d.detail || 'Unknown error'))
    }
  }

  const types = ['all', ...new Set(products.map(p => p.type))]
  const filtered = filter === 'all' ? products : products.filter(p => p.type === filter)

  return (
    <div>
      <div className="page-header">
        <h1>🛒 Store</h1>
        <p>Subscriptions, videos, PDFs and physical products</p>
      </div>

      {checkoutMsg && (
        <div style={{padding:'.75rem 1rem',borderRadius:8,marginBottom:'1rem',
          background: checkoutMsg.startsWith('✅') ? 'rgba(0,255,136,.1)' : 'rgba(255,68,68,.1)',
          color: checkoutMsg.startsWith('✅') ? 'var(--green)' : 'var(--red)',
          border:`1px solid ${checkoutMsg.startsWith('✅') ? 'rgba(0,255,136,.3)' : 'rgba(255,68,68,.3)'}`}}>
          {checkoutMsg}
        </div>
      )}

      <MyOrders user={user} />

      {/* Filter + Cart button */}
      <div style={{display:'flex',justifyContent:'space-between',
        alignItems:'center',marginBottom:'1.25rem',flexWrap:'wrap',gap:'.75rem'}}>
        <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap'}}>
          {types.map(t => (
            <button key={t} onClick={() => setFilter(t)}
              className={`btn btn-sm ${filter===t?'btn-primary':'btn-secondary'}`}>
              {t === 'all' ? '📋 All'
               : TYPE_LABELS[t] ? `${TYPE_LABELS[t].icon} ${TYPE_LABELS[t].label}`
               : t}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCart(v=>!v)}
          className="btn btn-secondary"
          style={{position:'relative'}}>
          🛒 Cart
          {cart.length > 0 && (
            <span style={{
              position:'ultimate',top:-8,right:-8,
              background:'var(--green)',color:'#000',
              borderRadius:'50%',width:20,height:20,
              fontSize:'.65rem',display:'flex',alignItems:'center',
              justifyContent:'center',fontWeight:800
            }}>{cart.length}</span>
          )}
        </button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',
        gap:'1rem',marginBottom:'2rem'}}>
        {loading ? (
          <div style={{color:'var(--muted)',padding:'2rem'}}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{color:'var(--dim)',padding:'2rem'}}>No products yet</div>
        ) : filtered.map(p => (
          <ProductCard key={p.id} product={p} onAdd={addToCart} />
        ))}
      </div>

      {/* Cart panel */}
      {showCart && (
        <div style={{
          position:'fixed',right:0,top:0,height:'100vh',width:380,maxWidth:'100vw',
          background:'var(--bg2)',borderLeft:'1px solid var(--border)',
          zIndex:200,overflow:'auto',padding:'1.5rem',
          boxShadow:'-4px 0 24px rgba(0,0,0,.4)'
        }}>
          <div style={{display:'flex',justifyContent:'space-between',
            alignItems:'center',marginBottom:'1.25rem'}}>
            <h2 style={{fontSize:'1.1rem',fontWeight:700,color:'var(--text)'}}>
              🛒 Cart ({cart.length})
            </h2>
            <button onClick={() => setShowCart(false)} style={{
              background:'none',border:'none',color:'var(--muted)',
              fontSize:'1.3rem',cursor:'pointer'
            }}>×</button>
          </div>
          <Cart items={cart} onRemove={removeFromCart}
            onCheckout={checkout} user={user} />
        </div>
      )}

    </div>
  )
}