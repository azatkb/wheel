import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const PLANS = [
  {
    id: 'basic',
    name: 'Basic 1.0',
    price: '€0',
    price_annual: null,
    period: '/ forever',
    daily: null,
    color: '#64748b',
    border: '#1e2a38',
    features: [
      'Upload & stream video',
      'Rotation angle (°)',
      'Total time (s)',
      'Angular velocity (°/s)',
      'Lajtner Resonance (LR)',
      'Personal history',
    ],
    missing: [
      'Power (W)',
      'Force (N)',
      'Energy (J)',
      'Personal & group ranking',
      'Advanced analysis',
    ],
  },
  {
    id: 'pro',
    name: 'Pro 1.0',
    price: '€19.90',
    price_annual: '€149.90',
    period: '/ month',
    period_annual: '/ year',
    daily: '€0.66/day',
    daily_annual: '€0.41/day  ·  €12.49/month',
    color: '#00ff88',     // border / badge / checkmark accent
    textColor: '#00ff88', // bright green price
    border: '#00ff88',
    badge: 'POPULAR',
    monthly_label: '⚡ Upgrade to Pro 1.0 — €19.90/mo',
    features: [
      'Everything in Basic 1.0',
      'Power (W)',
      'Lajtner Resonance (LR)',
      'Personal ranking',
      'Group ranking among all users',
      'CW / CCW / CW+CCW / CCW+CW modes',
      'Underwater analysis',
      'Priority processing',
    ],
    missing: [],
  },
  {
    id: 'ultimate',
    name: 'Ultimate 1.0',
    price: '€49.00',
    price_annual: '€499.90',
    period: '/ month',
    period_annual: '/ year',
    daily: '€1.63/day',
    daily_annual: '€1.34/day  ·  €41.66/month',
    color: '#FFD700',     // border / badge / checkmark accent
    textColor: '#FFD700', // bright gold price
    border: '#FFD700',
    badge: 'Perfect feedback',
    monthly_label: '⚡ Upgrade to Ultimate 1.0 — €49.00/mo',
    features: [
      'Everything in Pro 1.0',
      'Full 20 physics variables',
      'Personal focus analysis',
      'Advanced brain-wave correlation',
      'Priority support',
      'Early access to new features',
    ],
    missing: [],
  },
]

