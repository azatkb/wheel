/**
 * Settings.jsx
 * Account settings page: GDPR data export, account info.
 */
import { useAuth } from '../hooks/useAuth.jsx'
import DataExport from '../components/DataExport'
import { CookieSettings } from '../components/CookieConsent'

export default function Settings() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Manage your account and data.</p>
      </div>

      {/* Account info */}
      <div className="card" style={{marginBottom:'1rem'}}>
        <h3 style={{fontSize:'1rem', fontWeight:700, color:'var(--text)', marginBottom:'.75rem'}}>
          👤 Account
        </h3>
        <div style={{display:'flex', flexDirection:'column', gap:'.5rem'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'.5rem .7rem', borderRadius:6, background:'var(--bg3)', fontSize:'.88rem'}}>
            <span style={{color:'var(--muted)'}}>Email</span>
            <b style={{color:'var(--text)'}}>{user.email}</b>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'.5rem .7rem', borderRadius:6, background:'var(--bg3)', fontSize:'.88rem'}}>
            <span style={{color:'var(--muted)'}}>Plan</span>
            <b style={{color:'var(--green)', textTransform:'capitalize'}}>{user.plan || 'basic'}</b>
          </div>
        </div>
      </div>

      {/* Cookie Preferences */}
      <CookieSettings />

      {/* GDPR Data Export */}
      <DataExport email={user.email} />

      {/* Danger zone */}
      <div className="card" style={{
        borderColor:'rgba(255,68,68,.2)', marginTop:'2rem'
      }}>
        <h3 style={{fontSize:'1rem', fontWeight:700, color:'var(--red)', marginBottom:'.5rem'}}>
          ⚠️ Danger Zone
        </h3>
        <p style={{color:'var(--muted)', fontSize:'.82rem', marginBottom:'.75rem', lineHeight:1.6}}>
          Need to delete your account? If you have your Personal Security Code,
          you can delete all your data — even without being logged in.
        </p>
        <a href="/kinetic/delete-account"
          style={{
            display:'inline-block', padding:'.5rem 1.2rem', borderRadius:8,
            border:'1px solid rgba(255,68,68,.4)', color:'var(--red)',
            fontSize:'.85rem', textDecoration:'none', fontWeight:500
          }}>
          Delete My Data (via Security Code)
        </a>
      </div>
    </div>
  )
}