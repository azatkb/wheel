export function drawChart(canvas, samples) {
  if (!canvas) return
  canvas.width = canvas.offsetWidth || 800
  canvas.height = 200
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height
  ctx.fillStyle = '#080b0f'; ctx.fillRect(0, 0, W, H)

  if (samples.length < 10) {
    drawWave(ctx, W, H); return
  }

  const pad = { l: 48, r: 12, t: 14, b: 24 }
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
  const ts = samples.map(s => +s.timestamp_sec)
  const cs = samples.map(s => +s.cumulative_deg)
  const qs = samples.map(s => +s.confidence_pct)
  const tMin = Math.min(...ts), tMax = Math.max(...ts) || 1
  const vMin = Math.min(...cs, 0), vMax = Math.max(...cs, 1), vR = vMax - vMin || 1
  const tx = t => pad.l + (t - tMin) / (tMax - tMin) * cW
  const ty = v => pad.t + (1 - (v - vMin) / vR) * cH

  ctx.strokeStyle = '#2a3a4a'; ctx.lineWidth = 1
  ;[0, .25, .5, .75, 1].forEach(f => {
    const y = pad.t + f * cH, v = vMax - f * vR
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke()
    ctx.fillStyle = '#7a8fa8'; ctx.font = '9px Space Mono'
    ctx.fillText(v.toFixed(0) + '°', 2, y + 3)
  })

  const zy = pad.t + (1 - (0 - vMin) / vR) * cH
  // CCW zone (positive) — green tint above zero
  if (vMax > 0) {
    ctx.fillStyle = 'rgba(0,255,136,.06)'
    ctx.fillRect(pad.l, pad.t, cW, Math.max(0, zy - pad.t))
    ctx.fillStyle = 'rgba(0,255,136,.45)'; ctx.font = 'bold 9px DM Mono'
    ctx.fillText('+CCW', pad.l + 4, pad.t + 12)
  }
  // CW zone (negative) — blue tint below zero
  if (vMin < 0) {
    ctx.fillStyle = 'rgba(68,170,255,.07)'
    ctx.fillRect(pad.l, zy, cW, Math.max(0, H - pad.b - zy))
    ctx.fillStyle = 'rgba(68,170,255,.45)'; ctx.font = 'bold 9px DM Mono'
    ctx.fillText('CW --', pad.l + 4, H - pad.b - 5)
  }
  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath(); ctx.moveTo(pad.l, zy); ctx.lineTo(W - pad.r, zy); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#64748b'; ctx.font = '9px DM Mono'
  ctx.fillText('0°', 2, zy - 2)

  ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2; ctx.beginPath()
  samples.forEach((s, i) => i === 0 ? ctx.moveTo(tx(ts[i]), ty(cs[i])) : ctx.lineTo(tx(ts[i]), ty(cs[i])))
  ctx.stroke()

  samples.forEach((s, i) => {
    ctx.fillStyle = qs[i] === 100 ? '#00ff88' : qs[i] >= 70 ? '#ff0' : '#f44'
    ctx.beginPath(); ctx.arc(tx(ts[i]), ty(cs[i]), 2.2, 0, Math.PI * 2); ctx.fill()
  })

  ctx.fillStyle = '#00ff88'; ctx.font = '10px Space Mono'
  ctx.fillText('cumulative rotation (deg)', pad.l + 4, pad.t + 12)
}

