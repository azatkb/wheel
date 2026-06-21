import { useRef, useEffect } from 'react'

/**
 * Colored bar chart comparing:
 * - last 2 user measurements (blue shades)
 * - user average (green)
 * - group average (amber) — paid only
 */
export default function BarChart({ barData, isPaid }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current || !barData) return
    const { last2 = [], user_avg = {}, group_avg = {} } = barData

    const canvas = ref.current
    canvas.width  = canvas.offsetWidth || 600
    canvas.height = 260
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.fillStyle = '#080b0f'; ctx.fillRect(0, 0, W, H)

    const METRICS = [
      { key: 'cumulative_deg', label: 'Rotation (°)', unit: '°' },
      { key: 'w_total_air',    label: 'Work (J)',      unit: 'J' },
      { key: 'f_max_air',      label: 'Force (N)',     unit: 'N' },
      { key: 'omega_max',      label: 'ω max (r/s)',   unit: '' },
    ]

    const nMetrics = METRICS.length
    const pad = { l: 48, r: 12, t: 24, b: 40 }
    const groupW = (W - pad.l - pad.r) / nMetrics
    const barCount = 2 + 1 + (isPaid ? 1 : 0) // last2 + user_avg + group_avg
    const barW = Math.max(4, (groupW * 0.75) / barCount)
    const gap  = (groupW - barW * barCount) / (barCount + 1)

    const COLORS = {
      last1:     '#2563eb',  // latest — bright blue
      last2:     '#93c5fd',  // previous — light blue
      user_avg:  '#00ff88',  // user avg — green
      group_avg: '#ff8800',  // group avg — amber
    }
    const LABELS = { last1: 'Latest', last2: 'Previous', user_avg: 'Your avg', group_avg: 'Group avg' }

    // Find max value per metric for scaling
    METRICS.forEach((m, mi) => {
      const vals = [
        last2[0]?.[m.key] || 0,
        last2[1]?.[m.key] || 0,
        user_avg[m.key]  || 0,
        isPaid ? (group_avg[m.key] || 0) : 0,
      ].map(Math.abs)
      const maxVal = Math.max(...vals, 1e-10)
      const cH = H - pad.t - pad.b
      const x0  = pad.l + mi * groupW

      // Grid line + metric label
      ctx.fillStyle = '#334155'; ctx.font = '11px DM Mono'
      ctx.fillText(m.label, x0 + 2, pad.t - 6)
      ctx.strokeStyle = '#1e2a38'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x0, pad.t); ctx.lineTo(x0, H - pad.b); ctx.stroke()

      const bars = [
        { key: 'last1',     val: Math.abs(last2[0]?.[m.key] || 0) },
        { key: 'last2',     val: Math.abs(last2[1]?.[m.key] || 0) },
        { key: 'user_avg',  val: Math.abs(user_avg[m.key]   || 0) },
        ...(isPaid ? [{ key: 'group_avg', val: Math.abs(group_avg[m.key] || 0) }] : []),
      ]

      bars.forEach((b, bi) => {
        const bx = x0 + gap + bi * (barW + gap / barCount)
        const bh = Math.max(2, (b.val / maxVal) * cH)
        const by = H - pad.b - bh

        // Bar fill
        ctx.fillStyle = COLORS[b.key]
        ctx.fillRect(bx, by, barW, bh)

        // Value label above bar — light text with dark halo (readable on any bar)
        const label = fmtVal(b.val, m.unit)
        ctx.font = 'bold 14px system-ui,sans-serif'
        ctx.textAlign = 'center'
        const ly = Math.max(by - 6, pad.t + 14)
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(0,0,0,.9)'
        ctx.strokeText(label, bx + barW/2, ly)
        ctx.fillStyle = '#eaf1f8'
        ctx.fillText(label, bx + barW/2, ly)
        ctx.textAlign = 'left' 
      })
    })

    // X axis
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke()

    // Legend
    const legendItems = [
      { key: 'last1', label: 'Latest' },
      { key: 'last2', label: 'Previous' },
      { key: 'user_avg', label: 'Your avg' },
      ...(isPaid ? [{ key: 'group_avg', label: 'Group avg' }] : []),
    ]
    let lx = pad.l
    legendItems.forEach(item => {
      ctx.fillStyle = COLORS[item.key]
      ctx.fillRect(lx, H - 18, 10, 10)
      ctx.fillStyle = '#8a9bb0'; ctx.font = '11px system-ui,sans-serif'
      ctx.fillText(item.label, lx + 13, H - 9)
      lx += 70
    })
  }, [barData, isPaid])

  return (
    <div>
      <div style={{fontSize:'.72rem',color:'var(--muted)',marginBottom:'.4rem',display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>
        <span style={{color:'rgba(0,255,136,.7)'}}>■ Latest</span>
        <span style={{color:'rgba(0,255,136,.35)'}}>■ Previous</span>
        <span style={{color:'var(--green)'}}>■ Your avg</span>
        <span style={{color:'var(--amber)'}}>■ Group avg</span>
      </div>
      <canvas ref={ref} style={{width:'100%',height:260,display:'block',borderRadius:10,background:'#080b0f'}} />
    </div>
  )
}

function fmtVal(v, unit) {
  if (v === 0) return '0'
  const SI = [[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n']]
  for (const [f, p] of SI) if (Math.abs(v) >= f) return (v/f).toFixed(2) + p + unit
  return v.toExponential(1) + unit
}