export default function Subscription() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(null)
  const [msg, setMsg]     = useState('')
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [billing, setBilling] = useState('month')   // 'month' | 'year'
  const isAnnual = billing === 'year'

  // Handle Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === '1') {
      setMsg('Payment successful! Verifying...')
      window.history.replaceState({}, '', window.location.pathname)
      // Verify session and update plan
      const sid = params.get('session_id') || ''
      fetch(`${API}/stripe/check-session?session_id=${sid}&email=${encodeURIComponent(user.email)}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok && (d.plan === 'pro' || d.plan === 'ultimate')) {
            const updated = { ...user, plan: d.plan }
            localStorage.setItem('wt_user', JSON.stringify(updated))
            window.dispatchEvent(new Event('wt_plan_updated'))
            setMsg(`✓ Plan upgraded to ${d.plan === 'ultimate' ? 'Ultimate' : 'Pro'}!`)
          } else {
            setMsg('Payment received! Plan will be activated within a minute.')
          }
        })
        .catch(() => setMsg('Payment received! Plan will be activated shortly.'))
    }
    if (params.get('cancelled') === '1') {
      setError('Payment cancelled.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const startCheckout = async (planId) => {
    setLoading(planId); setMsg(''); setError('')
    try {
      const r = await fetch(API + '/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          plan: planId,
          billing,                       // 'month' | 'year'
          success_url: `${window.location.origin}${import.meta.env.PROD ? '/kinetic' : ''}/subscription?success=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url:  `${window.location.origin}${import.meta.env.PROD ? '/kinetic' : ''}/subscription?cancelled=1`,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error creating checkout')
      window.location.href = d.url
    } catch (e) {
      setError(e.message)
      setLoading(null)
    }
  }

  const cancelSubscription = async () => {
    if (!window.confirm('Cancel your subscription? You will be downgraded to Free.')) return
    setCancelling(true); setMsg(''); setError('')
    try {
      const r = await fetch(API + '/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      const updated = { ...user, plan: 'basic' }
      localStorage.setItem('wt_user', JSON.stringify(updated))
      setMsg('Subscription cancelled. You are now on the Free plan.')
      window.dispatchEvent(new Event('wt_plan_updated'))
    } catch (e) {
      setError(e.message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Subscription</h1>
        <p>Choose the plan that fits your needs</p>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'.75rem',marginBottom:'1.5rem',flexWrap:'wrap'}}>
        <span style={{fontSize:'.82rem',color:'var(--muted)'}}>Current plan:</span>
        <span style={{
          padding:'.2rem .7rem',borderRadius:20,fontWeight:700,fontSize:'.82rem',
          background: user.plan==='pro' ? 'rgba(0,255,136,.15)' : 'rgba(100,116,139,.15)',
          color: user.plan==='pro' ? 'var(--green)' : '#94a3b8',
          border: `1px solid ${user.plan==='pro' ? 'var(--green)' : '#334155'}`,
        }}>
          {user.plan==='pro' ? '⭐ Pro' : 'Basic'}
        </span>
        {user.plan==='pro' && (
          <button className="btn btn-danger btn-sm"
            onClick={cancelSubscription} disabled={cancelling}>
            {cancelling ? 'Cancelling...' : 'Cancel subscription'}
          </button>
        )}
      </div>

      {msg && (
        <div style={{background:'rgba(0,255,136,.1)',border:'1px solid rgba(0,255,136,.3)',
          borderRadius:4,padding:'.6rem .9rem',color:'var(--green)',fontSize:'.82rem',marginBottom:'1rem'}}>
          ✓ {msg}
        </div>
      )}
      {error && <div className="error-msg">{error}</div>}

      {/* Billing period toggle */}
      <div style={{display:'flex',justifyContent:'center',marginBottom:'1.5rem'}}>
        <div style={{display:'inline-flex',background:'var(--bg3)',
          border:'1px solid var(--border)',borderRadius:28,padding:4}}>
          {[['month','Monthly'],['year','Annual']].map(([v,label]) => (
            <button key={v} onClick={() => setBilling(v)}
              style={{
                border:'none',cursor:'pointer',borderRadius:24,
                padding:'.6rem 1.6rem',fontSize:'1.25rem',fontWeight:800,
                background: billing===v ? 'var(--green)' : 'transparent',
                color: billing===v ? '#000' : 'var(--muted)',
                transition:'all .15s',
              }}>
              {label}{v==='year' && <span style={{fontSize:'.85rem',fontWeight:700,opacity:.85}}> · save ~37%</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'1rem',alignItems:'start'}}>
        {PLANS.map(plan => {
          const isCurrent = user.plan === plan.id
          // darker header/button colors so WHITE text stays readable on light background
          const headerColor = { basic:'#5B6B7B', pro:'#0A8F5C', ultimate:'#B07A0C' }[plan.id]
          return (
            <div key={plan.id} style={{
              background:'var(--bg2)',
              border:`1px solid ${isCurrent ? plan.color : 'var(--border)'}`,
              borderRadius:12, overflow:'hidden', position:'relative',
              boxShadow: plan.id==='pro'
                ? '0 6px 28px rgba(10,143,92,.18)'
                : '0 2px 10px rgba(0,0,0,.12)',
            }}>
              {/* Colored header band — plan name in white = high contrast */}
              <div style={{background:headerColor, padding:'1.1rem 1rem .9rem', textAlign:'center'}}>
                <div style={{fontSize:'1.5rem', fontWeight:800, color:'#fff', letterSpacing:'-.01em'}}>
                  {plan.name}
                </div>
                {plan.badge && (
                  <div style={{display:'inline-block', marginTop:'.45rem',
                    fontSize:'.72rem', fontWeight:700, color:'#fff',
                    background:'rgba(255,255,255,.22)', padding:'.2rem .7rem', borderRadius:20}}>
                    {plan.badge}
                  </div>
                )}
                {isCurrent && (
                  <div style={{position:'absolute',top:10,right:10,background:'#fff',
                    color:headerColor,padding:'.15rem .55rem',borderRadius:20,
                    fontSize:'.62rem',fontWeight:800}}>ACTIVE</div>
                )}
              </div>

              <div style={{padding:'1.25rem'}}>
                {/* Active price (follows Monthly / Annual toggle) — dark text for contrast */}
                {(() => {
                  const showAnnual = isAnnual && plan.price_annual
                  const bigPrice  = showAnnual ? plan.price_annual : plan.price
                  const bigPeriod = showAnnual ? plan.period_annual : plan.period
                  const bigDaily  = showAnnual ? plan.daily_annual  : plan.daily
                  return (
                    <div style={{textAlign:'center', marginBottom:'.75rem'}}>
                      <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'.35rem'}}>
                        <span style={{fontSize:'2.6rem',fontWeight:800,color:'var(--text)',
                          fontFamily:'var(--font-mono)',lineHeight:1}}>{bigPrice}</span>
                        <span style={{fontSize:'.85rem',color:'var(--muted)'}}>{bigPeriod}</span>
                      </div>
                      {bigDaily && (
                        <div style={{fontSize:'.74rem',color:'var(--dim)',marginTop:'.3rem'}}>{bigDaily}</div>
                      )}
                    </div>
                  )
                })()}

                {/* Annual breakdown — always visible as reference */}
                {plan.price_annual && (
                  <div style={{
                    background:'var(--bg3)',border:`1px solid var(--border)`,
                    borderRadius:8,padding:'.5rem .7rem',marginBottom:'1rem',textAlign:'center',
                    outline: isAnnual ? `2px solid ${headerColor}` : 'none',
                  }}>
                    <div style={{fontSize:'.85rem',color:'var(--text)',fontWeight:700}}>
                      {plan.price_annual} {plan.period_annual}
                    </div>
                    <div style={{fontSize:'.72rem',color:'var(--dim)'}}>{plan.daily_annual}</div>
                  </div>
                )}

                <ul style={{listStyle:'none',margin:'0 0 1.25rem',padding:0,
                  display:'flex',flexDirection:'column',gap:'.45rem'}}>
                  {plan.features.map(f => (
                    <li key={f} style={{fontSize:'.85rem',color:'var(--text)',
                      display:'flex',gap:'.5rem',alignItems:'flex-start'}}>
                      <span style={{color:headerColor,flexShrink:0,marginTop:'.1rem',fontWeight:800}}>✓</span>{f}
                    </li>
                  ))}
                  {plan.missing.map(f => (
                    <li key={f} style={{fontSize:'.85rem',color:'var(--dim)',
                      display:'flex',gap:'.5rem',alignItems:'flex-start'}}>
                      <span style={{flexShrink:0,marginTop:'.1rem'}}>✕</span>{f}
                    </li>
                  ))}
                </ul>

                {(plan.id === 'pro' || plan.id === 'ultimate') && !isCurrent && (
                  <button className="btn" onClick={() => startCheckout(plan.id)}
                    disabled={loading===plan.id}
                    style={{width:'100%',background:headerColor,color:'#fff',border:'none',
                      fontWeight:700,fontSize:'.92rem',padding:'.7rem'}}>
                    {loading===plan.id
                      ? '⏳ Redirecting...'
                      : `Sign up now — ${isAnnual ? plan.price_annual : plan.price}${isAnnual ? '/yr' : '/mo'}`}
                  </button>
                )}
                {plan.id === 'basic' && !isCurrent && (
                  <button className="btn btn-secondary" style={{width:'100%',padding:'.7rem'}}
                    onClick={cancelSubscription} disabled={cancelling}>
                    {cancelling ? '...' : 'Switch to Basic'}
                  </button>
                )}
                {isCurrent && (
                  <button className="btn" disabled
                    style={{width:'100%',background:'var(--bg3)',color:'var(--muted)',
                      border:'1px solid var(--border)',cursor:'default',padding:'.7rem'}}>
                    Current plan
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{marginTop:'1.5rem',padding:'1rem',background:'var(--bg2)',
        border:'1px solid var(--border)',borderRadius:6,fontSize:'.78rem',color:'var(--muted)'}}>
        <strong style={{color:'var(--text)'}}>Secure payment</strong> via{' '}
        <span style={{color:'var(--blue)',fontWeight:600}}>Stripe</span>.
        Your card is never stored on our servers. Subscriptions renew monthly and can be cancelled anytime.
        Questions? <a href="mailto:info@enyem.com" style={{color:'var(--green)'}}>info@enyem.com</a>
      </div>
    </div>
  )
}