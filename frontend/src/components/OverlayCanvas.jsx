import { useRef, useEffect } from 'react'

export default function OverlayCanvas({ data, vidW, vidH }) {
  const ref = useRef(null)
  // UI-only accumulator: total absolute rotation = sum of |Δcumulative| over frames.
  // Counts every move of the orange marker, both CW and CCW add up. Backend untouched.
  const acc = useRef({ prevCum: null, prevT: -1, total: 0 })

  useEffect(() => {
    if (!ref.current || !data) return
    // ── total-rotation accumulation (UI only) ──────────────────────────────
    {
      const a = acc.current
      const t = (data.t_sec != null) ? data.t_sec : null
      // new track / replay restart → reset
      if (t != null && (t === 0 || t < a.prevT)) { a.total = 0; a.prevCum = null }
      const cum = data.cumulative_deg
      if (cum != null) {
        if (a.prevCum != null) a.total += Math.abs(cum - a.prevCum)
        a.prevCum = cum
      }
      if (t != null) a.prevT = t
    }
    const cvs = ref.current
    const wrap = cvs.parentElement
    const dw = wrap.clientWidth || 480
    const dh = vidH > 0 ? Math.round(dw * vidH / vidW) : Math.round(dw * 9/16)
    if (cvs.width !== dw || cvs.height !== dh) { cvs.width = dw; cvs.height = dh }
    const ctx = cvs.getContext('2d')
    ctx.clearRect(0, 0, dw, dh)
    if (!vidW || !vidH) return
    const sx = dw / vidW, sy = dh / vidH

    if (data.no_ground) {
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, dw, dh)
      ctx.fillStyle = '#00dcdc'; ctx.font = 'bold 14px Syne'; ctx.textAlign = 'center'
      ctx.fillText('Place wheel in frame, camera above', dw/2, dh/2)
      ctx.textAlign = 'left'; return
    }

    const hub = data.hub_px || data.hub
    if (hub) {
      const hx = hub[0]*sx, hy = hub[1]*sy
      ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI*2)
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill()
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke()
      if (data.orange) {
        const ox = data.orange[0]*sx, oy = data.orange[1]*sy
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ox, oy)
        ctx.strokeStyle = 'rgba(0,255,136,.7)'; ctx.lineWidth = 2
        ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([])
      }
    }

    if (data.orange) {
      const ox = data.orange[0]*sx, oy = data.orange[1]*sy, r = 10
      ctx.beginPath(); ctx.arc(ox, oy, r+2, 0, Math.PI*2)
      ctx.fillStyle = 'rgba(0,40,100,.7)'; ctx.fill()
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI*2)
      ctx.fillStyle = '#ff6600'; ctx.fill()
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI*2)
      ctx.strokeStyle = '#ff3300'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.font = '11px Space Mono'; ctx.fillStyle = '#ff6600'
      ctx.fillText('ORA', ox+r+4, oy+4)
    }

    if (data.no_orange) {
      const hcx=dw/2, hcy=dh*.85, fs=Math.max(13,dw/36)
      ctx.font=`bold ${fs}px Syne`
      const tw=ctx.measureText('Orange marker not found').width
      ctx.fillStyle='rgba(0,0,0,.65)'
      ctx.beginPath(); ctx.roundRect(hcx-tw/2-16,hcy-fs*1.1,tw+32,fs*2.2,7); ctx.fill()
      ctx.fillStyle='#ffcc00'; ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText('Orange marker not found', hcx, hcy)
      ctx.textAlign='left'; ctx.textBaseline='alphabetic'
    }

    if (data.rotation_deg != null) {
      const ang = data.rotation_deg.toFixed(1)+'°'                  // current position 0-360
      const tot = acc.current.total                                 // total path (UI accumulator)
      const cum = '+'+tot.toFixed(1)+'°'                            // always grows, both directions add
      const L1 = 'CUR', L2 = 'TOT'
      ctx.font = 'bold 15px Space Mono'
      const valW = Math.max(ctx.measureText(ang).width, ctx.measureText(cum).width)
      ctx.font = '10px Space Mono'
      const labW = Math.max(ctx.measureText(L1).width, ctx.measureText(L2).width)
      const valX = 13 + labW + 8
      const bw = labW + 8 + valW + 18
      ctx.fillStyle = 'rgba(0,0,0,.65)'
      ctx.beginPath(); ctx.roundRect(6,6,bw,52,6); ctx.fill()
      // labels (dim)
      ctx.font = '10px Space Mono'; ctx.fillStyle = '#9aa7b5'
      ctx.fillText(L1, 13, 25); ctx.fillText(L2, 13, 47)
      // values
      ctx.font = 'bold 15px Space Mono'
      ctx.fillStyle = '#ffcc00'; ctx.fillText(ang, valX, 26)
      ctx.fillStyle = '#00ff88'; ctx.fillText(cum, valX, 48)
    }

    // Watermark - center
    const wmText = 'lajtnerresonance.com'
    let wmSize = Math.max(16, Math.round(dw / 14))
    ctx.save()
    ctx.font = `bold ${wmSize}px monospace`
    // shrink font so the (longer) domain fits within 90% of the width
    const wmMaxW = dw * 0.9
    const wmW = ctx.measureText(wmText).width
    if (wmW > wmMaxW) {
      wmSize = Math.max(10, Math.floor(wmSize * wmMaxW / wmW))
      ctx.font = `bold ${wmSize}px monospace`
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillText(wmText, dw/2 + 2, dh/2 + 2)
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillText(wmText, dw/2, dh/2)
    ctx.restore()

    const conf = data.confidence_pct || 0
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, dh-5, dw, 5)
    ctx.fillStyle = conf>=80 ? '#00ff88' : conf>=50 ? '#ffcc00' : '#f44'
    ctx.fillRect(0, dh-5, Math.round(dw*conf/100), 5)
  }, [data, vidW, vidH])

  return <canvas ref={ref} />
}