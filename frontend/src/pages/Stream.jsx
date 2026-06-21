import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API, WSS } from '../config'
import ResultsSection from '../components/ResultsSection'
import OverlayCanvas from '../components/OverlayCanvas'
import DeviceGate from '../components/DeviceGate'

const STAGE_LBL = { queued:'Queued...', preprocessing:'Preprocessing...', processing:'Detecting rotation...', done:'Done! ✓' }
const STAGE_PCT = { queued:5, preprocessing:25, processing:40, done:100 }

const MASTER_EMAILS = ['azatkb22@gmail.com', 'lajtnert@gmail.com']
function isMaster(email) {
  if (!email) return false
  const e = email.toLowerCase()
  return MASTER_EMAILS.some(m => e === m || e.startsWith(m.split('@')[0]))
}

function RecTimer() {
  const [sec, setSec] = React.useState(0)
  React.useEffect(() => {
    const t = setInterval(() => setSec(s => s+1), 1000)
    return () => clearInterval(t)
  }, [])
  const m = Math.floor(sec/60), s = sec%60
  const color = sec > 180 ? 'var(--green)' : 'var(--amber)'
  return (
    <span style={{fontSize:'.85rem',fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>
      ⏺ {String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
    </span>
  )
}

function StreamCore({ user, medium }) {
  const [streaming, setStreaming] = useState(false)
  const [cameras, setCameras] = useState([])
  const [camId, setCamId] = useState('')
  const [hand, setHand] = useState('')
  const [direction, setDirection] = useState('')
  const [state, setState] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState('Ready')
  const [log, setLog] = useState('')
  const [jid, setJid] = useState(null)
  const [sseData, setSseData] = useState(null)
  const [samples, setSamples] = useState([])
  const [physics, setPhysics] = useState(null)
  const [vidW, setVidW] = useState(0)
  const [vidH, setVidH] = useState(0)
  const [totalSec, setTotalSec] = useState(0)
  const [streamJobId, setStreamJobId] = useState(null)
  const [showBanner, setShowBanner] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [replayData, setReplayData] = useState(null)
  const replayRef = useRef(null)

  const camRef = useRef(null)
  const playbackRef = useRef(null)  // for synced playback during detection
  const wsRef = useRef(null)
  const camStream = useRef(null)
  const sendLoop = useRef(null)
  const frozenCanvas = useRef(null)
  const statusTimer = useRef(null)
  const sseRef = useRef(null)
  const streamJobIdRef = useRef(null)
  const mediaRecorder = useRef(null)
  const recordedChunks = useRef([])
  const localBlobUrl = useRef(null)

  useEffect(() => {
    listCams()
    return () => {
      if (sendLoop.current) clearInterval(sendLoop.current)
      if (wsRef.current) wsRef.current.close()
      if (camStream.current) camStream.current.getTracks().forEach(t => t.stop())
    }
  }, [])

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
      if (playbackRef.current) { try { playbackRef.current.currentTime = +s.timestamp_sec } catch {} }
      if (i >= samples.length - 1) { stopReplay(); return }
      replayRef.current = requestAnimationFrame(tick)
    }
    replayRef.current = requestAnimationFrame(tick)
  }

  const listCams = async () => {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true })
      const devs = await navigator.mediaDevices.enumerateDevices()
      tmp.getTracks().forEach(t => t.stop())
      const cams = devs.filter(d => d.kind === 'videoinput')
      setCameras(cams)
      const back = cams.find(d => /back|rear|environment/i.test(d.label))
      setCamId(back?.deviceId || cams[0]?.deviceId || '')
      if (cams[0]) startCamPreview(back?.deviceId || cams[0].deviceId)
    } catch(e) { addLog('Camera error: ' + e.message) }
  }

  const startCamPreview = async (deviceId) => {
    if (camStream.current) camStream.current.getTracks().forEach(t => t.stop())
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId || undefined } })
      camStream.current = s
      if (camRef.current) camRef.current.srcObject = s
    } catch {}
  }

  const startStream = async () => {
    if (!direction) { alert('Please select a direction first'); return }
    const s = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: camId || undefined, width: 1280, height: 720 }
    })
    camStream.current = s
    if (camRef.current) camRef.current.srcObject = s

    const eml = encodeURIComponent(user.email)
    const ws = new WebSocket(`${WSS}/stream?email=${eml}&lang=en&direction=${direction}&medium=${medium || 'air'}&hand_visible=${hand}&version=${user.plan || 'basic'}`)
    wsRef.current = ws

    ws.onopen = () => {
      addLog('Recording...')
      setLabel('Recording - press Stop to process')
      setProgress(50); setState('streaming'); setStreaming(true)
      // Record locally for synced playback
      recordedChunks.current = []
      try {
        const mr = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8' })
        mr.ondataavailable = e => { if (e.data.size > 0) recordedChunks.current.push(e.data) }
        mr.start(100)
        mediaRecorder.current = mr
      } catch(e) { addLog('Local record failed: ' + e.message) }
      frozenCanvas.current = document.createElement('canvas')
      const video = camRef.current
      sendLoop.current = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const vw = video.videoWidth || 640, vh = video.videoHeight || 480
        const scale = vw > 1280 ? 1280/vw : 1
        const sw = Math.round(vw*scale), sh = Math.round(vh*scale)
        frozenCanvas.current.width = sw; frozenCanvas.current.height = sh
        frozenCanvas.current.getContext('2d').drawImage(video, 0, 0, sw, sh)
        frozenCanvas.current.toBlob(b => {
          if (!b || ws.readyState !== WebSocket.OPEN) return
          b.arrayBuffer().then(buf => ws.send(buf))
        }, 'image/jpeg', 0.92)
      }, 33)
    }
    ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data)
        if (d.type === 'init') {
          streamJobIdRef.current = d.job_id
          setStreamJobId(d.job_id)
          addLog('Job: ' + d.job_id)
        }
      } catch {}
    }
    ws.onerror = () => addLog('WebSocket error')
    ws.onclose = () => {}
  }

  const stopStream = () => {
    if (sendLoop.current) { clearInterval(sendLoop.current); sendLoop.current = null }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    // Stop MediaRecorder → create local blob for synced playback
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop()
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(recordedChunks.current, { type: 'video/webm' })
        if (localBlobUrl.current) URL.revokeObjectURL(localBlobUrl.current)
        localBlobUrl.current = URL.createObjectURL(blob)
        if (playbackRef.current) {
          playbackRef.current.src = localBlobUrl.current
          playbackRef.current.pause()
        }
      }
    }
    if (camStream.current) { camStream.current.getTracks().forEach(t => t.stop()); camStream.current = null }
    setStreaming(false)
    setShowBanner(true)
    setTimeout(() => setShowBanner(false), 4000)

    const id = streamJobIdRef.current || streamJobId
    if (id) {
      addLog('Analysis started...')
      setLabel('Processing your video...')
      setProgress(10); setState('processing')
      setStreamJobId(null); streamJobIdRef.current = null; setJid(id)
      statusTimer.current = setInterval(() => pollStatus(id), 2000)
      startSSE(id)
    } else {
      addLog('No job ID — stream may not have connected')
      setState('idle')
    }
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
        setState('error'); setLabel('Error: ' + (d.detail || '?'))
      }
    } catch (e) { addLog('Poll error: ' + e.message) }
  }

  const startSSE = (jobId) => {
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
        setSseData(d)
        // Sync local recording to detection frame
        if (playbackRef.current && playbackRef.current.readyState >= 2 && d.t_sec != null) {
          playbackRef.current.currentTime = d.t_sec
        }
        setProgress(40 + Math.round((d.pct || 0) * .6))
        setLabel('Detecting... ' + (d.pct || 0) + '%')
      } catch {}
    }
    es.onerror = () => { if (sseRef.current) { sseRef.current.close(); sseRef.current = null } }
  }

  const showResults = async (jobId) => {
    const s = await (await fetch(API + '/results/' + jobId)).json()
    setSamples(s); addLog('Loaded ' + s.length + ' samples')
    try {
      const pr = await (await fetch(API + '/physics/' + jobId)).json()
      if (pr) setPhysics(pr)
    } catch {}
  }

  const progClass = state === 'streaming' ? 'uploading' : state === 'done' ? 'done' : state === 'error' ? 'error' : 'processing'

  return (
    <>
      {showBanner && (
        <div style={{
          position:'fixed', top:64, left:'50%', transform:'translateX(-50%)',
          zIndex:999, background:'var(--green)', color:'#000',
          padding:'.75rem 1.5rem', borderRadius:12, fontWeight:700, fontSize:'1rem',
          boxShadow:'0 4px 24px rgba(0,255,136,.5)',
          display:'flex', alignItems:'center', gap:'.6rem',
        }}>
          <span>▶</span> Analysis started — please wait...
        </div>
      )}

      <div className="card">
        <div className="card-title">Camera</div>
        <div style={{position:'relative',background:'#000',borderRadius:12,overflow:'hidden',marginBottom:'.75rem'}}>
          <video ref={camRef} autoPlay muted playsInline style={{width:'100%',display:'block',borderRadius:12}} />
          {streaming && <div className="rec-indicator"><span className="rec-dot" /> REC</div>}
        </div>

        <div style={{display:'flex',gap:'.75rem',flexWrap:'wrap',alignItems:'flex-end',marginBottom:'.75rem'}}>
          <div style={{flex:2}}>
            <label className="form-label">Camera</label>
            <select className="form-input" value={camId}
              onChange={e => { setCamId(e.target.value); startCamPreview(e.target.value) }}
              style={{padding:'.45rem .65rem',width:'100%'}}>
              {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>)}
            </select>
          </div>
          <div style={{flex:1,minWidth:130}}>
            <label className="form-label">Hand</label>
            <select className="form-input" value={hand} onChange={e=>setHand(e.target.value)}
              style={{padding:'.45rem .65rem',width:'100%'}}>
              <option value="" disabled hidden>— Select —</option>
              <option value="" disabled hidden>— Choose an option —</option>
              <option value="false">No Hand</option>
              <option value="true">Hand</option>
            </select>
          </div>
          <div style={{flex:1,minWidth:140}}>
            <label className="form-label">Direction</label>
            <select className="form-input" value={direction}
              onChange={e=>setDirection(e.target.value)}
              style={{padding:'.45rem .65rem',width:'100%'}}>
              <option value="" disabled hidden>— Choose an option —</option>
              <option value="cw">↻ CW (clockwise)</option>
              <option value="ccw">↺ CCW (counter-clockwise)</option>
              {(user.plan==='pro' || user.plan==='ultimate' || isMaster(user?.email)) && <option value="cw+ccw">↻ then ↺ (CW+CCW)</option>}
              {(user.plan==='pro' || user.plan==='ultimate' || isMaster(user?.email)) && <option value="ccw+cw">↺ then ↻ (CCW+CW)</option>}
            </select>
          </div>
          <div style={{flex:1,minWidth:140}}>
            <label className="form-label">Email</label>
            <input className="form-input" value={user?.email || ''} readOnly
              style={{padding:'.45rem .65rem',opacity:.6}} />
          </div>
        </div>

        <div style={{display:'flex',gap:'.5rem',marginTop:'.75rem',alignItems:'center',flexWrap:'wrap'}}>
          <button className="btn btn-primary" style={{width:'auto'}}
            onClick={startStream} disabled={streaming || !direction || !medium || (hand === '')}>Start Streaming</button>
          <button className="btn btn-danger" onClick={stopStream} disabled={!streaming}>Stop &amp; Process</button>
          {streaming && <RecTimer />}
          {!streaming && <span style={{fontSize:'.72rem',color:'var(--muted)'}}>Recommended: 2–4 min</span>}
        </div>
      </div>

      {state !== 'idle' && (
        <div className="card">
          <div className="card-title">Status</div>
          <div style={{fontSize:'.78rem',color:'var(--muted)',minHeight:'1.3em',marginBottom:'.25rem'}}>{label}</div>
          <div className="progress-wrap">
            <div className={`progress-fill ${progClass}`} style={{width: progress + '%'}} />
          </div>

          {(state === 'processing' || state === 'done') && (
            <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',marginTop:'.8rem'}}>
              <div style={{flex:'1.4',minWidth:280}}>
                {sseData?.t_sec != null && (
                  <div style={{
                    fontSize:'.85rem', color:'var(--text)', fontWeight:600,
                    textAlign:'center', marginBottom:'.3rem',
                    padding:'.25rem .5rem', background:'var(--bg2)',
                    borderRadius:6
                  }}>
                    ⏱ {sseData.t_sec.toFixed(2)}s
                    {totalSec > 0 && <span style={{color:'var(--muted)'}}> / {totalSec.toFixed(1)}s</span>}
                  </div>
                )}
                <div className="canvas-wrap">
                  <video ref={playbackRef} muted playsInline
                    style={{width:'100%',display:'block',borderRadius:12}} />
                  <OverlayCanvas data={replaying ? replayData : sseData} vidW={vidW} vidH={vidH} />
                </div>
                {/* Replay button */}
                {state === 'done' && samples.length > 0 && (
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
                  [sseData && sseData.t_sec > 0
                    ? (Math.abs(sseData.cumulative_deg) / sseData.t_sec).toFixed(2) + ' °/s'
                    : '—', 'Velocity (rot/t)', 'blue'],
                  [(sseData?.confidence_pct || 0) + '%', 'Significance', 'yellow'],
                ].map(([v, l, cls]) => (
                  <div key={l} className="live-box">
                    <div className={`live-val ${cls}`}>{v}</div>
                    <div className="live-label">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="log-box">{log || 'Waiting...'}</div>
        </div>
      )}

      {state === 'done' && jid && (
        <ResultsSection jobId={jid} samples={samples} physics={physics}
          isPaid={(user.plan==='pro' || user.plan==='ultimate' || isMaster(user?.email))} showTable={isMaster(user.email)}
          master={isMaster(user?.email)} onReplay={startReplay} onStopReplay={stopReplay} replaying={replaying} />
      )}
    </>
  )
}

export default function Stream() {
  const { user } = useAuth()
  if (!user) return null
  const [medium, setMedium] = useState('')
  const master = isMaster(user?.email)

  return (
    <DeviceGate>
    <div>
      <div className="page-header">
        <h1>Live Stream</h1>
        <p>Record from camera - processed automatically on stop</p>
      </div>

      {/* Medium selector */}
      <div style={{display:'flex',gap:'.5rem',marginBottom:'1rem',alignItems:'center'}}>
        <label className="form-label" style={{margin:0}}>Medium:</label>
        <select className="form-input" value={medium} onChange={e=>setMedium(e.target.value)}
          style={{padding:'.35rem .65rem',width:'auto'}}>
          <option value="" disabled hidden>— Select —</option>
          <option value="air">Air</option>
          {(user?.plan==='pro' || user?.plan==='ultimate' || isMaster(user?.email)) && <option value="water">Water</option>}
        </select>
      </div>

      <StreamCore user={user} medium={medium} />

      {/* TestPanel only for master */}
      {master && <TestPanel user={user} />}
    </div>
    </DeviceGate>
  )
}

function TestPanel({ user }) {
  const [file, setFile] = useState(null)
  const [direction, setDirection] = useState('cw')
  const [state, setState] = useState('idle')
  const [jobId, setJobId] = useState(null)
  const [log, setLog] = useState('')
  const [metrics, setMetrics] = useState({})
  const [samples, setSamples] = useState([])
  const [physics, setPhysics] = useState(null)
  const wsRef = useRef(null)
  const sendLoop = useRef(null)
  const vidEl = useRef(null)
  const videoRef = useRef(null)  // playback element
  const canvas2d = useRef(null)
  const statusTimer = useRef(null)
  const sseRef = useRef(null)
  const jobIdRef = useRef(null)
  const [localUrl, setLocalUrl] = useState(null)

  const addLog = m => setLog(l => l + m + '\n')

  const start = () => {
    if (!file) { addLog('Select a video file first'); return }
    // Create local blob URL for synced playback
    if (localUrl) URL.revokeObjectURL(localUrl)
    const url = URL.createObjectURL(file)
    setLocalUrl(url)
    if (videoRef.current) {
      videoRef.current.src = url
      videoRef.current.pause()
    }
    const vid = document.createElement('video')
    vid.src = URL.createObjectURL(file)
    vid.muted = true; vid.playsInline = true
    vidEl.current = vid
    vid.addEventListener('loadedmetadata', () => {
      addLog(`Video: ${vid.videoWidth}x${vid.videoHeight}  ${vid.duration.toFixed(1)}s`)
      const ws = new WebSocket(`${WSS}/stream?email=${encodeURIComponent(user?.email||'')}&direction=${direction}`)
      wsRef.current = ws
      ws.onopen = () => {
        addLog('Sending frames...')
        setState('streaming')
        canvas2d.current = document.createElement('canvas')
        sendLoop.current = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return
          if (!vid || vid.paused || vid.ended) return
          const vw = vid.videoWidth||640, vh = vid.videoHeight||480
          const scale = vw > 640 ? 640/vw : 1
          const sw = Math.round(vw*scale), sh = Math.round(vh*scale)
          canvas2d.current.width = sw; canvas2d.current.height = sh
          canvas2d.current.getContext('2d').drawImage(vid, 0, 0, sw, sh)
          canvas2d.current.toBlob(b => {
            if (!b || ws.readyState !== WebSocket.OPEN) return
            b.arrayBuffer().then(buf => ws.send(buf))
          }, 'image/jpeg', 0.85)
        }, 33)
        vid.play()
      }
      ws.onmessage = e => {
        try {
          const d = JSON.parse(e.data)
          if (d.type === 'init') { jobIdRef.current = d.job_id; setJobId(d.job_id); addLog('Job: ' + d.job_id) }
        } catch {}
      }
      ws.onerror = () => { addLog('WS error'); stop() }
      ws.onclose = () => {}
    })
  }

  const stop = () => {
    if (sendLoop.current) { clearInterval(sendLoop.current); sendLoop.current = null }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    if (vidEl.current) { vidEl.current.pause(); vidEl.current.src = '' }

    const id = jobIdRef.current || jobId
    if (id) {
      addLog('Processing...')
      setState('processing')
      statusTimer.current = setInterval(async () => {
        try {
          const d = await (await fetch(API + '/status/' + id)).json()
          if (d.status === 'done') {
            clearInterval(statusTimer.current)
            if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
            addLog('Done!'); setState('done')
            const s = await (await fetch(API + '/results/' + id)).json()
            setSamples(s)
            try {
              const pr = await (await fetch(API + '/physics/' + id)).json()
              if (pr) setPhysics(pr)
            } catch {}
          } else if (d.status === 'error') {
            clearInterval(statusTimer.current)
            addLog('Error: ' + (d.detail || '?')); setState('error')
          } else { addLog(d.status + '...') }
        } catch {}
      }, 2000)
      const es = new EventSource(API + '/frames/' + id)
      sseRef.current = es
      es.onmessage = e => {
        try {
          const d = JSON.parse(e.data)
          if (d.done) { es.close(); sseRef.current = null; return }
          if (d.t_sec !== undefined) {
            setMetrics(d)
            if (videoRef.current && videoRef.current.readyState >= 2) {
              videoRef.current.currentTime = d.t_sec
            }
          }
        } catch {}
      }
      es.onerror = () => { if (sseRef.current) { sseRef.current.close(); sseRef.current = null } }
    } else {
      addLog('No job ID'); setState('idle')
    }
  }

  const progClass = state === 'streaming' ? 'uploading' : state === 'done' ? 'done' : state === 'error' ? 'error' : 'processing'

  return (
    <div className="card" style={{marginTop:'1rem'}}>
      <div className="card-title">Test Panel (master only)</div>
      <div style={{display:'flex',gap:'.75rem',flexWrap:'wrap',alignItems:'flex-end',marginBottom:'.6rem'}}>
        <div style={{flex:2}}>
          <label className="form-label">Video file</label>
          <input type="file" accept="video/*" onChange={e => setFile(e.target.files[0])}
            style={{width:'100%',color:'var(--text)',fontSize:'.85rem'}} />
        </div>
        <div style={{flex:1,minWidth:120}}>
          <label className="form-label">Direction</label>
          <select className="form-input" value={direction} onChange={e=>setDirection(e.target.value)}
            style={{padding:'.45rem .65rem',width:'100%'}}>
            <option value="cw">↻ CW</option>
            <option value="ccw">↺ CCW</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" style={{width:'auto'}}
          onClick={start} disabled={state==='streaming'}>▶ Send</button>
        <button className="btn btn-danger btn-sm"
          onClick={stop} disabled={state!=='streaming'}>■ Stop</button>
      </div>

      {state !== 'idle' && (
        <div>
          <div style={{fontSize:'.78rem',color:'var(--muted)',marginBottom:'.25rem'}}>{state}</div>
          <div className="progress-wrap">
            <div className={`progress-fill ${progClass}`} style={{width:
              state==='streaming'?'50%': state==='processing'?'70%': state==='done'?'100%':'30%'}} />
          </div>

          <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',marginTop:'.8rem'}}>
            <div style={{flex:'1.4',minWidth:260,position:'relative'}}>
              {localUrl && (
                <video ref={videoRef} src={localUrl} muted playsInline
                  style={{width:'100%',display:'block',borderRadius:10}} />
              )}
              <OverlayCanvas data={metrics.t_sec != null ? metrics : null}
                vidW={metrics.vid_w||640} vidH={metrics.vid_h||480} />
            </div>
            <div style={{flex:1,minWidth:180}} className="live-grid">
              {[
                [metrics.rotation_deg != null ? metrics.rotation_deg.toFixed(1)+'°' : '-', 'Spoke pos', ''],
                [metrics.cumulative_deg != null ? ((metrics.cumulative_deg>=0?'+':'')+metrics.cumulative_deg.toFixed(1)+'°') : '-', 'Rot: chosen', 'amber'],
                [metrics.t_sec != null && metrics.t_sec > 0 ? (Math.abs(metrics.cumulative_deg||0)/metrics.t_sec).toFixed(2)+' °/s' : '-', 'Velocity', 'blue'],
                [(metrics.confidence_pct||0)+'%', 'Significance', 'yellow'],
              ].map(([v,l,cls]) => (
                <div key={l} className="live-box">
                  <div className={`live-val ${cls}`} style={{fontSize:'1.1rem'}}>{v}</div>
                  <div className="live-label">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {state === 'done' && jobId && (
        <ResultsSection jobId={jobId} samples={samples} physics={physics} isPaid={true} showTable={true} master={isMaster(user?.email)} />
      )}

      <div className="log-box" style={{height:80}}>{log || '—'}</div>
    </div>
  )
}