import { useState, useRef } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
const isMaster = e => MASTER_EMAILS.includes((e||'').toLowerCase())
import { API } from '../config'
import OverlayCanvas from '../components/OverlayCanvas'
import ResultsSection from '../components/ResultsSection'
import DeviceGate from '../components/DeviceGate'

const STAGE_PCT = { queued:5, preprocessing:25, processing:40, done:100 }
const STAGE_LBL = { queued:'Queued...', preprocessing:'Preprocessing...', processing:'Detecting rotation...', done:'Done! ✓' }

const _SI = [[1e12,'T'],[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p']]
const fmtSI = (v, u) => {
  if (!v && v !== 0) return '---'
  const a = Math.abs(v)
  for (const [f,p] of _SI) if (a >= f*0.999) return (v/f).toFixed(3)+' '+p+u
  return v.toExponential(2)+' '+u
}

export default function Upload() {
  const { user } = useAuth()
  if (!user) return null
  const browserLang = (navigator.language || 'en').slice(0,2).toLowerCase()
  const [file, setFile] = useState(null)
  const [hand, setHand] = useState('')
  const [medium, setMedium] = useState('')
  const [dragging, setDragging] = useState(false)
  const [direction, setDirection] = useState('')
  const [state, setState] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState('Ready')
  const [log, setLog] = useState('')
  const [jid, setJid] = useState(null)
  const [sseData, setSseData] = useState(null)
  const [samples, setSamples] = useState([])
  const [physics, setPhysics] = useState(null)
  const [barData, setBarData] = useState(null)
  const [vidW, setVidW] = useState(0)
  const [vidH, setVidH] = useState(0)
  const [totalSec, setTotalSec] = useState(0)
  const [maxVel, setMaxVel] = useState(0)
  const statusTimer = useRef(null)
  const sseRef = useRef(null)
  const vidRef = useRef(null)
  const [replaying, setReplaying] = useState(false)
  const [replayData, setReplayData] = useState(null)
  const replayRef = useRef(null)

  const addLog = m => setLog(l => l + m + '\n')

  // ── Replay recorded samples with overlay (UI playback) ──────────────────
  const stopReplay = () => {
    setReplaying(false)
    setReplayData(null)
    if (replayRef.current) { cancelAnimationFrame(replayRef.current); replayRef.current = null }
  }

  const startReplay = () => {
    if (!samples.length) return
    setReplaying(true)
    let i = 0
    const base = +samples[0].timestamp_sec || 0
    const t0 = performance.now()
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000
      while (i < samples.length - 1 && ((+samples[i + 1].timestamp_sec - base) <= elapsed)) i++
      const s = samples[i]
      setReplayData({
        t_sec:           +s.timestamp_sec,
        rotation_deg:    s.rotation_deg != null ? +s.rotation_deg : null,
        cumulative_deg:  +s.cumulative_deg || 0,
        angular_vel_dps: s.angular_vel_dps != null ? +s.angular_vel_dps : null,
        confidence_pct:  +s.confidence_pct || 0,
      })
      if (vidRef.current) { try { vidRef.current.currentTime = +s.timestamp_sec } catch {} }
      if (i >= samples.length - 1) { stopReplay(); return }
      replayRef.current = requestAnimationFrame(tick)
    }
    replayRef.current = requestAnimationFrame(tick)
  }

  const reset = () => {
    if (statusTimer.current) clearInterval(statusTimer.current)
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
    if (vidRef.current) { vidRef.current.pause(); vidRef.current.src = '' }
    setState('idle'); setProgress(0); setLabel('Ready'); setLog('')
    setJid(null); setSseData(null); setSamples([]); setPhysics(null)
    setVidW(0); setVidH(0); setTotalSec(0); setBarData(null); setMaxVel(0)
  }

  const go = () => {
    if (!file) { alert('Select a video first'); return }
    reset()
    setState('uploading')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('user_email', user.email)
    fd.append('hand_visible', hand)
    fd.append('version', user?.plan || 'basic')
    fd.append('medium', medium)
    fd.append('lang', (navigator.language||'en').slice(0,2).toLowerCase())
    fd.append('direction', direction)

    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', e => {
      if (!e.lengthComputable) return
      const pct = Math.round(e.loaded / e.total * 100)
      setProgress(pct); setLabel(`Uploading: ${pct}%`)
    })
    xhr.addEventListener('load', () => {
      if (xhr.status !== 200) {
        setState('error'); setLabel('Upload failed'); return
      }
      const d = JSON.parse(xhr.responseText)
      setJid(d.job_id)
      addLog('Job: ' + d.job_id)
      if (d.video_info) {
        const vi = d.video_info
        addLog(`Video: ${vi.width}x${vi.height} @ ${vi.fps}fps  ${vi.duration}s`)
        if (vi.duration) setTotalSec(vi.duration)
      }
      setState('processing'); setProgress(5); setLabel('Queued...')

      // Load local file into video — we'll seek it by t_sec from SSE
      if (vidRef.current && file) {
        vidRef.current.src = URL.createObjectURL(file)
        vidRef.current.pause()
      }

      statusTimer.current = setInterval(() => pollStatus(d.job_id), 2000)
      startSSE(d.job_id)
    })
    xhr.open('POST', API + '/upload')
    xhr.send(fd)
    addLog('Uploading ' + file.name + ' ...')
  }

  const pollStatus = async (jobId) => {
    try {
      const d = await (await fetch(API + '/status/' + jobId)).json()
      if (d.status !== 'processing') {
        setProgress(STAGE_PCT[d.status] || 30)
        setLabel(STAGE_LBL[d.status] || d.status)
      }
      if (d.status === 'done') {
        clearInterval(statusTimer.current)
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
        setProgress(100); setLabel('Done! ✓'); setState('done')
        showResults(jobId)
      } else if (d.status === 'error') {
        clearInterval(statusTimer.current)
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
        setState('error'); setLabel('Error: ' + (d.detail || '?'))
      }
    } catch (e) { addLog('Poll error: ' + e.message) }
  }

  const startSSE = (jobId) => {
    if (sseRef.current) sseRef.current.close()
    const es = new EventSource(API + '/frames/' + jobId)
    sseRef.current = es
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data)
        if (d.done) { es.close(); sseRef.current = null; return }
        if (d.error || d.t_sec === undefined) return
        if (d.vid_w) setVidW(d.vid_w)
        if (d.vid_h) setVidH(d.vid_h)
        if (d.total_sec) setTotalSec(d.total_sec)
        // Seek local video to current detection time
        if (vidRef.current && vidRef.current.readyState >= 2) {
          vidRef.current.currentTime = d.t_sec
        }
        setSseData(d)
        if (d.angular_vel_dps != null) setMaxVel(m => Math.max(m, Math.abs(+d.angular_vel_dps)))
        const pct = d.pct || 0
        setProgress(40 + Math.round(pct * .6))
        setLabel('Detecting... ' + pct + '%')
      } catch {}
    }
    es.onerror = () => { if (sseRef.current) { sseRef.current.close(); sseRef.current = null } }
  }

  const showResults = async (jobId) => {
    const s = await (await fetch(API + '/results/' + jobId)).json()
    addLog('Loaded ' + s.length + ' samples')
    setSamples(s)
    try {
      const pr = await (await fetch(API + '/physics/' + jobId)).json()
      if (pr) setPhysics(pr)
    } catch {}
    try {
      const bd = await (await fetch(API + '/bar-data/' + encodeURIComponent(user.email))).json()
      if (bd) setBarData(bd)
    } catch {}
  }

  const progClass = state === 'uploading' ? 'uploading' : state === 'done' ? 'done' : state === 'error' ? 'error' : 'processing'

  return (
    <DeviceGate>
    <div>
      <div className="page-header">
        <h1>Upload Video</h1>
        <p>Upload a video — detect wheel rotation using colored markers</p>
      </div>

      <div className="card">
        <div className="card-title">Video + Parameters</div>
        {/* ── Drop zone ── */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f && f.type.startsWith('video/')) setFile(f)
          }}
          onClick={() => document.getElementById('file-input').click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--green)' : file ? 'var(--border2)' : 'var(--border)'}`,
            borderRadius: 12,
            padding: '1.5rem',
            textAlign: 'center',
            cursor: 'pointer',
            marginBottom: '.75rem',
            background: dragging ? 'rgba(0,255,136,.05)' : file ? 'rgba(0,255,136,.03)' : 'var(--bg3)',
            transition: 'all .2s',
          }}>
          <input id="file-input" type="file" accept="video/*"
            onChange={e => setFile(e.target.files[0])}
            style={{display:'none'}} />
          {file ? (
            <div>
              <div style={{fontSize:'1.5rem',marginBottom:'.25rem'}}>🎬</div>
              <div style={{color:'var(--text)',fontWeight:600,fontSize:'.9rem'}}>{file.name}</div>
              <div style={{color:'var(--muted)',fontSize:'.75rem',marginTop:'.2rem'}}>
                {(file.size/1024/1024).toFixed(1)} MB · click to change
              </div>
            </div>
          ) : (
            <div>
              <div style={{fontSize:'2rem',marginBottom:'.4rem'}}>📁</div>
              <div style={{color:'var(--text)',fontWeight:600,fontSize:'.9rem'}}>
                Drop video here or click to browse
              </div>
              <div style={{color:'var(--muted)',fontSize:'.75rem',marginTop:'.25rem'}}>
                MP4, MOV, AVI — max 120s
              </div>
            </div>
          )}
        </div>

        <div style={{display:'flex',gap:'.75rem',flexWrap:'wrap',alignItems:'flex-end',marginBottom:'.75rem'}}>
          <div style={{flex:1,minWidth:140}}>
            <label className="form-label">Hand</label>
            <select className="form-input" value={hand} onChange={e => setHand(e.target.value)}
              style={{padding:'.45rem .65rem'}}>
              <option value="" disabled hidden>— Choose an option —</option>
              <option value="false">No Hand</option>
              <option value="true">Hand</option>
            </select>
          </div>
          <div style={{flex:1,minWidth:160}}>
            <label className="form-label">Direction</label>
            <select className="form-input" value={direction}
              onChange={e=>setDirection(e.target.value)}
              style={{padding:'.45rem .65rem',width:'100%'}}>
              <option value="" disabled hidden>— Choose an option —</option>
              <option value="cw">↻ CW (clockwise)</option>
              <option value="ccw">↺ CCW (counter-clockwise)</option>
              {(user?.plan==='pro' || user?.plan==='ultimate' || isMaster(user?.email)) && <option value="cw+ccw">↻ then ↺ (CW+CCW)</option>}
              {(user?.plan==='pro' || user?.plan==='ultimate' || isMaster(user?.email)) && <option value="ccw+cw">↺ then ↻ (CCW+CW)</option>}
            </select>
          </div>
          <div style={{flex:1,minWidth:120}}>
            <label className="form-label">Medium</label>
            <select className="form-input" value={medium} onChange={e => setMedium(e.target.value)}
              style={{padding:'.45rem .65rem'}}>
              <option value="" disabled hidden>— Choose an option —</option>
              <option value="air">Air</option>
              <option value="water">Water</option>
            </select>
          </div>
          <div style={{flex:1,minWidth:140}}>
            <label className="form-label">Email</label>
            <input className="form-input" value={user?.email || ''} readOnly
              style={{padding:'.45rem .65rem',opacity:.6}} />
          </div>
        </div>

        <div style={{display:'flex',gap:'.5rem'}}>
          <button className="btn btn-primary" style={{width:'auto',padding:'.55rem 1.5rem'}}
            onClick={go} disabled={state === 'uploading' || state === 'processing' || !direction || !hand || !medium}>
            Upload &amp; Process
          </button>
          <button className="btn btn-secondary" onClick={reset}>Clear</button>
        </div>
      </div>

      {state !== 'idle' && (
        <div className="card">
          <div className="card-title">Status</div>
          <div style={{fontSize:'.78rem',color:'#64748b',minHeight:'1.3em',marginBottom:'.25rem'}}>{label}</div>
          <div className="progress-wrap">
            <div className={`progress-fill ${progClass}`} style={{width: progress + '%'}} />
          </div>

          <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',marginTop:'.8rem'}}>
            <div style={{flex:'1.4',minWidth:280}}>
              <div className="canvas-wrap">
                <video ref={vidRef} muted playsInline
                  style={{width:'100%',display:'block',borderRadius:12}} />
                <OverlayCanvas data={replaying ? replayData : sseData} vidW={vidW} vidH={vidH} />
              </div>
              {(replaying ? replayData : sseData)?.t_sec != null && (
                <div style={{fontSize:'.72rem',color:'#64748b',textAlign:'center',marginTop:'.3rem'}}>
                  {(replaying ? replayData : sseData).t_sec.toFixed(2)}s / {totalSec > 0 ? totalSec.toFixed(1) : '?'}s
                </div>
              )}
              {/* Replay button - appears after processing done */}
              {samples.length > 0 && state === 'done' && (
                <div style={{display:'flex',gap:'.5rem',marginTop:'.5rem',alignItems:'center'}}>
                  {!replaying ? (
                    <button onClick={startReplay} className="btn btn-secondary btn-sm">
                      ▶ Replay with overlay
                    </button>
                  ) : (
                    <button onClick={stopReplay} className="btn btn-danger btn-sm">
                      ■ Stop
                    </button>
                  )}
                  {replaying && replayData && (
                    <span style={{fontSize:'.75rem',color:'var(--muted)'}}>
                      ⏵ {replayData.t_sec?.toFixed(2)}s
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{flex:1,minWidth:200}} className="live-grid">
              {[
                [sseData?.rotation_deg != null ? sseData.rotation_deg.toFixed(1)+'°' : '---', 'Current spoke', ''],
                [sseData ? (Math.abs(sseData.cumulative_deg).toFixed(1)+'° total') : '—', 'Rot: chosen', 'amber'],
                [maxVel > 0 ? maxVel.toFixed(1)+' °/s' : '0.0 °/s', 'Max velocity', 'blue'],
                [(sseData?.confidence_pct || 0) + '%', 'Significance', 'yellow'],
              ].map(([v, l, cls]) => (
                <div key={l} className="live-box">
                  <div className={`live-val ${cls}`}>{v}</div>
                  <div className="live-label">{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="log-box">{log || 'Waiting...'}</div>
        </div>
      )}

      {state === 'done' && jid && (
        <ResultsSection jobId={jid} samples={samples} physics={physics} barData={barData} isPaid={(user?.plan==='pro' || user?.plan==='ultimate' || isMaster(user?.email))} master={isMaster(user?.email)} onReplay={startReplay} onStopReplay={stopReplay} replaying={replaying} />
      )}
    </div>
    </DeviceGate>
  )
}