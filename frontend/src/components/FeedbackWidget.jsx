import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// Beta feedback: a small in-app form (no email address shown). The message is
// saved and emailed to the owner. Floating button sits bottom-LEFT so it does
// not clash with the Tawk.to live chat (bottom-right).
export default function FeedbackWidget() {
  const { user } = useAuth()
  const [open, setOpen]       = useState(false)
  const [subject, setSubject] = useState('Beta Feedback')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [err, setErr]         = useState('')

  const submit = async () => {
    if (!message.trim()) return
    setSending(true); setErr('')
    try {
      const r = await fetch(`${API}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email || '', subject, message }),
      })
      if (!r.ok) throw new Error('send failed')
      setSent(true); setMessage(''); setSubject('Beta Feedback')
    } catch {
      setErr('Could not send — please try again in a moment.')
    }
    setSending(false)
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setSent(false); setErr('') }}
        title="Report a bug or send feedback (Beta)"
        style={{position:'fixed',left:16,bottom:16,zIndex:900,
          background:'var(--amber)',color:'#111',border:'none',borderRadius:24,
          padding:'.55rem .9rem',fontWeight:700,fontSize:'.82rem',cursor:'pointer',
          boxShadow:'0 3px 12px rgba(0,0,0,.3)'}}>
        🐞 Beta feedback
      </button>

      {open && (
        <div onClick={e => e.target === e.currentTarget && setOpen(false)}
          style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,.6)',
            display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}}>
          <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:16,
            width:'100%',maxWidth:440,padding:'1.5rem',position:'relative'}}>
            <button onClick={() => setOpen(false)} style={{position:'absolute',top:10,right:12,
              background:'none',border:'none',color:'var(--muted)',fontSize:'1.1rem',cursor:'pointer'}}>✕</button>
            <h3 style={{marginBottom:'.25rem'}}>Send feedback</h3>
            <p style={{fontSize:'.78rem',color:'var(--muted)',marginBottom:'1rem'}}>
              Found a bug or have a suggestion during the Beta? Tell us — it goes straight to the team.
            </p>

            {sent ? (
              <div style={{color:'var(--green)',fontSize:'.9rem',padding:'1rem 0'}}>
                ✓ Thank you! Your feedback was sent. We'll reply by email if needed.
              </div>
            ) : (
              <>
                <input className="form-input" value={subject}
                  onChange={e => setSubject(e.target.value)} maxLength={200}
                  placeholder="Subject (optional)"
                  style={{marginBottom:'.6rem',padding:'.5rem .65rem'}} />
                <textarea className="form-input" value={message}
                  onChange={e => setMessage(e.target.value)} maxLength={5000} rows={5}
                  placeholder="Describe the bug or your idea…"
                  style={{marginBottom:'.6rem',padding:'.5rem .65rem',resize:'vertical',
                    width:'100%',boxSizing:'border-box'}} />
                <div style={{fontSize:'.72rem',color:'var(--muted)',marginBottom:'.6rem'}}>
                  Sending as {user?.email || 'anonymous'}
                </div>
                {err && <div style={{color:'var(--red,#f44)',fontSize:'.78rem',marginBottom:'.5rem'}}>{err}</div>}
                <button className="btn btn-primary" onClick={submit}
                  disabled={sending || !message.trim()} style={{width:'100%'}}>
                  {sending ? 'Sending…' : 'Send feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}