function drawWave(ctx, W, H) {
  const cx = W / 2, cy = H / 2, amp = H * 0.28, freq = 2.5
  ctx.beginPath(); ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2
  for (let x = 0; x < W; x++) {
    const y = cy + amp * Math.sin((x / W) * Math.PI * 2 * freq)
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.beginPath(); ctx.strokeStyle = 'rgba(0,255,136,.15)'; ctx.lineWidth = 1
  for (let x = 0; x < W; x++) {
    const y = cy + amp * 0.5 * Math.sin((x / W) * Math.PI * 2 * freq * 1.5 + 1)
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.fillStyle = '#7a8fa8'; ctx.font = '13px Syne'; ctx.textAlign = 'center'
  ctx.fillText('Not enough data to display chart', cx, cy + amp + 24)
  ctx.textAlign = 'left'
}

const _SI = [[1e12,'T'],[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p'],[1e-15,'f'],[1e-18,'a']]
export function fSI(v, u, d = 3) {
  if (v === 0 || v == null) return '0'
  const a = Math.abs(v)
  for (const [f, p] of _SI) if (a >= f) return (v / f).toFixed(d) + ' ' + p + u
  return v.toExponential(2) + ' ' + u
}

export function drawDualChart(canvas, samples) {
  if (!canvas) return
  canvas.width  = canvas.offsetWidth || 800
  canvas.height = 340
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height
  ctx.fillStyle = '#080b0f'; ctx.fillRect(0, 0, W, H)

  if (samples.length < 3) { drawWave(ctx, W, H); return }

  const pad  = { l:48, r:12, t:14, b:24 }
  const half = (H - 8) / 2
  const gap  = 8

  const ts  = samples.map(s => +s.timestamp_sec)
  const cum = samples.map(s => +s.cumulative_deg)   // cumulative (signed total)
  const vel = samples.map(s => +s.angular_vel_dps)  // velocity °/s (shows direction jumps)
  const qs  = samples.map(s => +s.confidence_pct)
  const tMin = Math.min(...ts), tMax = Math.max(...ts) || 1
  const tx = t => pad.l + (t - tMin) / (tMax - tMin) * (W - pad.l - pad.r)

  // ── Top chart: Real-time angle ──────────────────────────────────────────
  const drawSubChart = (vals, yOff, h, color, label, showZero=true) => {
    const vMin = Math.min(...vals, 0), vMax = Math.max(...vals, 0.1)
    const vR   = vMax - vMin || 1
    const ty   = v => yOff + (1 - (v - vMin) / vR) * h

    // Grid lines
    ctx.strokeStyle = '#2a3a4a'; ctx.lineWidth = 1
    ;[0, .5, 1].forEach(f => {
      const y = yOff + f * h, v = vMax - f * vR
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke()
      ctx.fillStyle = '#7a8fa8'; ctx.font = '9px DM Mono'
      ctx.fillText(v.toFixed(1) + '°', 2, y + 3)
    })

    // CCW/CW zones
    const zy = ty(0)
    if (vMax > 0 && zy > yOff) {
      ctx.fillStyle = 'rgba(0,255,136,.06)'
      ctx.fillRect(pad.l, yOff, W-pad.l-pad.r, zy - yOff)
      // CCW label
      ctx.fillStyle = 'rgba(0,255,136,0.35)'
      ctx.font = 'bold 11px system-ui,sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText('+CCW', W - pad.r - 4, yOff + 16)
      ctx.textAlign = 'left'
    }
    if (vMin < 0 && zy < yOff + h) {
      ctx.fillStyle = 'rgba(68,170,255,.07)'
      ctx.fillRect(pad.l, zy, W-pad.l-pad.r, yOff + h - zy)
      // CW label
      ctx.fillStyle = 'rgba(68,170,255,0.35)'
      ctx.font = 'bold 11px system-ui,sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText('CW --', W - pad.r - 4, yOff + h - 6)
      ctx.textAlign = 'left'
    }

    // Zero line
    if (showZero) {
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1
      ctx.setLineDash([4,4])
      ctx.beginPath(); ctx.moveTo(pad.l, zy); ctx.lineTo(W-pad.r, zy); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#64748b'; ctx.font = '9px DM Mono'
      ctx.fillText('0°', 2, zy - 2)
    }

    // Label
    ctx.fillStyle = color; ctx.font = 'bold 9px DM Mono'
    ctx.fillText(label, pad.l + 4, yOff + 12)

    // Line
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath()
    samples.forEach((s, i) => {
      i === 0 ? ctx.moveTo(tx(ts[i]), ty(vals[i])) : ctx.lineTo(tx(ts[i]), ty(vals[i]))
    })
    ctx.stroke()

    // Dots
    samples.forEach((s, i) => {
      const q = qs[i]
      ctx.fillStyle = q === 100 ? color : q >= 70 ? '#ff0' : '#f44'
      ctx.beginPath(); ctx.arc(tx(ts[i]), ty(vals[i]), 2, 0, Math.PI*2); ctx.fill()
    })
  }

  // Top: Direction-filtered velocity
  // Shows speed only when rotating in the dominant direction — 0 otherwise
  const posCnt = vel.filter(v => v > 0).length
  const negCnt = vel.filter(v => v < 0).length
  const dominant = posCnt >= negCnt ? 'ccw' : 'cw'
  const dirFiltered = vel.map(v =>
    dominant === 'ccw' ? (v > 0 ? v : 0) : (v < 0 ? v : 0)
  )
  drawSubChart(dirFiltered, pad.t, half - pad.t - gap/2, '#00ff88',
    (dominant === 'ccw' ? '+CCW speed (°/s)' : '--CW speed (°/s)') +
    '  —  drops to 0 when moving opposite direction or stopped')

  // Divider
  ctx.strokeStyle = '#2a3a4a'; ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, pad.t + half + gap/2)
  ctx.lineTo(W, pad.t + half + gap/2)
  ctx.stroke()
  ctx.fillStyle = '#7a8fa8'; ctx.font = '8px DM Mono'
  ctx.fillText('VELOCITY', pad.l + 4, pad.t + half + gap/2 - 2)

  // Bottom: Angular velocity
  drawSubChart(vel, pad.t + half + gap, half - gap - pad.b, '#44aaff',
    'Angular velocity (°/s)  —  +CCW / --CW  —  shows direction & speed')
  // Avg velocity line
  const avgVel = vel.length > 0 ? vel.reduce((s,v)=>s+Math.abs(v),0)/vel.length : 0
  if (avgVel > 0) {
    const bY = pad.t + half + gap
    const bH = half - gap - pad.b
    const vMax2 = Math.max(...vel.map(Math.abs), 0.001)
    const avgY = bY + bH * (1 - avgVel / vMax2)
    ctx.strokeStyle = 'rgba(255,136,0,.6)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6,4])
    ctx.beginPath(); ctx.moveTo(pad.l, avgY); ctx.lineTo(W-pad.r, avgY); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,136,0,.8)'
    ctx.font = '9px DM Mono,monospace'
    ctx.fillText(`avg: ${avgVel.toFixed(1)}°/s`, W - pad.r - 80, avgY - 4)
  }
  // X axis time labels
  ctx.fillStyle = '#7a8fa8'; ctx.font = '9px DM Mono'
  ;[0, .25, .5, .75, 1].forEach(f => {
    const t = tMin + f * (tMax - tMin)
    ctx.fillText(t.toFixed(1)+'s', pad.l + f*(W-pad.l-pad.r) - 10, H - 4)
  })
}