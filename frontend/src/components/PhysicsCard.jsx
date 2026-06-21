import { useState } from 'react'
import { fSI } from '../hooks/useChart'

// SI prefix formatters
const fmtOmega = (v) => {
  if (!v) return '0 rad/s'
  const dps = (v * 180 / Math.PI)
  if (dps >= 1) return dps.toFixed(2) + ' °/s'
  return v.toFixed(4) + ' rad/s'
}
const fmtPower = (v) => {
  if (v == null || v === 0) return '0 W'
  const a = Math.abs(v)
  if (a >= 1)     return v.toFixed(4) + ' W'
  if (a >= 1e-3)  return (v*1e3).toFixed(4) + ' mW'
  if (a >= 1e-6)  return (v*1e6).toFixed(4) + ' µW'
  if (a >= 1e-9)  return (v*1e9).toFixed(4) + ' nW'
  if (a >= 1e-12) return (v*1e12).toFixed(4) + ' pW'
  const e = Math.floor(Math.log10(a))
  return (v/Math.pow(10,e)).toFixed(3) + 'e' + e + ' W'
}

// SI prefix formatter for Force
const fmtForce = (v) => {
  if (v == null || v === 0) return '0 N'
  const a = Math.abs(v)
  if (a >= 1)        return v.toFixed(4) + ' N'
  if (a >= 1e-3)     return (v * 1e3).toFixed(4) + ' mN'
  if (a >= 1e-6)     return (v * 1e6).toFixed(4) + ' µN'
  if (a >= 1e-9)     return (v * 1e9).toFixed(4) + ' nN'
  if (a >= 1e-12)    return (v * 1e12).toFixed(4) + ' pN'
  const exp = Math.floor(Math.log10(a))
  return (v / Math.pow(10, exp)).toFixed(3) + 'e' + exp + ' N'
}

