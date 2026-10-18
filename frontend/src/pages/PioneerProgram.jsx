import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

/**
 * Pioneer Program — a Pioneer owner submits one honest experience-report link.
 * After the master approves it, the guide (Why Thought Moves Matter) is unlocked free.
 */
export default function PioneerProgram() {
  const { user } = useAuth()
  const [link, setLink] = useState('')
  const [platform, setPlatform] = useState('')
  const [state, setState] = useState('idle')   // idle | sending | done | error
  const [status, setStatus] = useState(null)
  const [err, setErr] = useState('')

  const loadStatus = async () => {
    try {
      const r = await fetch(`${API}/pioneer/status?email=${encodeURIComponent(user.email)}`)
      if (r.ok) setStatus(await r.json())
    } catch {}
  }
  useEffect(() => { if (user) loadStatus() }, [user])

  const submit = async () => {
    if (!link.trim()) { setErr('Please paste your post link.'); return }
    setState('sending'); setErr('')
    try {
      const r = await fetch(`${API}/pioneer/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, link: link.trim(), platform: platform.trim() })
      })
      if (r.ok) { setState('done'); setLink(''); setPlatform(''); loadStatus() }
      else { const d = await r.json(); setState('error'); setErr(d.detail || 'Could not submit.') }
    } catch { setState('error'); setErr('Network error.') }
  }

  if (!user) return null

  return (
    <div>
      <div className="page-header">
        <h1>🚀 Pioneer Program</h1>
        <p>Share your honest experience — unlock a free guide.</p>
      </div>

      <div className="card" style={{maxWidth:640}}>
        <p style={{color:'var(--muted)',fontSize:'.9rem',lineHeight:1.7}}>
          <strong>The invitation.</strong> Within <strong>30 days</strong> of receiving your device, post one honest
          experience report on any public platform you choose (e.g. a Reddit community, YouTube, your blog, X, a forum).
          Then paste the link below (or email it to us).
        </p>
        <p style={{color:'var(--muted)',fontSize:'.9rem',lineHeight:1.7}}>
          <strong>Your thank-you.</strong> Once we receive your link, the guide
          <em> “Why Thought Moves Matter: Theory, Field Physics &amp; Practical Exercises” </em> is unlocked for you
          free of charge. It is our gift.
        </p>

        <ul style={{color:'var(--muted)',fontSize:'.84rem',lineHeight:1.65,paddingLeft:'1.1rem',margin:'0 0 1rem'}}>
          <li><strong>Honesty.</strong> Your report must reflect your genuine experience — positive, negative or mixed.
            The reward does not depend on what you say.</li>
          <li><strong>Required disclosure.</strong> Please include this line in your post:
            <span style={{display:'block',marginTop:'.3rem',padding:'.5rem .7rem',borderRadius:8,
              background:'var(--bg2, rgba(255,255,255,.04))',border:'1px solid var(--border)',
              color:'var(--text)',fontStyle:'italic'}}>
              “Disclosure: I own a Pioneer Series device and received a free guide as a gift for sharing my experience.”
            </span></li>
          <li><strong>Community rules.</strong> Follow the rules of the community where you post. No duplicate posts,
            no link spam, no coordinated voting.</li>
          <li><strong>No claims.</strong> Describe what you personally experienced. No medical or health claims. It is
            absolutely prohibited to present the product as a medical device, an assistive device, or a medical
            examination tool. Such a representation is incorrect, and the author bears the legal consequences arising from it.</li>
          <li><strong>If you don’t post.</strong> Nothing changes. Your device, software, and all Pioneer benefits
            remain fully yours.</li>
        </ul>

        {status?.reward_unlocked ? (
          <div style={{padding:'1rem',borderRadius:10,background:'rgba(0,194,113,.12)',
            border:'1px solid rgba(0,194,113,.4)',color:'var(--green)',fontWeight:600}}>
            ✓ Your guide is unlocked — thank you for sharing!
          </div>
        ) : (
          <>
            <label className="form-label">Platform (optional)</label>
            <input className="form-input" value={platform} onChange={e=>setPlatform(e.target.value)}
              placeholder="Reddit / YouTube / blog…" style={{marginBottom:'.6rem'}} />
            <label className="form-label">Your post link *</label>
            <input className="form-input" value={link} onChange={e=>setLink(e.target.value)}
              placeholder="https://…" />
            {err && <p style={{color:'var(--red)',fontSize:'.85rem',marginTop:'.5rem'}}>{err}</p>}
            {state === 'done'
              ? <div style={{marginTop:'1rem',padding:'.7rem 1rem',borderRadius:8,
                  background:'rgba(68,170,255,.1)',border:'1px solid rgba(68,170,255,.3)',color:'var(--blue)'}}>
                  ✓ Submitted! We'll review your link and unlock the guide shortly.
                </div>
              : <button className="btn btn-primary" style={{marginTop:'1rem'}}
                  onClick={submit} disabled={state==='sending'}>
                  {state==='sending' ? 'Submitting…' : 'Submit my link'}
                </button>}
          </>
        )}

        {status?.reviews?.length > 0 && (
          <div style={{marginTop:'1.5rem'}}>
            <div style={{fontSize:'.78rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:'.4rem'}}>
              Your submissions
            </div>
            {status.reviews.map((r,i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',gap:'.5rem',
                fontSize:'.82rem',padding:'.3rem 0',borderBottom:'1px solid var(--border)'}}>
                <a href={r.link} target="_blank" rel="noopener noreferrer"
                  style={{color:'var(--blue)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:360}}>{r.link}</a>
                <span style={{color: r.status==='approved' ? 'var(--green)' : r.status==='rejected' ? 'var(--red)' : 'var(--amber)',fontWeight:600}}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}