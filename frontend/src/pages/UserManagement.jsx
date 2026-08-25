import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e || '').toLowerCase())

export default function UserManagement() {
  const { user } = useAuth()
  if (!user) return null
  if (!isMaster(user.email)) return (
    <div style={{padding:'2rem',color:'var(--red)'}}>Access denied</div>
  )

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')      // email currently toggling
  const [msg, setMsg] = useState('')

  const em = encodeURIComponent(user.email)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/master/users?email=${em}`)
      const d = await r.json()
      setUsers(d.users || [])
    } catch { setUsers([]) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const toggleBlock = async (target, blocked) => {
    setBusy(target)
    try {
      const r = await fetch(`${API}/admin/block-user`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_email: user.email, email: target, blocked })
      })
      if (r.ok) {
        setUsers(us => us.map(u => u.email === target ? { ...u, blocked } : u))
        setMsg(`${blocked ? '🚫 Blocked' : '✓ Unblocked'} ${target}`)
        setTimeout(() => setMsg(''), 2500)
      } else {
        const d = await r.json(); setMsg('Error: ' + (d.detail || 'failed'))
      }
    } catch { setMsg('Network error') }
    setBusy('')
  }

  const shown = users.filter(u => u.email.toLowerCase().includes(q.toLowerCase().trim()))
  const blockedCount = users.filter(u => u.blocked).length

  return (
    <div>
      <div className="page-header">
        <h1>👥 User Management</h1>
        <p>{users.length} users · {blockedCount} blocked</p>
      </div>

      {msg && (
        <div style={{padding:'.5rem 1rem',borderRadius:6,marginBottom:'1rem',fontSize:'.85rem',
          background: msg.startsWith('Error') || msg.startsWith('Network') ? 'rgba(255,68,68,.1)' : 'rgba(0,255,136,.1)',
          color: msg.startsWith('Error') || msg.startsWith('Network') ? 'var(--red)' : 'var(--green)',
          border: '1px solid var(--border)'}}>
          {msg}
        </div>
      )}

      <div className="card">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="🔍 Search by email…" className="form-input"
          style={{marginBottom:'1rem',maxWidth:340}} />

        {loading ? (
          <div style={{color:'var(--muted)',padding:'1rem 0'}}>Loading users…</div>
        ) : (
          <div className="tbl-wrap" style={{maxHeight:560}}>
            <table>
              <thead><tr>
                <th>Email</th><th>Plan</th><th>Measurements</th><th>Status</th><th>Action</th>
              </tr></thead>
              <tbody>
                {shown.map(u => {
                  const master = isMaster(u.email)
                  return (
                    <tr key={u.email} style={{background: u.blocked ? 'rgba(255,68,68,.06)' : 'transparent'}}>
                      <td style={{color:'var(--text)',fontWeight:500}}>{u.email}</td>
                      <td style={{color:'var(--muted)',fontSize:'.78rem'}}>{u.plan}</td>
                      <td style={{color:'var(--muted)'}}>{u.count}</td>
                      <td>
                        <span style={{fontSize:'.72rem',padding:'.15rem .5rem',borderRadius:4,fontWeight:600,
                          background: u.blocked ? 'rgba(255,68,68,.15)' : 'rgba(0,255,136,.12)',
                          color: u.blocked ? 'var(--red)' : 'var(--green)'}}>
                          {u.blocked ? 'Blocked' : 'Active'}
                        </span>
                      </td>
                      <td>
                        {master ? (
                          <span style={{fontSize:'.72rem',color:'var(--dim)'}}>master</span>
                        ) : u.blocked ? (
                          <button onClick={() => toggleBlock(u.email, false)}
                            disabled={busy === u.email}
                            style={{fontSize:'.75rem',padding:'.25rem .6rem',borderRadius:5,cursor:'pointer',
                              border:'1px solid var(--green)',background:'none',color:'var(--green)'}}>
                            {busy === u.email ? '…' : 'Unblock'}
                          </button>
                        ) : (
                          <button onClick={() => { if (confirm(`Block ${u.email}? They won't be able to log in or upload.`)) toggleBlock(u.email, true) }}
                            disabled={busy === u.email}
                            style={{fontSize:'.75rem',padding:'.25rem .6rem',borderRadius:5,cursor:'pointer',
                              border:'1px solid var(--red)',background:'none',color:'var(--red)'}}>
                            {busy === u.email ? '…' : 'Block'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={5} style={{color:'var(--muted)',textAlign:'center',padding:'1rem'}}>
                    No users match “{q}”.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