const _SI = [[1e12,'T'],[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p'],[1e-15,'f']]
const fmtSI = (v, u='') => {
  if (!v && v !== 0) return '—'
  const a = Math.abs(v)
  for (const [f,p] of _SI) if (a >= f*0.999) return (v/f).toFixed(3)+' '+p+u
  return v.toExponential(2)+' '+u
}

// Lajtner Resonance formatter: 3.56e+14 → 3.56L14R
const fmtLR = (v) => {
  if (!v) return '0 LR'
  const s = (+v).toExponential(2)  // e.g. "3.56e+24"
  const [mantissa, exp] = s.split('e')
  const expNum = exp.replace('+','').replace('-0','-')
  return `${mantissa}L${expNum}R`
}

// SVG Star component
const Star = ({ filled, color = '#FFD700', size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display:'inline-block'}}>
    <polygon
      points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Yellow stars = own personal best comparison
// Red stars = comparison vs group
// Star mapping (same for yellow & red):
//   0 stars = zero / no result
//   3 stars = about the average
//   5 stars = above the average
const starsFromPct = (pct) => {
  if (pct == null) return 0
  if (pct <= -100) return 0          // zero result
  if (pct < -5) {                    // below average → 1-2 stars
    // linear: -100% → 0 stars, -5% → ~3 stars
    return Math.max(1, Math.round(3 + 3 * (pct / 100)))
  }
  if (pct <= 5) return 3             // about average
  // above average → 4-5 stars, +30% or more = 5 stars
  return Math.min(5, Math.round(3 + 2 * (pct / 30)))
}

const StarRatingDouble = ({ pctVsPersonal, pctVsGroup }) => {
  const yellowStars = starsFromPct(pctVsPersonal)  // vs user's own average
  const redStars    = starsFromPct(pctVsGroup)     // vs all users' average

  if (pctVsPersonal == null && pctVsGroup == null) return null

  return (
    <div style={{margin:'.5rem 0'}}>
      {/* Yellow stars - personal */}
      {pctVsPersonal != null && (
        <div style={{display:'flex',alignItems:'center',gap:'.3rem',marginBottom:'.2rem'}}>
          <div style={{display:'flex',gap:1}}>
            {[1,2,3,4,5].map(i => (
              <Star key={i} filled={i <= yellowStars} color="#FFD700" size={20} />
            ))}
          </div>
          <span style={{fontSize:'.72rem',color:'#FFD700',fontWeight:500}}>
            vs your avg {pctVsPersonal > 0 ? `+${pctVsPersonal}%` : `${pctVsPersonal}%`}
          </span>
        </div>
      )}
      {/* Red stars - group */}
      {pctVsGroup != null && (
        <div style={{display:'flex',alignItems:'center',gap:'.3rem'}}>
          <div style={{display:'flex',gap:1}}>
            {[1,2,3,4,5].map(i => (
              <Star key={i} filled={i <= redStars} color="#ff4444" size={20} />
            ))}
          </div>
          <span style={{fontSize:'.72rem',color:'#ff4444',fontWeight:500}}>
            vs group {pctVsGroup > 0 ? `+${pctVsGroup}%` : `${pctVsGroup}%`}
          </span>
        </div>
      )}
    </div>
  )
}

// Star rating based on group comparison
const StarRating = ({ pctVsGroup }) => {
  if (pctVsGroup == null) return null
  // pctVsGroup: positive = better than group avg, negative = worse
  let stars, label
  if (pctVsGroup >= 0)        { stars = 5; label = 'Above group average' }
  else if (pctVsGroup >= -10) { stars = 4; label = 'Near group average' }
  else if (pctVsGroup >= -30) { stars = 3; label = 'Below group average' }
  else if (pctVsGroup >= -60) { stars = 2; label = 'Keep training!' }
  else if (pctVsGroup >= -80) { stars = 1; label = 'Early stage' }
  else                        { stars = 0; label = 'Train more!' }

  return (
    <div style={{display:'flex',alignItems:'center',gap:'.5rem',margin:'.3rem 0'}}>
      <span style={{fontSize:'1.3rem',letterSpacing:'2px'}}>
        {Array.from({length:5}, (_,i) => (
          <span key={i} style={{
            color: '#FFD700',
            opacity: i < stars ? 1 : 0.15,
          }}>★</span>
        ))}
      </span>
      <span style={{fontSize:'.75rem',color:'var(--muted)'}}>{label}</span>
    </div>
  )
}

// Scientific notation for physics table: 3.4e-8
const sciNote = (v) => {
  if (v == null) return '—'
  if (v === 0) return '0'
  const a = Math.abs(v)
  const exp = Math.floor(Math.log10(a))
  const m = (v / Math.pow(10, exp)).toFixed(3).replace(/\.?0+$/, '')
  return `${m}e${exp > 0 ? '+' : ''}${exp}`
}
import { API } from '../config'

const VAR_NAMES = {
  'J': 'Inertia_total',
}

const VARS = [
  ['t_total','s'],['phi_total','rad'],['omega_max','rad/s'],['J','kgm2'],
  ['M_res','Nm'],['M_motor_accel','Nm'],['M_motor_const','Nm'],['M_avg_active','Nm'],
  ['F_const','N'],['F_accel','N'],['F_avg_active','N'],['F_max','N'],
  ['E_kin_max','J'],['E_kin_const','J'],['E_kin_avg_active','J'],
  ['P_peak','W'],['P_const','W'],['P_avg','W'],['W_total','J'],['L_ang','kgm2/s'],
]

const LABELS = {
  rotation_deg: ['Rotation', ''],
  force_N:      ['Force', 'amber'],
  power_W:      ['Power', 'blue'],
  work_J:       ['Energy (E)', 'yellow'],
  planck_freq_Hz: ['Planck Hz', 'red'],
}

export default function PhysicsCard({ msg, result, jobId, isPaid, showTable = true, master = false, medium }) {
  const [showPhysTable, setShowPhysTable] = useState(false)
  if (!msg && !result) return null

  return (
    <div className="phys-card">
      <div className="card-title">Physics Result</div>
      {msg?.warning && (
        <div style={{background:'rgba(255,68,68,.1)',border:'1px solid rgba(255,68,68,.3)',
          borderRadius:8,padding:'.5rem .8rem',color:'#f44',fontSize:'.8rem',marginBottom:'.75rem'}}>
          {msg.warning}
        </div>
      )}

      {/* Display values — free: rotation+time+velocity / pro: +power+work */}
      <div className="phys-display">
        {/* Rotation in degrees — always (phi_deg, else computed from phi_total) */}
        {(() => {
          const c = result?.ideal || result?.air || result?.water || {}
          const deg = (msg?.display?.phi_deg != null)
            ? +msg.display.phi_deg
            : (c.phi_total != null ? Math.abs(c.phi_total * 180 / Math.PI) : null)
          return deg != null ? (
            <div className="phys-val-box">
              <div className="pv">{deg.toFixed(2)}°</div>
              <div className="pl">Rotation</div>
            </div>
          ) : null
        })()}
        {/* Time — always (use any available case) */}
        {(() => {
          const c = result?.ideal || result?.air || result?.water || {}
          return c.t_total != null ? (
            <div className="phys-val-box">
              <div className="pv">{(+c.t_total).toFixed(1)}s</div>
              <div className="pl">Time</div>
            </div>
          ) : null
        })()}
        {/* Velocity = rotation/time — always */}
        {(() => {
          const c = result?.ideal || result?.air || result?.water || {}
          return (c.phi_total != null && c.t_total > 0) ? (
            <div className="phys-val-box blue">
              <div className="pv">
                {(Math.abs(c.phi_total * 180 / Math.PI) / c.t_total).toFixed(3)} °/s
              </div>
              <div className="pl">Avg Velocity</div>
            </div>
          ) : null
        })()}
        {/* PRO only: Power (use any available case) */}
        {isPaid && (() => {
          const c = result?.air || result?.ideal || result?.water || {}
          return c.P_peak != null ? (
            <div className="phys-val-box" style={{borderColor:'rgba(0,255,136,.3)'}}>
              <div className="pv" style={{color:'var(--green)'}}>{fmtPower(c.P_peak)}</div>
              <div className="pl">Power (peak)</div>
            </div>
          ) : null
        })()}
        {isPaid && msg?.display?.energy_J != null && (
          <div className="phys-val-box">
            <div className="pv">{fmtSI(parseFloat(msg.display.energy_J), 'J')}</div>
            <div className="pl">Work</div>
          </div>
        )}
        {isPaid && msg?.display?.energy_J != null && (() => {
          const eV = parseFloat(msg.display.energy_J) / 1.602176634e-19
          if (!isFinite(eV) || eV <= 0) return null
          const exp = Math.floor(Math.log10(eV))
          const mant = (eV / Math.pow(10, exp)).toFixed(3)
          return (
            <div className="phys-val-box" style={{minWidth:200}}>
              <div className="pv">{mant} × 10<sup>{exp}</sup> eV</div>
              <div className="pl">Work (eV)</div>
            </div>
          )
        })()}
      </div>

      {isPaid && msg?.display?.energy_J != null && (() => {
        const eV = parseFloat(msg.display.energy_J) / 1.602176634e-19
        if (!isFinite(eV) || eV <= 0) return null
        const exp = Math.floor(Math.log10(eV))
        const mant = (eV / Math.pow(10, exp)).toFixed(3)
        return (
          <div style={{fontSize:'.78rem',color:'var(--muted)',margin:'.5rem 0 0',lineHeight:1.55}}>
            Work in eV = Work(J) ÷ 1.602×10<sup>-19</sup> = {mant} × 10<sup>{exp}</sup> eV.<br/>
            For scale: dropping a single tiny grain of sand from ~1 m (≈39 in) reaches energy on the order of 10<sup>10</sup> eV.
          </div>
        )
      })()}


      {/* Lajtner Resonance prominent banner - always shown */}
      {msg?.display?.planck_freq_Hz != null && (
        <div style={{
          background:'rgba(255,136,0,.1)',
          border:'2px solid rgba(255,136,0,.4)',
          borderRadius:10, padding:'.75rem 1rem',
          marginBottom:'.75rem', textAlign:'center'
        }}>
          <div style={{fontSize:'.75rem',color:'var(--muted)',marginBottom:'.2rem'}}>
            Lajtner Resonance (based on Planck constant)
          </div>
          <div style={{fontSize:'1.6rem',fontWeight:800,color:'var(--amber)',letterSpacing:'.02em'}}>
            {fmtLR(msg.display.planck_freq_raw || msg.display.planck_freq_Hz)}
          </div>
          <div style={{fontSize:'.7rem',color:'var(--dim)',marginTop:'.2rem'}}>
            f = E/h &nbsp;·&nbsp; h = 6.63×10⁻³⁴ J·s
          </div>
        </div>
      )}

      {/* Planck explanation */}
      {msg?.display?.planck_freq_Hz != null && (
        <div style={{fontSize:'.82rem',color:'var(--muted)',padding:'.5rem .75rem',
          background:'rgba(255,136,0,.05)',border:'1px solid rgba(255,136,0,.15)',
          borderRadius:6,marginBottom:'.5rem',lineHeight:1.7}}>
          <strong style={{color:'var(--amber)'}}>Lajtner Resonance</strong> (based on Planck constant): f = E/h<br/>
          Your result: <strong style={{color:'var(--amber)'}}>
            {fmtLR(msg.display.planck_freq_raw || msg.display.planck_freq_Hz)}
          </strong><br/>
          The brain&apos;s electromagnetic waves do not exceed <strong>2,000 Hz (2.00×10³)</strong>.<br/>
          <em style={{color:'var(--green)'}}>This is a special directed intent energy that you have.</em>
        </div>
      )}

      {/* Power verdict: weak / strong vs average */}
      {msg?.power_verdict && (
        <div style={{
          padding:'.6rem 1rem', borderRadius:8, marginBottom:'.75rem',
          textAlign:'center', fontWeight:600, fontSize:'.9rem',
          background: msg.power_class === 'high' ? 'rgba(0,255,136,.1)' : 'rgba(255,136,0,.1)',
          border: `1px solid ${msg.power_class === 'high' ? 'rgba(0,255,136,.3)' : 'rgba(255,136,0,.3)'}`,
          color: msg.power_class === 'high' ? 'var(--green)' : 'var(--amber)'
        }}>
          {msg.power_class === 'high' ? '💪 ' : '📊 '}{msg.power_verdict}
        </div>
      )}

      {/* Double star rating: yellow=personal, red=group */}
      <StarRatingDouble
        pctVsPersonal={msg?.pct_vs_personal_avg != null ? parseFloat(msg.pct_vs_personal_avg) : (msg?.pct_vs_avg != null ? parseFloat(msg.pct_vs_avg) : null)}
        pctVsGroup={msg?.pct_vs_group_avg != null ? parseFloat(msg.pct_vs_group_avg) : null}
      />
      {/* Group ranking message only */}
      {msg?.group_message && (
        <div style={{fontSize:'.8rem',color:'var(--muted)',margin:'.25rem 0'}}>
          {String(msg.group_message || "").replace(/[🏆🥈🥉]/g, "").trim()}
          {msg.pct_vs_group_avg != null && (
            <span style={{color: msg.pct_vs_group_avg >= 0 ? 'var(--green)' : 'var(--amber)',
              marginLeft:'.4rem',fontWeight:600}}>
              ({msg.pct_vs_group_avg > 0 ? '+' : ''}{msg.pct_vs_group_avg}%)
            </span>
          )}
        </div>
      )}

      {/* 20 variables table — master (lajtnert) only */}
      {master && result && (result.air || result.ideal) && (
        <>
          <button className="btn btn-secondary btn-sm"
            style={{marginTop:'.6rem'}}
            onClick={() => setShowPhysTable(v => !v)}>
            {showPhysTable ? 'Hide table' : 'Show 20 variables'}
          </button>
          {showPhysTable && (
            <div className="phys-tbl-wrap">
              <table className="phys-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Variable</th><th>Unit</th>
                    <th className="ideal">Ideal</th>
                    <th className="air">Air</th>
                    <th className="water">Water</th>
                  </tr>
                </thead>
                <tbody>
                  {medium && (
                    <tr style={{background:'rgba(0,255,136,.04)'}}>
                      <td>—</td>
                      <td style={{fontWeight:600,color:'var(--text)'}}>Medium</td>
                      <td>—</td>
                      <td colSpan={3} style={{
                        color: medium === 'water' ? '#00bcd4' : 'var(--blue)',
                        fontWeight:700
                      }}>
                        {medium.toUpperCase()}
                      </td>
                    </tr>
                  )}
                  {VARS.map(([v, u], i) => (
                    <tr key={v}>
                      <td style={{color:'#334155'}}>{i+1}</td>
                      <td>{VAR_NAMES[v] || v}</td>
                      <td style={{color:'#334155'}}>{u}</td>
                      <td className="ideal">{sciNote(result.ideal?.[v])}</td>
                      <td className="air">{sciNote(result.air?.[v])}</td>
                      <td className="water">{sciNote(result.water?.[v])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}