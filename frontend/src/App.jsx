import { useState } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import UserManagement from './pages/UserManagement'
import TawkWidget from './components/TawkWidget'
import FeedbackWidget from './components/FeedbackWidget'
import Login from './pages/Login'
import Subscription from './pages/Subscription'
import Upload from './pages/Upload'
import Stream from './pages/Stream'
import History from './pages/History'
import Master from './pages/Master'
import Analytics from './pages/Analytics'
import ResonanceList from './pages/ResonanceList'
import DbViewer from './pages/DbViewer'
import FPE from './pages/FPE'
import Forum from './pages/Forum'
import Store from './pages/Store'
import StoreAdmin from './pages/StoreAdmin'
import Statistics from './pages/Statistics'
import Questionnaire from './pages/Questionnaire'
import QuestionnaireViewer from './pages/QuestionnaireViewer'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']

const NAV_ALL = [
  { to: '/subscription', icon: '◇', label: 'Plan' },
  { to: '/upload',       icon: '↑', label: 'Upload' },
  { to: '/stream',       icon: '◉', label: 'Stream' },
  { to: '/history',      icon: '≡', label: 'History' },
  { to: '/analytics',    icon: '◈', label: 'Analytics', masterOnly: true },
  { to: '/forum',        icon: '💬', label: 'Forum' },
  { to: '/store',        icon: '🛒', label: 'Store' },
  { to: '/focus',        icon: '🧠', label: 'Focus Test' },
  { to: '/resonances',   icon: '📈', label: 'LR-LT-LJ' },
  { to: 'https://mindpw.com/feedback.html', icon: '✉', label: 'Contact', external: true },
  { to: '/store-admin',   icon: '🏪', label: 'Store Admin', masterOnly: true },
  { to: '/statistics',    icon: '📊', label: 'Statistics', masterOnly: true, ultimateOk: true },
  { to: '/focus-db',      icon: '🗄', label: 'Focus DB', masterOnly: true },
  { to: '/master',       icon: '⬡', label: 'Master',    masterOnly: true },
  { to: '/fpe',          icon: '⚡', label: 'FPE',        masterOnly: true },
  { to: '/db',           icon: '⊞', label: 'Database',  masterOnly: true },
  { to: '/users',        icon: '👥', label: 'Users',  masterOnly: true },
]

function isMaster(email) {
  if (!email) return false
  const e = email.toLowerCase()
  return MASTER_EMAILS.some(m => e === m || e.startsWith(m.split('@')[0]))
}

