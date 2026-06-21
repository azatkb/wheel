import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// Google reCAPTCHA v2 Site Key.
// On localhost → Google's official TEST key (always passes, for testing).
// On production → paste your real key in PROD_KEY below.
const PROD_KEY = '6LfS9wotAAAAAATGxKXIotj1kEpJWwzj4-ew3F_c' // TODO: paste your real Site Key here
const TEST_KEY = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' // Google test key (localhost only)
const isLocalhost = typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(window.location.hostname)

// ── reCAPTCHA toggle ────────────────────────────────────────────────
// Set to true to re-enable the captcha.
const RECAPTCHA_ENABLED = false
const RECAPTCHA_SITE_KEY = RECAPTCHA_ENABLED ? (isLocalhost ? TEST_KEY : PROD_KEY) : ''

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newConfirm, setNewConfirm] = useState('')
  const [consented, setConsented] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [recaptchaToken, setRecaptchaToken] = useState('')
  const recaptchaRef = useRef(null)
  const { login, register } = useAuth()
  const navigate = useNavigate()

  // Load reCAPTCHA script
  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return
    const scriptId = 'recaptcha-script'
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://www.google.com/recaptcha/api.js'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    // Expose callback for reCAPTCHA
    window.onRecaptchaVerified = (token) => setRecaptchaToken(token)
    window.onRecaptchaExpired  = () => setRecaptchaToken('')
    return () => {
      delete window.onRecaptchaVerified
      delete window.onRecaptchaExpired
    }
  }, [])

  const resetRecaptcha = () => {
    setRecaptchaToken('')
    if (RECAPTCHA_SITE_KEY && window.grecaptcha?.reset) {
      try { window.grecaptcha.reset() } catch {}
    }
  }

  const clear = () => { setError(''); setInfo('') }

  const submit = async e => {
    e.preventDefault(); clear()
    if (!consented) { setError('You must accept the Terms & Privacy to continue.'); return }
    if (RECAPTCHA_SITE_KEY && !recaptchaToken) { setError('Please verify you are not a robot.'); return }
    if (mode === 'register' && password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      if (mode === 'login') await login(email, password, recaptchaToken)
      else await register(email, password, recaptchaToken)
      navigate('/upload')
    } catch (err) { setError(err.message); resetRecaptcha() }
    finally { setLoading(false) }
  }

  const requestReset = async e => {
    e.preventDefault(); clear(); setLoading(true)
    try {
      const r = await fetch(API + '/auth/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      setInfo('A 6-digit code was sent to your email.')
      setMode('reset-confirm')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const confirmReset = async e => {
    e.preventDefault(); clear()
    if (newPass !== newConfirm) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      const r = await fetch(API + '/auth/reset-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password: newPass }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      setInfo('Password changed! You can now sign in.')
      setMode('login'); setPassword('')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const ConsentBox = () => (
    <div style={{display:'flex',gap:'.6rem',alignItems:'flex-start',
      margin:'.75rem 0 1rem',padding:'.7rem .85rem',
      background:'rgba(0,255,136,.05)',border:'1px solid rgba(0,255,136,.2)',
      borderRadius:6}}>
      <input type="checkbox" id="consent" checked={consented}
        onChange={e => setConsented(e.target.checked)}
        style={{marginTop:2,flexShrink:0,accentColor:'var(--green)',
          width:15,height:15,cursor:'pointer'}} />
      <label htmlFor="consent" style={{fontSize:'.76rem',color:'var(--muted)',
        lineHeight:1.5,cursor:'pointer'}}>
        Using this app, you agree to our{' '}
        <a href="https://lajtner.com/terms-privacy.html"
          target="_blank" rel="noopener noreferrer"
          style={{color:'var(--green)'}}>Terms &amp; Privacy</a>
        {' '}and acknowledge that we store certain data.
      </label>
    </div>
  )

  const [theme, setTheme] = useState(() => localStorage.getItem('wt_theme') || 'dark')
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('wt_theme', next)
    document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : '')
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '')
  }

  return (
    <div className="auth-page">
      <div className="auth-glow" />
      <button onClick={toggleTheme} className="theme-btn"
        style={{position:'fixed',top:'1rem',right:'1rem',zIndex:100}}>
        {theme==='dark'?'☀':'◑'}
      </button>
      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-wheel" />
          <h1 className="logo">LaJTNeR</h1>
          <p>
            {mode === 'login'        ? 'Sign in to your account'   :
             mode === 'register'     ? 'Create your account'       :
             mode === 'reset-req'    ? 'Reset your password'       :
                                       'Enter the code from email' }
          </p>
        </div>

        {error && <div className="error-msg">{error}</div>}
        {info  && <div style={{background:'rgba(0,255,136,.1)',border:'1px solid rgba(0,255,136,.3)',
          borderRadius:6,padding:'.6rem .9rem',color:'var(--green)',fontSize:'.82rem',marginBottom:'1rem'}}>
          {info}</div>}

        {/* Login / Register */}
        {(mode === 'login' || mode === 'register') && (
          <form onSubmit={submit}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input className="form-input" type="password" value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••" required />
              </div>
            )}
            <ConsentBox />
            {/* reCAPTCHA widget — only shown when key is configured */}
            {RECAPTCHA_SITE_KEY && (
              <div style={{margin:'.75rem 0', display:'flex', justifyContent:'center'}}>
                <div
                  ref={recaptchaRef}
                  className="g-recaptcha"
                  data-sitekey={RECAPTCHA_SITE_KEY}
                  data-callback="onRecaptchaVerified"
                  data-expired-callback="onRecaptchaExpired"
                />
              </div>
            )}
            <button className="btn btn-primary" type="submit"
              disabled={loading || !consented || (RECAPTCHA_SITE_KEY && !recaptchaToken)} style={{width:'100%'}}>
              {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
            {mode === 'login' && (
              <button type="button" onClick={() => { clear(); setMode('reset-req') }}
                style={{background:'none',border:'none',color:'var(--muted)',fontSize:'.78rem',
                  cursor:'pointer',marginTop:'.75rem',display:'block',width:'100%',textAlign:'center'}}>
                Forgot password?
              </button>
            )}
          </form>
        )}

        {/* Reset request */}
        {mode === 'reset-req' && (
          <form onSubmit={requestReset}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{width:'100%'}}>
              {loading ? '...' : 'Send Reset Code'}
            </button>
          </form>
        )}

        {/* Reset confirm */}
        {mode === 'reset-confirm' && (
          <form onSubmit={confirmReset}>
            <div className="form-group">
              <label className="form-label">6-digit code</label>
              <input className="form-input" type="text" value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                placeholder="123456" maxLength={6} required
                style={{letterSpacing:'.3em',fontSize:'1.2rem',textAlign:'center'}} />
            </div>
            <div className="form-group">
              <label className="form-label">New password</label>
              <input className="form-input" type="password" value={newPass}
                onChange={e => setNewPass(e.target.value)}
                placeholder="••••••••" required />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm new password</label>
              <input className="form-input" type="password" value={newConfirm}
                onChange={e => setNewConfirm(e.target.value)}
                placeholder="••••••••" required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{width:'100%'}}>
              {loading ? '...' : 'Set New Password'}
            </button>
          </form>
        )}

        <div className="auth-switch" style={{marginTop:'1rem'}}>
          {mode === 'login' ? (
            <>Don't have an account? <button onClick={() => { clear(); setMode('register') }}>Register</button></>
          ) : mode === 'register' ? (
            <>Already have an account? <button onClick={() => { clear(); setMode('login') }}>Sign In</button></>
          ) : (
            <button onClick={() => { clear(); setMode('login') }}>Back to Sign In</button>
          )}
        </div>
      </div>
    </div>
  )
}