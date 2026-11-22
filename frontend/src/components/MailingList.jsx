/**
 * MailingList.jsx
 * Two components:
 *   1. MailingSubscribe — public subscribe form (for footer / any page)
 *   2. NewsletterAdmin — admin panel for composing & sending newsletters
 */
import { useState, useEffect } from 'react'
import { API } from '../config'

// ─── Public Subscribe Form ────────────────────────────────────────────────────
export function MailingSubscribe({ compact = false }) {
  const [email, setEmail] = useState('')
  const [name, setName]   = useState('')
  const [status, setStatus] = useState(null) // 'ok' | 'err'
  const [msg, setMsg]     = useState('')
  const [busy, setBusy]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!email) return
    setBusy(true); setStatus(null)
    try {
      const r = await fetch(`${API}/mailing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      })
      const d = await r.json()
      if (r.ok && d.ok) {
        setStatus('ok'); setMsg(d.message || 'Subscribed!')
        setEmail(''); setName('')
      } else {
        setStatus('err'); setMsg(d.detail || 'Something went wrong')
      }
    } catch (err) {
      setStatus('err'); setMsg('Network error — please try again')
    }
    setBusy(false)
  }

  if (status === 'ok') {
    return (
      <div style={{
        background: 'rgba(0,255,136,.08)', border: '1px solid rgba(0,255,136,.25)',
        borderRadius: 12, padding: '1rem 1.2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: '1.3rem', marginBottom: '.3rem' }}>✅</div>
        <p style={{ color: 'var(--green, #6bff6b)', margin: 0, fontSize: '.9rem', fontWeight: 600 }}>{msg}</p>
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--bg2, #16162a)', borderRadius: 12,
      border: '1px solid var(--border, #2a2a4a)',
      padding: compact ? '1rem' : '1.5rem',
    }}>
      {!compact && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{
            fontSize: '1.05rem', fontWeight: 700,
            color: 'var(--text, #fff)', margin: '0 0 .3rem',
          }}>📬 Stay Updated</h3>
          <p style={{
            color: 'var(--muted, #aaa)', fontSize: '.82rem',
            margin: 0, lineHeight: 1.6,
          }}>
            Get notified about new features, research updates, and product news.
            Unsubscribe anytime with one click.
          </p>
        </div>
      )}

      <form onSubmit={submit} style={{
        display: 'flex', flexDirection: compact ? 'row' : 'column',
        gap: '.5rem',
      }}>
        {!compact && (
          <input
            type="text" placeholder="Your name (optional)"
            value={name} onChange={e => setName(e.target.value)}
            style={{
              background: 'var(--bg3, #1a1a2e)', color: 'var(--text, #e0e0e0)',
              border: '1px solid var(--border, #2a2a4a)', borderRadius: 8,
              padding: '.6rem .8rem', fontSize: '.88rem', outline: 'none',
            }}
          />
        )}
        <input
          type="email" placeholder="your@email.com" required
          value={email} onChange={e => setEmail(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--bg3, #1a1a2e)', color: 'var(--text, #e0e0e0)',
            border: '1px solid var(--border, #2a2a4a)', borderRadius: 8,
            padding: '.6rem .8rem', fontSize: '.88rem', outline: 'none',
          }}
        />
        <button type="submit" disabled={busy} style={{
          background: busy ? '#333' : 'var(--green, #00ff88)',
          color: '#000', border: 'none', borderRadius: 8,
          padding: '.6rem 1.2rem', fontSize: '.88rem', fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
          transition: 'opacity .15s',
          opacity: busy ? .6 : 1,
        }}>
          {busy ? '...' : compact ? 'Subscribe' : '📬 Subscribe'}
        </button>
      </form>

      {status === 'err' && (
        <p style={{ color: 'var(--red, #ff4444)', fontSize: '.78rem', margin: '.5rem 0 0' }}>{msg}</p>
      )}
      <p style={{
        color: 'var(--dim, #555)', fontSize: '.68rem',
        margin: '.6rem 0 0', lineHeight: 1.5,
      }}>
        We respect your privacy. No spam, ever. Unsubscribe with one click.
      </p>
    </div>
  )
}

// ─── Admin Newsletter Panel ───────────────────────────────────────────────────
export function NewsletterAdmin({ adminEmail, token }) {
  const [subs, setSubs]       = useState([])
  const [subCount, setSubCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState(null)
  const [tab, setTab]         = useState('compose') // compose | subscribers

  useEffect(() => { loadSubs() }, [])

  const loadSubs = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/mailing/subscribers?email=${encodeURIComponent(adminEmail)}&token=${encodeURIComponent(token)}`)
      const d = await r.json()
      setSubs(d.subscribers || [])
      setSubCount(d.count || 0)
    } catch {}
    setLoading(false)
  }

  const sendNewsletter = async () => {
    if (!subject.trim() || !content.trim()) return
    if (!confirm(`Send newsletter to ${subCount} subscribers?`)) return
    setSending(true); setResult(null)
    try {
      const r = await fetch(`${API}/mailing/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_email: adminEmail, token,
          subject: subject.trim(), content: content.trim(),
        }),
      })
      const d = await r.json()
      if (r.ok && d.ok) {
        setResult({ ok: true, msg: `✅ Sent to ${d.sent}/${d.total} subscribers` })
        setSubject(''); setContent('')
      } else {
        setResult({ ok: false, msg: d.detail || 'Failed to send' })
      }
    } catch (err) {
      setResult({ ok: false, msg: 'Network error' })
    }
    setSending(false)
  }

  const tabStyle = (t) => ({
    padding: '.5rem 1rem', borderRadius: '8px 8px 0 0',
    border: '1px solid var(--border)', borderBottom: 'none',
    background: tab === t ? 'var(--bg2)' : 'transparent',
    color: tab === t ? 'var(--text)' : 'var(--muted)',
    fontWeight: tab === t ? 700 : 400, fontSize: '.85rem',
    cursor: 'pointer',
  })

  return (
    <div style={{
      background: 'var(--bg2)', borderRadius: 12,
      border: '1px solid var(--border)', padding: '1.5rem',
      marginBottom: '1rem',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: '1rem',
      }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          📬 Newsletter Admin
        </h3>
        <span style={{
          fontSize: '.75rem', fontWeight: 600,
          color: 'var(--green)', background: 'rgba(0,255,136,.1)',
          border: '1px solid rgba(0,255,136,.2)', borderRadius: 4,
          padding: '.15rem .5rem',
        }}>
          {subCount} subscriber{subCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '.25rem', marginBottom: 0 }}>
        <button onClick={() => setTab('compose')} style={tabStyle('compose')}>✏️ Compose</button>
        <button onClick={() => setTab('subscribers')} style={tabStyle('subscribers')}>👥 Subscribers</button>
      </div>

      {/* Compose tab */}
      {tab === 'compose' && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: '0 12px 12px 12px',
          padding: '1rem', background: 'var(--bg3)',
        }}>
          <input
            type="text" placeholder="Newsletter subject"
            value={subject} onChange={e => setSubject(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '.6rem .8rem', fontSize: '.9rem', marginBottom: '.5rem',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <textarea
            placeholder="Newsletter content (HTML supported)..."
            value={content} onChange={e => setContent(e.target.value)}
            rows={10}
            style={{
              width: '100%', background: 'var(--bg)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '.6rem .8rem', fontSize: '.85rem', resize: 'vertical',
              fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginTop: '.75rem',
          }}>
            <span style={{ fontSize: '.72rem', color: 'var(--dim)' }}>
              Every email includes an automatic unsubscribe link.
            </span>
            <button onClick={sendNewsletter} disabled={sending || !subject || !content}
              style={{
                background: sending ? '#333' : 'var(--blue, #4a90d9)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '.6rem 1.5rem', fontSize: '.9rem', fontWeight: 700,
                cursor: sending ? 'wait' : 'pointer',
                opacity: (!subject || !content) ? .5 : 1,
              }}>
              {sending ? 'Sending...' : `📤 Send to ${subCount}`}
            </button>
          </div>
          {result && (
            <div style={{
              marginTop: '.75rem', padding: '.5rem .8rem', borderRadius: 8,
              background: result.ok ? 'rgba(0,255,136,.08)' : 'rgba(255,68,68,.08)',
              border: `1px solid ${result.ok ? 'rgba(0,255,136,.25)' : 'rgba(255,68,68,.25)'}`,
              color: result.ok ? 'var(--green)' : 'var(--red)',
              fontSize: '.85rem',
            }}>
              {result.msg}
            </div>
          )}
        </div>
      )}

      {/* Subscribers tab */}
      {tab === 'subscribers' && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: '0 12px 12px 12px',
          padding: '1rem', background: 'var(--bg3)',
        }}>
          {loading ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center' }}>Loading...</p>
          ) : subs.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', fontSize: '.88rem' }}>
              No subscribers yet.
            </p>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '.4rem .5rem', color: 'var(--muted)', fontWeight: 600 }}>Email</th>
                    <th style={{ textAlign: 'left', padding: '.4rem .5rem', color: 'var(--muted)', fontWeight: 600 }}>Name</th>
                    <th style={{ textAlign: 'right', padding: '.4rem .5rem', color: 'var(--muted)', fontWeight: 600 }}>Subscribed</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <td style={{ padding: '.4rem .5rem', color: 'var(--text)' }}>{s.email}</td>
                      <td style={{ padding: '.4rem .5rem', color: 'var(--muted)' }}>{s.name || '—'}</td>
                      <td style={{ padding: '.4rem .5rem', color: 'var(--dim)', textAlign: 'right', fontSize: '.75rem' }}>
                        {s.subscribed_at ? new Date(s.subscribed_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={loadSubs} style={{
            marginTop: '.75rem', background: 'none', border: '1px solid var(--border)',
            color: 'var(--muted)', borderRadius: 6, padding: '.3rem .8rem',
            fontSize: '.78rem', cursor: 'pointer',
          }}>
            🔄 Refresh
          </button>
        </div>
      )}
    </div>
  )
}

export default MailingSubscribe