function Shell() {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen]     = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('wt_theme') || 'dark')

  if (!user) return <Navigate to="/login" replace />
  const initials = user.email.slice(0, 2).toUpperCase()
  const master = isMaster(user.email)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('wt_theme', next)
    document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : '')
  }

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '')
  }

  const NAV = NAV_ALL.filter(n => (!n.masterOnly || master) || (n.ultimateOk && user?.plan === 'ultimate'))

  return (
    <div className="app-shell">
      {/* Make the menu scroll when items don't fit (large fonts / short screens).
          The logo + footer stay pinned; only the nav list scrolls. */}
      <style>{`
        .sidebar {
          display: flex !important;
          flex-direction: column !important;
          max-height: 100vh;
          max-height: 100dvh;
        }
        .sidebar-logo, .sidebar-footer { flex-shrink: 0 !important; }
        .nav-section {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          overflow-y: auto !important;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(0,255,136,.35) transparent;
        }
        .nav-section::-webkit-scrollbar { width: 7px; }
        .nav-section::-webkit-scrollbar-track { background: transparent; }
        .nav-section::-webkit-scrollbar-thumb {
          background: rgba(0,255,136,.35);
          border-radius: 4px;
        }
        .nav-section::-webkit-scrollbar-thumb:hover { background: rgba(0,255,136,.6); }
      `}</style>
      {/* Mobile top bar */}
      <header className="mobile-topbar">
        <span className="mobile-logo" style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
          <div className="wheel-logo-mobile" />
          <div style={{display:'flex',flexDirection:'column',lineHeight:1.05}}>
            <h3 className="logo" style={{margin:0}}>LaJTNeR CoDe <span style={{fontSize:".55em",fontWeight:600,opacity:.9,color:"var(--blue)"}}>kinetic</span> <span style={{fontSize:".5em",fontWeight:700,marginLeft:".35em",padding:".12em .45em",borderRadius:"4px",background:"var(--amber)",color:"#111",verticalAlign:"middle",letterSpacing:".05em"}}>BETA</span></h3>
            <span style={{fontSize:'.7rem',color:'var(--green)',fontWeight:600,marginTop:'.12rem'}}>
              {master ? 'Ultimate 1.0' : user?.plan === 'pro' ? 'Pro 1.0' : user?.plan === 'ultimate' ? 'Ultimate 1.0' : 'Basic 1.0'}
            </span>
          </div>
        </span>
        <div style={{display:'flex',gap:'.4rem',alignItems:'center'}}>
          <button className="theme-btn" onClick={toggleTheme}>{theme==='dark'?'☀':'◑'}</button>
          <button className="hamburger" onClick={() => setMenuOpen(o => !o)}>
            {menuOpen ? '×' : '≡'}
          </button>
        </div>
      </header>

      {menuOpen && <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />}

      {/* Desktop collapse button */}
      <button onClick={() => setSidebarOpen(o => !o)} style={{
        position:'fixed', top:34, left: sidebarOpen ? 192 : 8,
        zIndex:30, background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:4, color:'var(--muted)', cursor:'pointer',
        padding:'.18rem .4rem', fontSize:'1rem', lineHeight:1,
        transition:'left .25s ease', display:'flex', alignItems:'center',
        boxShadow:'0 1px 4px rgba(0,0,0,.2)',
      }} className="desktop-collapse-btn" title={sidebarOpen?'Hide sidebar':'Show sidebar'}>
        {sidebarOpen ? '‹' : '›'}
      </button>

      {/* Sidebar */}
      <aside className={`sidebar ${menuOpen ? 'open' : ''} ${!sidebarOpen ? 'collapsed' : ''}`}>
        <div className="sidebar-logo">
          <div className="wheel-logo" />
          <div>
            <div className="logo-text">
              <h3 className="logo">LaJTNeR CoDe <span style={{fontSize:".55em",fontWeight:600,opacity:.9,color:"var(--blue)"}}>kinetic</span> <span style={{fontSize:".5em",fontWeight:700,marginLeft:".35em",padding:".12em .45em",borderRadius:"4px",background:"var(--amber)",color:"#111",verticalAlign:"middle",letterSpacing:".05em"}}>BETA</span></h3>
              <div style={{fontSize:'.82rem',color:'var(--green)',marginTop:'.15rem',fontWeight:600}}>
                {master ? 'Ultimate 1.0' : user?.plan === 'pro' ? 'Pro 1.0' : user?.plan === 'ultimate' ? 'Ultimate 1.0' : 'Basic 1.0'}
              </div>
            </div>
          </div>
        </div>
        <div style={{height:1,background:'var(--border)',margin:'0 0 1.5rem'}} />

        <nav className="nav-section">
          <div className="nav-label">Navigation</div>
          {NAV.map(({ to, icon, label, external }) => (
            external
              ? <a key={to} href={to} target="_blank" rel="noopener noreferrer"
                  className="nav-item" onClick={() => setMenuOpen(false)}>
                  <span className="nav-icon">{icon}</span>
                  <span>{label}</span>
                </a>
              : <NavLink key={to} to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon">{icon}</span>
                  <span>{label}</span>
                </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <a href="https://lajtnerresonance.com" target="_blank" rel="noopener noreferrer"
            style={{display:'block',textAlign:'center',fontSize:'.72rem',
              color:'var(--dim)',padding:'.3rem .75rem',textDecoration:'none',
              transition:'color .15s'}}
            onMouseEnter={e=>e.target.style.color='var(--green)'}
            onMouseLeave={e=>e.target.style.color='var(--dim)'}>
            🌐 lajtnerresonance.com
          </a>
          <div style={{padding:'.2rem .75rem .5rem',display:'flex',justifyContent:'flex-start'}}>
            <button className="theme-btn" onClick={toggleTheme}
              title={theme==='dark'?'Switch to light':'Switch to dark'}>
              {theme==='dark'?'☀':'◑'}
            </button>
          </div>
          {master && (
            <div style={{padding:'.3rem .75rem',marginBottom:'.2rem'}}>
              <span style={{fontSize:'.65rem',fontWeight:700,color:'var(--amber)',
                background:'rgba(255,136,0,.1)',border:'1px solid rgba(255,136,0,.3)',
                borderRadius:4,padding:'.15rem .5rem'}}>⬡ MASTER</span>
            </div>
          )}
          {user.plan === 'pro' && (
            <div style={{padding:'.3rem .75rem',marginBottom:'.4rem'}}>
              <span style={{fontSize:'.65rem',fontWeight:700,color:'var(--green)',
                background:'rgba(0,255,136,.1)',border:'1px solid rgba(0,255,136,.3)',
                borderRadius:4,padding:'.15rem .5rem'}}>PRO</span>
            </div>
          )}
          <div className="user-badge">
            <div className="user-avatar">{initials}</div>
            <div className="user-email">{user.email}</div>
            <button className="logout-btn" onClick={logout} title="Logout">✕</button>
          </div>
        </div>
      </aside>

      <main className={`main-content ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}
        onClick={() => menuOpen && setMenuOpen(false)}>
        <Routes>
          <Route path="/upload"       element={<Upload />} />
          <Route path="/stream"       element={<Stream />} />
          <Route path="/history"      element={<History />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/analytics"    element={<Analytics />} />
          <Route path="/resonances"   element={<ResonanceList />} />
          <Route path="/master"       element={master ? <Master /> : <Navigate to="/upload" replace />} />
          <Route path="/fpe"          element={master ? <FPE /> : <Navigate to="/upload" replace />} />
          <Route path="/forum"        element={<Forum />} />
          <Route path="/store"        element={<Store />} />
          <Route path="/store-admin"   element={master ? <StoreAdmin /> : <Navigate to="/upload" replace />} />
          <Route path="/statistics"    element={(master || user?.plan === 'ultimate') ? <Statistics /> : <Navigate to="/upload" replace />} />
          <Route path="/focus"         element={<Questionnaire />} />
          <Route path="/focus-db"      element={master ? <QuestionnaireViewer /> : <Navigate to="/upload" replace />} />
          <Route path="/db"           element={master ? <DbViewer /> : <Navigate to="/upload" replace />} />
          <Route path="/users" element={<UserManagement />} />
          <Route path="*"             element={<Navigate to="/upload" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <TawkWidget />
      <FeedbackWidget />
      <Routes>
        <Route path="/login" element={<LoginGuard />} />
        <Route path="/*"    element={<Shell />} />
      </Routes>
    </AuthProvider>
  )
}

function LoginGuard() {
  const { user } = useAuth()
  if (user) return <Navigate to="/upload" replace />
  return <Login />
}