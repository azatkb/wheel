import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'
import { maskEmail } from '../utils/maskEmail'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes(e?.toLowerCase())
const PAGE_SIZE = 10

const LEADERBOARD_TYPES = [
  { id: 'lr',       label: '🏆 Lajtner Resonance' },
  { id: 'velocity', label: '⚡ Angular Velocity' },
]

const CATEGORIES = [
  { id: 'all',       label: '📋 All',        color: 'var(--muted)' },
  { id: 'results',   label: '🏆 Results',    color: 'var(--amber)' },
  { id: 'questions', label: '❓ Questions',  color: 'var(--blue)'  },
  { id: 'discuss',   label: '💬 Discussion', color: 'var(--green)' },
  { id: 'general',   label: '📌 General',    color: 'var(--dim)'   },
]
const CAT_COLORS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.color]))

function timeAgo(ts) {
  const d = Date.now() - new Date(ts).getTime()
  const m = Math.floor(d/60000), h = Math.floor(m/60), day = Math.floor(h/24)
  if (day > 0) return `${day}d ago`
  if (h > 0)   return `${h}h ago`
  if (m > 0)   return `${m}m ago`
  return 'just now'
}

function Avatar({ email }) {
  const initials = (email||'??').slice(0,2).toUpperCase()
  return (
    <div style={{
      width:36, height:36, borderRadius:'50%',
      background:'linear-gradient(135deg,var(--green),var(--blue))',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:'.75rem', fontWeight:700, color:'#fff', flexShrink:0
    }}>{initials}</div>
  )
}

