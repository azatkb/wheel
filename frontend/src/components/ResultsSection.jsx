import { useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { drawChart, drawDualChart } from '../hooks/useChart'
import PhysicsCard from './PhysicsCard'
import BarChart from './BarChart'
import { API } from '../config'

export default function ResultsSection({ jobId, samples, physics, barData, isPaid, showTable = true, master = false, onReplay, onStopReplay, replaying = false }) {
  const chartRef = useRef(null)
  const dualRef = useRef(null)

  useEffect(() => {
    if (chartRef.current && samples.length) {
      drawChart(chartRef.current, samples)
    }
    if (dualRef.current && samples.length) {
      drawDualChart(dualRef.current, samples)
    }
  }, [samples])

  if (!samples.length) return null

  const last = samples[samples.length - 1]
  const maxC = Math.max(...samples.map(s => Math.abs(+s.cumulative_deg)))
  const avgS = Math.round(samples.reduce((a, s) => a + (+s.confidence_pct), 0) / samples.length)

  const downloadXLSX = () => {
    if (!samples?.length) return
    const headers = ['Time (s)', 'Angle (°)', 'Total (°)', 'Velocity (°/s)', 'Significance (%)']
    const rows = samples.map(s => [
      s.timestamp_sec, s.rotation_deg, s.cumulative_deg,
      s.angular_vel_dps, s.confidence_pct,
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = headers.map(() => ({wch: 16}))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Samples')
    XLSX.writeFile(wb, `samples_${(jobId||'data').slice(0,8)}.xlsx`)
  }

  return (
    <div>
      {physics?.message && (
        <PhysicsCard msg={physics.message} result={physics.result} jobId={jobId} isPaid={isPaid} showTable={showTable} master={master} medium={physics.message?.medium} />
      )}

      <div className="card">
        <div className="card-title">Results</div>
        <div className="metrics-grid" style={{marginBottom:'1rem'}}>
          {[
            [samples.length, 'Samples'],
            [(+last.timestamp_sec).toFixed(1) + 's', 'Duration'],
            [maxC.toFixed(1) + '°', 'Max Rotation'],
            [(+last.cumulative_deg).toFixed(1) + '°', 'Final Angle'],
            [avgS + '%', 'Avg Significance'],
          ].map(([v, l]) => (
            <div key={l} className="metric-box">
              <div className="metric-val">{v}</div>
              <div className="metric-label">{l}</div>
            </div>
          ))}
        </div>

        {/* Dual chart: real-time + cumulative */}
        <canvas ref={dualRef} style={{width:'100%',height:340,borderRadius:10,background:'#080b0f',display:'block',marginBottom:'.5rem'}} />
        {/* Legacy cumulative-only chart */}
        <details style={{marginBottom:'.5rem'}}>
          <summary style={{fontSize:'.72rem',color:'var(--muted)',cursor:'pointer',padding:'.2rem 0'}}>
            Show cumulative-only chart
          </summary>
          <canvas ref={chartRef} style={{width:'100%',height:200,borderRadius:10,background:'#080b0f',display:'block',marginTop:'.3rem'}} />
        </details>

        {/* Bar chart comparison */}
        {barData && (
          <div style={{marginBottom:'1rem'}}>
            <div className="card-title" style={{marginBottom:'.5rem'}}>
              Performance comparison
            </div>
            <BarChart barData={barData} isPaid={isPaid} />
          </div>
        )}

        <div style={{display:'flex',gap:'.5rem',margin:'.75rem 0',flexWrap:'wrap'}}>
          {master ? (
            <>
              <a href={`${API}/download/${jobId}`} target="_blank" rel="noreferrer">
                <button className="btn btn-primary btn-sm">↓ Download Video</button>
              </a>
              <button className="btn btn-secondary btn-sm" onClick={downloadXLSX}>
                ↓ Download XLSX
              </button>
            </>
          ) : (
            onReplay && (
              replaying
                ? <button className="btn btn-danger btn-sm" onClick={onStopReplay}>■ Stop replay</button>
                : <button className="btn btn-primary btn-sm" onClick={onReplay}>▶ Replay with overlay</button>
            )
          )}
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Time (s)</th>
                <th>Angle (°)<br/><span style={{color:'var(--green)',fontSize:'.6rem'}}>CCW+ &amp; CW-</span></th>
                <th>Total (°)<br/><span style={{color:'var(--green)',fontSize:'.6rem'}}>CCW+ &amp; CW-</span></th>
                <th>Vel (°/s)</th><th>Sig%</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={i}>
                  <td>{(+s.timestamp_sec).toFixed(2)}</td>
                  <td style={{color:(+s.rotation_deg||0)<0?'var(--blue)':'var(--green)'}}>
                    {s.rotation_deg != null ? (+s.rotation_deg).toFixed(1) : '--'}
                  </td>
                  <td style={{color:(+s.cumulative_deg||0)<0?'var(--blue)':'var(--green)'}}>
                    {(+s.cumulative_deg).toFixed(1)}
                  </td>
                  <td>{s.angular_vel_dps != null ? (+s.angular_vel_dps).toFixed(1) : '--'}</td>
                  <td>{s.confidence_pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}