// ── Post detail page ──────────────────────────────────────────────────────
function Leaderboard({ user }) {
  const [rows, setRows] = useState([])
  const [sortBy, setSortBy] = useState('lr')
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/master/all?email=${encodeURIComponent(user.email)}&limit=1000`)
      const d = await r.json()
      setRows(d.rows || [])
    } catch {}
    finally { setLoading(false) }
  }

  const getLR = (e) => e ? e / 6.626e-34 : 0
  const fmtLR = (e) => {
    const f = getLR(e); if (!f) return '—'
    const exp = Math.floor(Math.log10(Math.abs(f)))
    return `${(f/Math.pow(10,exp)).toFixed(2)}L${exp>=0?'+':''}${exp}R`
  }
  const getVel = (r) => (r.cumulative_deg && r.t_lajtner > 0)
    ? (r.cumulative_deg / r.t_lajtner).toFixed(3) : '—'

  const anonymize = (email) => maskEmail(email)  // unified masking l…t@g…m

  const sorted = [...rows].sort((a,b) =>
    sortBy === 'lr' ? getLR(b.w_total_air) - getLR(a.w_total_air)
    : (b.cumulative_deg||0)/(b.t_lajtner||1) - (a.cumulative_deg||0)/(a.t_lajtner||1)
  ).slice(0, 20)

  const myEmail = user.email

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',
      borderRadius:10,padding:'1rem',marginBottom:'1.25rem'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'.75rem'}}>
        <div style={{fontWeight:700,color:'var(--text)'}}>🏆 Top 20 Rankings</div>
        <div style={{display:'flex',gap:'.4rem'}}>
          {[['lr','Lajtner Resonance'],['velocity','Avg Velocity']].map(([k,l]) => (
            <button key={k} onClick={() => setSortBy(k)}
              className={`btn btn-sm ${sortBy===k?'btn-primary':'btn-secondary'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div style={{color:'var(--muted)',fontSize:'.85rem'}}>Loading...</div> :
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.82rem'}}>
        <thead>
          <tr>
            <th style={{padding:'.3rem .5rem',color:'var(--muted)',textAlign:'left',
              borderBottom:'1px solid var(--border)',width:32}}>#</th>
            <th style={{padding:'.3rem .5rem',color:'var(--muted)',textAlign:'left',
              borderBottom:'1px solid var(--border)'}}>User</th>
            <th style={{padding:'.3rem .5rem',color:'var(--amber)',textAlign:'right',
              borderBottom:'1px solid var(--border)'}}>LR</th>
            <th style={{padding:'.3rem .5rem',color:'var(--blue)',textAlign:'right',
              borderBottom:'1px solid var(--border)'}}>Vel (°/s)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const isMe = r.email === myEmail
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`
            return (
              <tr key={r.job_id || i} style={{
                background: isMe ? 'rgba(0,255,136,.05)' : 'none',
                borderBottom:'1px solid var(--border)'
              }}>
                <td style={{padding:'.3rem .5rem',textAlign:'center'}}>{medal}</td>
                <td style={{padding:'.3rem .5rem',
                  color: isMe ? 'var(--green)' : 'var(--text)',
                  fontWeight: isMe ? 700 : 400}}>
                  {maskEmail(r.email)}
                  {isMe && <span style={{fontSize:'.68rem',color:'var(--green)',marginLeft:'.4rem'}}>← you</span>}
                </td>
                <td style={{padding:'.3rem .5rem',textAlign:'right',
                  color:'var(--amber)',fontFamily:'monospace',fontWeight:600}}>
                  {fmtLR(r.w_total_air)}
                </td>
                <td style={{padding:'.3rem .5rem',textAlign:'right',
                  color:'var(--blue)',fontFamily:'monospace'}}>
                  {getVel(r)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>}
      <div style={{fontSize:'.7rem',color:'var(--dim)',marginTop:'.5rem',textAlign:'center'}}>
        Names are anonymized · Based on best measurements
      </div>
    </div>
  )
}

function PostPage({ post, user, onBack, onRefresh }) {
  const [comments, setComments] = useState([])
  const [text, setText]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [liked, setLiked]       = useState(false)
  const [likes, setLikes]       = useState(post.likes || 0)
  const master = isMaster(user?.email)

  const handleLike = async () => {
    const r = await fetch(`${API}/forum/like`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_email: user.email, target_id: post.id, target_type:'post' })
    })
    const d = await r.json()
    setLiked(d.liked)
    setLikes(l => d.liked ? l+1 : l-1)
  }

  useEffect(() => { loadComments() }, [post.id])

  const loadComments = async () => {
    const r = await fetch(`${API}/forum/posts/${post.id}/comments`)
    const d = await r.json()
    setComments(d.comments || [])
  }

  const submit = async () => {
    if (!text.trim()) return
    setLoading(true)
    await fetch(`${API}/forum/posts/${post.id}/comments`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_email: user.email, body: text.trim() })
    })
    setText('')
    await loadComments()
    setLoading(false)
  }

  const deleteComment = async (cid) => {
    if (!confirm('Delete comment?')) return
    await fetch(`${API}/forum/comments/${cid}?email=${encodeURIComponent(user.email)}`, { method:'DELETE' })
    loadComments()
  }

  return (
    <div>
      {/* Back button */}
      <button className="btn btn-secondary btn-sm" onClick={onBack}
        style={{marginBottom:'1.25rem'}}>
        ← Back to Forum
      </button>

      {/* Post card */}
      <div className="card">
        {post.pinned && (
          <div style={{fontSize:'.68rem',color:'var(--amber)',fontWeight:700,marginBottom:'.5rem'}}>
            📌 PINNED
          </div>
        )}
        <div style={{display:'flex',gap:'.85rem',alignItems:'flex-start',marginBottom:'1rem'}}>
          <Avatar email={post.user_email} />
          <div style={{flex:1}}>
            <h2 style={{fontSize:'1.1rem',fontWeight:700,color:'var(--text)',marginBottom:'.25rem'}}>
              {post.title}
            </h2>
            <div style={{fontSize:'.75rem',color:'var(--muted)'}}>
              {maskEmail(post.user_email)} · {timeAgo(post.created_at)}
            </div>
          </div>
        </div>

        {/* Lajtner Resonance badge */}
        {post.lr_value && (
          <div style={{
            background:'rgba(255,136,0,.1)',border:'1px solid rgba(255,136,0,.3)',
            borderRadius:8,padding:'.6rem 1rem',marginBottom:'1rem',
            display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'
          }}>
            <span style={{fontSize:'.72rem',color:'var(--muted)'}}>Lajtner Resonance</span>
            <span style={{fontSize:'1.3rem',fontWeight:800,color:'var(--amber)',fontFamily:'monospace'}}>
              {post.lr_value}
            </span>
            {post.rotation_deg > 0 && (
              <span style={{fontSize:'.8rem',color:'var(--dim)'}}>
                ↻ {post.rotation_deg?.toFixed(1)}° · {(post.medium||'air').toUpperCase()}
              </span>
            )}
          </div>
        )}

        <div style={{color:'var(--text)',fontSize:'.9rem',lineHeight:1.8,
          borderBottom:'1px solid var(--border)',paddingBottom:'1.25rem',marginBottom:'1.25rem',
          whiteSpace:'pre-wrap'}}>
          {post.body}
        </div>

        {/* Like button */}
        <div style={{display:'flex',gap:'1rem',marginBottom:'1rem'}}>
          <button onClick={handleLike} style={{
            background: liked ? 'rgba(0,255,136,.1)' : 'none',
            border: `1px solid ${liked ? 'var(--green)' : 'var(--border)'}`,
            borderRadius:20, padding:'.3rem .9rem',
            color: liked ? 'var(--green)' : 'var(--muted)',
            cursor:'pointer', fontSize:'.85rem', display:'flex', alignItems:'center', gap:'.4rem'
          }}>♥ {likes}</button>
        </div>

        {/* Master actions */}
        {master && (
          <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem'}}>
            <button className="btn btn-secondary btn-sm" onClick={async () => {
              await fetch(`${API}/forum/pin/${post.id}?email=${encodeURIComponent(user.email)}`, { method:'POST' })
              onRefresh(); onBack()
            }}>{post.pinned ? 'Unpin' : '📌 Pin'}</button>
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (!confirm('Delete post?')) return
              await fetch(`${API}/forum/posts/${post.id}?email=${encodeURIComponent(user.email)}`, { method:'DELETE' })
              onRefresh(); onBack()
            }}>Delete post</button>
          </div>
        )}

        {/* Comments */}
        <div style={{fontWeight:600,fontSize:'.75rem',color:'var(--dim)',
          textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.75rem'}}>
          Comments ({comments.length})
        </div>

        {comments.length === 0 && (
          <div style={{color:'var(--dim)',fontSize:'.85rem',marginBottom:'1rem'}}>
            No comments yet. Be the first!
          </div>
        )}

        {comments.map(c => (
          <div key={c.id} style={{
            display:'flex',gap:'.6rem',marginBottom:'.75rem',
            padding:'.7rem .9rem',background:'var(--bg3)',
            borderRadius:8,border:'1px solid var(--border)'
          }}>
            <Avatar email={c.user_email} />
            <div style={{flex:1}}>
              <div style={{fontSize:'.72rem',color:'var(--muted)',marginBottom:'.2rem'}}>
                {maskEmail(c.user_email)} · {timeAgo(c.created_at)}
                {(master || c.user_email === user.email) && (
                  <button onClick={() => deleteComment(c.id)} style={{
                    marginLeft:'.75rem',background:'none',border:'none',
                    color:'var(--dim)',cursor:'pointer',fontSize:'.7rem'
                  }}>Delete</button>
                )}
              </div>
              <div style={{fontSize:'.88rem',color:'var(--text)',lineHeight:1.6}}>{c.body}</div>
            </div>
          </div>
        ))}

        {/* New comment */}
        <div style={{marginTop:'1rem',display:'flex',gap:'.5rem',alignItems:'flex-end'}}>
          <textarea value={text} onChange={e=>setText(e.target.value)}
            placeholder="Write a comment..."
            onKeyDown={e => { if (e.key==='Enter' && e.ctrlKey) submit() }}
            style={{flex:1,background:'var(--bg3)',border:'1px solid var(--border)',
              borderRadius:6,padding:'.65rem .85rem',color:'var(--text)',
              fontSize:'.88rem',resize:'vertical',minHeight:70,fontFamily:'inherit'}} />
          <button onClick={submit} disabled={loading || !text.trim()}
            className="btn btn-primary btn-sm">
            {loading ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Post Modal ────────────────────────────────────────────────────────
function NewPostModal({ user, onClose, onCreated, shareData }) {
  const [title, setTitle]     = useState(shareData?.title || '')
  const [body, setBody]       = useState(shareData?.body || '')
  const [category, setCategory] = useState('results')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  // Attach one of my own measurement videos to the post
  const [myJobs, setMyJobs]   = useState([])
  const [jobId, setJobId]     = useState(shareData?.job_id || '')

  useEffect(() => {
    if (!user?.email) return
    ;(async () => {
      try {
        const r = await fetch(`${API}/api/jobs?email=${encodeURIComponent(user.email)}&limit=50`)
        const d = await r.json()
        setMyJobs((d.jobs || []).filter(j => j.status === 'done'))
      } catch {}
    })()
  }, [user?.email])

  const submit = async () => {
    if (!title.trim() || !body.trim()) { setError('Title and text required'); return }
    setLoading(true)
    const r = await fetch(`${API}/forum/posts`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        user_email:   user.email,
        title:        title.trim(),
        body:         body.trim(),
        category:     category,
        job_id:       jobId || shareData?.job_id,
        lr_value:     shareData?.lr_value,
        rotation_deg: shareData?.rotation_deg,
        medium:       shareData?.medium,
      })
    })
    if (r.ok) { onCreated() }
    else { const d = await r.json(); setError(d.detail || 'Error') }
    setLoading(false)
  }

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,.7)',
      zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'
    }} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{
        background:'var(--bg2)',border:'1px solid var(--border)',
        borderRadius:12,width:'100%',maxWidth:540,padding:'1.5rem',position:'relative'
      }}>
        <button onClick={onClose} style={{
          position:'absolute',top:'1rem',right:'1rem',
          background:'none',border:'none',color:'var(--muted)',fontSize:'1.3rem',cursor:'pointer'
        }}>×</button>

        <div style={{fontWeight:700,fontSize:'1rem',color:'var(--text)',marginBottom:'1rem'}}>
          ✏️ New Post
        </div>

        {shareData?.lr_value && (
          <div style={{
            background:'rgba(255,136,0,.1)',border:'1px solid rgba(255,136,0,.3)',
            borderRadius:8,padding:'.5rem .85rem',marginBottom:'.75rem',fontSize:'.82rem'
          }}>
            <span style={{color:'var(--muted)'}}>Sharing: </span>
            <span style={{color:'var(--amber)',fontWeight:700}}>{shareData.lr_value}</span>
            {shareData.nickname && (
              <span style={{color:'var(--text)',marginLeft:'.5rem'}}>· {shareData.nickname}</span>
            )}
            {shareData.rotation_deg > 0 && (
              <span style={{color:'var(--dim)',marginLeft:'.5rem'}}>
                · ↻ {shareData.rotation_deg?.toFixed(1)}° · {(shareData.medium||'air').toUpperCase()}
              </span>
            )}
          </div>
        )}

        {error && <div className="error-msg">{error}</div>}

        <div className="form-group">
          <label className="form-label">Category</label>
          <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap'}}>
            {CATEGORIES.filter(c=>c.id!=='all').map(cat => (
              <button key={cat.id} type="button"
                onClick={() => setCategory(cat.id)}
                style={{
                  padding:'.25rem .65rem', borderRadius:20, fontSize:'.75rem',
                  border:`1px solid ${category===cat.id ? cat.color : 'var(--border)'}`,
                  background: category===cat.id ? `${cat.color}22` : 'none',
                  color: category===cat.id ? cat.color : 'var(--muted)',
                  cursor:'pointer'
                }}>{cat.label}</button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">🎥 Attach one of my videos (optional)</label>
          <select value={jobId} onChange={e => setJobId(e.target.value)}
            className="form-input" style={{width:'100%'}}>
            <option value="">— No video —</option>
            {myJobs.map(j => (
              <option key={j.id} value={j.id}>
                {(j.nickname || 'Measurement')} · {(j.created_at || '').slice(0,16).replace('T',' ')}
                {j.medium ? ' · ' + String(j.medium).toUpperCase() : ''}
              </option>
            ))}
          </select>
          <div style={{fontSize:'.7rem',color:'var(--dim)',marginTop:'.2rem'}}>
            {myJobs.length
              ? 'Only your own measurements are listed. The video is shown with your post.'
              : 'No finished measurements yet — upload one to attach its video.'}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Title</label>
          <input value={title} onChange={e=>setTitle(e.target.value)}
            placeholder="Post title..." className="form-input" maxLength={200} />
        </div>

        <div className="form-group">
          <label className="form-label">Text</label>
          <textarea value={body} onChange={e=>setBody(e.target.value)}
            placeholder="Share your experience, question or result..."
            style={{width:'100%',background:'var(--bg3)',border:'1px solid var(--border)',
              borderRadius:6,padding:'.75rem',color:'var(--text)',fontSize:'.88rem',
              resize:'vertical',minHeight:130,fontFamily:'inherit'}}
            maxLength={2000} />
          <div style={{fontSize:'.7rem',color:'var(--dim)',textAlign:'right',marginTop:'.2rem'}}>
            {body.length}/2000
          </div>
        </div>

        <button onClick={submit} disabled={loading} className="btn btn-primary"
          style={{width:'100%'}}>
          {loading ? '...' : 'Publish Post'}
        </button>
      </div>
    </div>
  )
}

// ── Post card (list view) ────────────────────────────────────────────────
function PostCard({ post, onOpen }) {
  return (
    <div onClick={() => onOpen(post)} style={{
      background:'var(--bg2)',
      border:`1px solid ${post.pinned ? 'rgba(255,136,0,.5)' : 'var(--border)'}`,
      borderRadius:10,padding:'1rem 1.2rem',marginBottom:'.6rem',
      cursor:'pointer',transition:'border-color .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = post.pinned ? 'var(--amber)' : 'var(--border2)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = post.pinned ? 'rgba(255,136,0,.5)' : 'var(--border)'}
    >
      {post.pinned && (
        <div style={{fontSize:'.65rem',color:'var(--amber)',fontWeight:700,marginBottom:'.3rem'}}>
          📌 PINNED
        </div>
      )}
      <div style={{display:'flex',gap:'.75rem',alignItems:'flex-start'}}>
        <Avatar email={post.user_email} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',justifyContent:'space-between',
            alignItems:'center',flexWrap:'wrap',gap:'.4rem',marginBottom:'.3rem'}}>
            <span style={{fontSize:'.75rem',color:'var(--muted)'}}>
              <span style={{color:'var(--text)',fontWeight:500}}>
                {maskEmail(post.user_email)}
              </span>
              <span style={{marginLeft:'.5rem'}}>{timeAgo(post.created_at)}</span>
            </span>
            {post.lr_value && (
              <span style={{fontSize:'.72rem',color:'var(--amber)',fontWeight:700,
                background:'rgba(255,136,0,.1)',padding:'.15rem .5rem',borderRadius:4,
                fontFamily:'monospace'}}>
                {post.lr_value}
              </span>
            )}
          </div>
          <div style={{fontWeight:600,color:'var(--text)',fontSize:'.92rem',marginBottom:'.25rem'}}>
            {post.title}
          </div>
          <div style={{fontSize:'.8rem',color:'var(--muted)',
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {post.body}
          </div>
          <div style={{display:'flex',gap:'1rem',marginTop:'.5rem',fontSize:'.75rem',color:'var(--dim)',alignItems:'center'}}>
            <span>♥ {post.likes || 0}</span>
            {post.rotation_deg > 0 && <span>↻ {post.rotation_deg?.toFixed(1)}°</span>}
            {post.medium && <span>{post.medium.toUpperCase()}</span>}
            {post.category && post.category !== 'general' && (
              <span style={{color: CAT_COLORS[post.category] || 'var(--dim)',
                border:`1px solid ${CAT_COLORS[post.category]||'var(--border)'}22`,
                padding:'.1rem .4rem',borderRadius:4,fontSize:'.68rem'}}>
                {CATEGORIES.find(c=>c.id===post.category)?.label || post.category}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Forum ───────────────────────────────────────────────────────────
export default function Forum() {
  const { user } = useAuth()
  if (!user) return null

  const [posts, setPosts]       = useState([])
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboard, setLeaderboard] = useState([])
  const [lbType, setLbType] = useState('lr')
  const [lbLoading, setLbLoading] = useState(false)
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(false)
  const [openPost, setOpenPost] = useState(null)
  const [showNew, setShowNew]   = useState(false)
  const [shareData, setShareData] = useState(null)
  const [search, setSearch]     = useState('')
  const [category, setCategory] = useState('all')
  const [notifs, setNotifs]     = useState([])
  const [showNotifs, setShowNotifs] = useState(false)

  const loadNotifs = useCallback(async () => {
    if (!user?.email) return
    try {
      const r = await fetch(`${API}/forum/notifications?email=${encodeURIComponent(user.email)}`)
      const d = await r.json()
      setNotifs(d.notifications || [])
    } catch {}
  }, [user?.email])

  const markSeen = async () => {
    await fetch(`${API}/forum/notifications/seen`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email: user.email })
    })
    setNotifs(prev => prev.map(n => ({...n, seen:true})))
  }

  const loadLeaderboard = useCallback(async (type = 'lr') => {
    setLbLoading(true)
    try {
      const r = await fetch(`${API}/forum/leaderboard?type=${type}&limit=20`)
      const d = await r.json()
      setLeaderboard(d.entries || [])
    } catch {}
    finally { setLbLoading(false) }
  }, [])

  const load = useCallback(async (pg = 0, cat = null) => {
    setLoading(true)
    try {
      const offset = pg * PAGE_SIZE
      const useCat = cat !== null ? cat : category
      const catParam = useCat && useCat !== 'all' ? `&category=${useCat}` : ''
      const r = await fetch(`${API}/forum/posts?limit=${PAGE_SIZE}&offset=${offset}${catParam}`)
      const d = await r.json()
      setPosts(d.posts || [])
      setTotal(d.total || d.count || 0)
      setPage(pg)
    } catch {}
    finally { setLoading(false) }
  }, [category])

  useEffect(() => {
    load(0)
    loadNotifs()
    const interval = setInterval(loadNotifs, 30000) // poll every 30s
    // Check share from History
    const sd = sessionStorage.getItem('forum_share')
    if (sd) {
      try {
        setShareData(JSON.parse(sd))
        setShowNew(true)
        sessionStorage.removeItem('forum_share')
      } catch {}
    }
    return () => clearInterval(interval)
  }, [])

  const filtered = search
    ? posts.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.body.toLowerCase().includes(search.toLowerCase()) ||
        p.user_email.toLowerCase().includes(search.toLowerCase())
      )
    : posts

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1

  // Show post detail page
  if (openPost) {
    return (
      <PostPage
        post={openPost}
        user={user}
        onBack={() => setOpenPost(null)}
        onRefresh={() => load(page)}
      />
    )
  }


  return (
    <div>
      <div className="page-header">
        <h1>💬 Community Forum</h1>
        <p>Share results, ask questions, compare Lajtner Resonances</p>
      </div>

      {/* Toolbar */}
      <div style={{display:'flex',gap:'.75rem',marginBottom:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
        <button className="btn btn-primary" onClick={() => { setShareData(null); setShowNew(true) }}>
          + New Post
        </button>
        <button className="btn btn-secondary"
          onClick={() => setShowLeaderboard(v=>!v)}
          style={{borderColor: showLeaderboard ? 'var(--amber)' : 'var(--border)'}}>
          🏆 Rankings
        </button>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search posts..."
          className="form-input"
          style={{flex:1,maxWidth:300,padding:'.45rem .85rem'}} />
        <button className="btn btn-secondary btn-sm" onClick={() => load(page)}>↺</button>
        <button
          className={`btn btn-sm ${showLeaderboard ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setShowLeaderboard(v=>!v); if(!showLeaderboard) loadLeaderboard(lbType) }}>
          🏆 Leaderboard
        </button>
        <div style={{position:'relative'}}>
          <button className="btn btn-secondary btn-sm"
            onClick={() => { setShowNotifs(v=>!v); if(!showNotifs) markSeen() }}
            style={{position:'relative'}}>
            🔔
            {notifs.filter(n=>!n.seen).length > 0 && (
              <span style={{
                position:'absolute',top:-6,right:-6,
                background:'var(--red)',color:'#fff',
                borderRadius:'50%',width:16,height:16,
                fontSize:'.6rem',display:'flex',alignItems:'center',justifyContent:'center',
                fontWeight:700
              }}>{notifs.filter(n=>!n.seen).length}</span>
            )}
          </button>
          {showNotifs && (
            <div style={{
              position:'absolute',right:0,top:'calc(100% + 6px)',
              background:'var(--bg2)',border:'1px solid var(--border)',
              borderRadius:10,width:280,zIndex:200,
              boxShadow:'0 4px 20px rgba(0,0,0,.4)',
              maxHeight:320,overflowY:'auto'
            }}>
              <div style={{padding:'.75rem 1rem',borderBottom:'1px solid var(--border)',
                fontSize:'.75rem',color:'var(--muted)',fontWeight:600}}>
                NOTIFICATIONS
              </div>
              {notifs.length === 0 ? (
                <div style={{padding:'1rem',color:'var(--dim)',fontSize:'.82rem',textAlign:'center'}}>
                  No notifications yet
                </div>
              ) : notifs.slice(0,15).map(n => (
                <div key={n.id} style={{
                  padding:'.6rem 1rem',borderBottom:'1px solid var(--border)',
                  background: n.seen ? 'none' : 'rgba(0,255,136,.04)',
                  fontSize:'.8rem',cursor:'pointer'
                }} onClick={() => setShowNotifs(false)}>
                  <span style={{color:'var(--text)',fontWeight:500}}>
                    {maskEmail(n.from_email)}
                  </span>
                  <span style={{color:'var(--muted)',marginLeft:'.4rem'}}>
                    {n.type === 'comment' ? 'commented on your post' : 'liked your post'}
                  </span>
                  <div style={{color:'var(--dim)',fontSize:'.7rem',marginTop:'.15rem'}}>
                    {timeAgo(n.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard */}
      {showLeaderboard && (
        <Leaderboard user={user} />
      )}

      {/* Leaderboard panel */}
      {showLeaderboard && (
        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',
          borderRadius:10,padding:'1rem 1.25rem',marginBottom:'1.25rem'}}>
          <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',flexWrap:'wrap'}}>
            {LEADERBOARD_TYPES.map(t => (
              <button key={t.id}
                onClick={() => { setLbType(t.id); loadLeaderboard(t.id) }}
                className={`btn btn-sm ${lbType===t.id ? 'btn-primary' : 'btn-secondary'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {lbLoading ? (
            <div style={{color:'var(--muted)',textAlign:'center',padding:'1rem'}}>Loading...</div>
          ) : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.82rem'}}>
              <thead>
                <tr>
                  <th style={{padding:'.3rem .5rem',color:'var(--muted)',textAlign:'left',
                    borderBottom:'1px solid var(--border)',width:40}}>#</th>
                  <th style={{padding:'.3rem .5rem',color:'var(--muted)',textAlign:'left',
                    borderBottom:'1px solid var(--border)'}}>
                    {lbType === 'lr' ? 'Lajtner Resonance' : 'Avg Velocity (°/s)'}
                  </th>
                  <th style={{padding:'.3rem .5rem',color:'var(--muted)',textAlign:'right',
                    borderBottom:'1px solid var(--border)'}}>Value</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((e, i) => (
                  <tr key={i} style={{borderBottom:'1px solid rgba(30,42,56,.3)'}}>
                    <td style={{padding:'.35rem .5rem',color:
                      i===0 ? '#FFD700' : i===1 ? '#C0C0C0' : i===2 ? '#CD7F32' : 'var(--dim)',
                      fontWeight: i < 3 ? 700 : 400, fontSize: i < 3 ? '.9rem' : '.82rem'}}>
                      {i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `${i+1}.`}
                    </td>
                    <td style={{padding:'.35rem .5rem',color:'var(--muted)',fontStyle:'italic',
                      fontSize:'.78rem'}}>
                      Anonymous #{e.rank_id}
                    </td>
                    <td style={{padding:'.35rem .5rem',textAlign:'right',
                      color:'var(--amber)',fontFamily:'monospace',fontWeight:600}}>
                      {e.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{fontSize:'.7rem',color:'var(--dim)',marginTop:'.75rem',textAlign:'center'}}>
            Rankings are anonymous — only values are shown
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div style={{display:'flex',gap:'.4rem',marginBottom:'1rem',flexWrap:'wrap'}}>
        {CATEGORIES.map(cat => (
          <button key={cat.id}
            onClick={() => { setCategory(cat.id); load(0, cat.id) }}
            style={{
              padding:'.3rem .75rem', borderRadius:20, fontSize:'.78rem',
              border:`1px solid ${category===cat.id ? cat.color : 'var(--border)'}`,
              background: category===cat.id ? `${cat.color}22` : 'none',
              color: category===cat.id ? cat.color : 'var(--muted)',
              cursor:'pointer', transition:'all .15s'
            }}>{cat.label}</button>
        ))}
      </div>

      {/* Posts list */}
      {loading && (
        <div style={{textAlign:'center',padding:'2rem',color:'var(--muted)'}}>Loading...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{textAlign:'center',padding:'3rem 1rem',color:'var(--dim)'}}>
          <div style={{fontSize:'2.5rem',marginBottom:'1rem'}}>💬</div>
          <div style={{fontSize:'1rem',marginBottom:'.5rem',color:'var(--muted)'}}>No posts yet</div>
          <div style={{fontSize:'.85rem'}}>Be the first to share your result!</div>
        </div>
      )}

      {!loading && filtered.map(post => (
        <PostCard key={post.id} post={post} onOpen={setOpenPost} />
      ))}

      {/* Pagination - always show if more than PAGE_SIZE posts */}
      {!search && (
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',
          gap:'.5rem',marginTop:'1.5rem',flexWrap:'wrap'}}>
          <button className="btn btn-secondary btn-sm"
            disabled={page === 0} onClick={() => load(page - 1)}>← Prev</button>
          {Array.from({length: Math.max(totalPages,1)}, (_,i) => (
            <button key={i}
              className={`btn btn-sm ${i === page ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => load(i)}
              style={{minWidth:36}}>
              {i + 1}
            </button>
          ))}
          <button className="btn btn-secondary btn-sm"
            disabled={page >= Math.max(totalPages,1)-1} onClick={() => load(page + 1)}>Next →</button>
          <span style={{fontSize:'.72rem',color:'var(--dim)',marginLeft:'.5rem'}}>
            {total} posts · page {page+1}/{Math.max(totalPages,1)}
          </span>
        </div>
      )}

      {/* New Post Modal */}
      {showNew && (
        <NewPostModal
          user={user}
          shareData={shareData}
          onClose={() => { setShowNew(false); setShareData(null) }}
          onCreated={() => { setShowNew(false); setShareData(null); load(0) }}
        />
      )}
    </div>
  )
}