import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { API } from '../config'

// The 8 Primary Factors Governing Mental Focus
const QUESTIONS = [
  {
    id: 'q1_illness',
    num: 1,
    title: 'Illness and Immune Status',
    subtitle: 'Brain Fog and Neuroinflammation',
    options: ['Yes', 'No'],
    explanation: `Illness is a systemic strike against focus. When the body fights an infection or chronic inflammation, the immune system produces inflammatory signaling molecules called cytokines. These molecules cross the blood-brain barrier, slowing down synaptic plasticity and disrupting dopamine pathways, which creates classic brain fog. Furthermore, the immune system siphons energy (ATP) away from the prefrontal cortex, and the brain triggers an evolutionary sickness behavior program, intentionally shutting down sharp external focus to preserve all resources for healing.`,
  },
  {
    id: 'q2_loneliness',
    num: 2,
    title: 'Loneliness and Social Isolation',
    subtitle: 'Evolutionary Survival Mode',
    options: ['Lonely', 'Company'],
    explanation: `The brain perceives isolation as an acute threat. Because we lack the protection of the "tribe," the nervous system shifts into a state of social hypervigilance. In this state, attention compulsively scans the environment for hidden dangers, making sustained, deep concentration on a single task impossible. Additionally, the lack of human connection starves the dopamine and oxytocin systems, leading to chronic motivational deficits and a restless mind that constantly seeks displacement activities (like doomscrolling).`,
  },
  {
    id: 'q3_sleep',
    num: 3,
    title: 'Sleep Biology and Circadian Rhythm',
    subtitle: '',
    options: ['Good', 'Bad'],
    explanation: `Sleep deprivation or a disrupted biological clock causes immediate cognitive decline, as it prevents the brain from detoxifying (via the glymphatic system) and consolidating information. Even after a single poor night of sleep, your ability to divide attention drops drastically, and untraceable, split-second micro-sleeps occur. These micro-sleeps fracture your train of thought and severely prolong reaction times.`,
  },
  {
    id: 'q4_homeostasis',
    num: 4,
    title: 'Basic Homeostasis',
    subtitle: 'Hydration and Blood Glucose',
    options: ['Good', 'Bad'],
    explanation: `The brain makes up only 2% of total body weight but consumes nearly 25% of its energy. When blood glucose drops (hunger), the brain enters an energy-saving mode, shutting down complex prefrontal functions and redirecting attention toward resource acquisition. Furthermore, even mild dehydration (1-2%) — which occurs before you even feel thirsty — is proven to shrink working memory and degrade processing accuracy.`,
  },
  {
    id: 'q5_stimulants',
    num: 5,
    title: 'Stimulants, Medications & Smoking',
    subtitle: 'Exogenous Chemical Influence',
    options: ['Regularly', 'Occasionally'],
    explanation: `Any substance that crosses the blood-brain barrier immediately rewires the natural balance of neurotransmitters (such as dopamine, adenosine, and acetylcholine). Alcohol and sedatives slow down electrical communication between neurons. Caffeine blocks adenosine (the fatigue molecule), but over-stimulation or caffeine withdrawal causes anxiety and scattered thoughts. Additionally, many everyday medications (like first-generation antihistamines) cause hidden, subconscious drowsiness. Smoking reduces physical and mental performance.`,
  },
  {
    id: 'q6_digital',
    num: 6,
    title: 'Digital Fragmentation',
    subtitle: '"Attention Residue"',
    options: ['Yes', 'No'],
    explanation: `The modern information environment artificially induces focus deficits through constant context-switching. When you look away from a deep task for just 2 seconds to check a phone notification, your brain cannot instantly switch back. A fragment of the previous stimulus stays trapped in your working memory (attention residue). This background process constantly eats away at your cognitive bandwidth, leaving significantly less capacity for the primary task.`,
  },
  {
    id: 'q7_breathing',
    num: 7,
    title: 'Breathing Technique and Oxygenation',
    subtitle: '',
    options: ['Okay', 'Not okay'],
    explanation: `Optimal neuronal performance and cellular energy production require a continuous, high-volume oxygen supply. Shallow, rapid "chest breathing" caused by stress or poor posture, as well as sitting in a sealed, poorly ventilated room, causes a subtle buildup of carbon dioxide in the blood. Elevated CO₂ levels directly cloud judgment, induce drowsiness, and can cut complex decision-making speeds in half.`,
  },
  {
    id: 'q8_emotional',
    num: 8,
    title: 'Emotional Background Noise and Anxiety',
    subtitle: 'Affective Load',
    options: ['Problem', 'No problem'],
    explanation: `Working memory capacity is extremely narrow. If unresolved emotional tension, anger, a lingering conflict (the Zeigarnik effect), or acute existential anxiety is running in the background, it acts like a heavy software program draining a computer's CPU. The prefrontal cortex must expend a massive portion of its energy on emotional regulation or rumination, leaving literal physical space deficit for clear, structured thoughts.`,
  },
]

/* ── Info popup (Wikipedia-style) ── */
function InfoPopup({ question, onClose }) {
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.7)',
      zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem'
    }} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:12, width:'100%', maxWidth:540, maxHeight:'80vh',
        overflow:'auto', padding:'1.5rem', position:'relative'
      }}>
        <button onClick={onClose} style={{
          position:'absolute', top:'1rem', right:'1rem',
          background:'none', border:'none', color:'var(--muted)',
          fontSize:'1.3rem', cursor:'pointer'
        }}>×</button>
        <div style={{fontSize:'.7rem', color:'var(--green)', fontWeight:700, marginBottom:'.3rem'}}>
          FACTOR {question.num}
        </div>
        <h3 style={{fontSize:'1.35rem', fontWeight:700, color:'var(--text)', marginBottom:'.3rem'}}>
          {question.title}
        </h3>
        {question.subtitle && (
          <div style={{fontSize:'1rem', color:'var(--amber)', marginBottom:'.85rem'}}>
            {question.subtitle}
          </div>
        )}
        <p style={{fontSize:'1.05rem', color:'var(--text)', lineHeight:1.8}}>
          {question.explanation}
        </p>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   QUESTIONNAIRE FORM — all 8 required, one-time
   ═══════════════════════════════════════════════════ */
function QuestionnaireForm({ user, onCompleted }) {
  const [answers, setAnswers] = useState({})
  const [info, setInfo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const answeredCount = Object.values(answers).filter(v => v > 0).length
  const allAnswered = answeredCount === 8
  const unanswered = QUESTIONS.filter(q => !answers[q.id] || answers[q.id] === 0)

  const submit = async () => {
    if (!allAnswered) {
      const names = unanswered.map(q => q.title).join(', ')
      setMsg(`Please answer all 8 questions. Missing: ${names}`)
      return
    }
    setSaving(true); setMsg('')
    const payload = { user_email: user.email, is_measurement: true }
    QUESTIONS.forEach(q => { payload[q.id] = answers[q.id] || 0 })
    payload.answered_count = 8
    try {
      const r = await fetch(`${API}/questionnaire`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      })
      if (r.ok) {
        onCompleted()
      } else {
        const d = await r.json(); setMsg('Error: ' + (d.detail || 'failed'))
      }
    } catch { setMsg('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="page-header">
        <h1>The 8 Primary Factors Governing Mental Focus</h1>
        <p>Please answer <b>all 8 questions</b> to join the study. Once completed,
          you'll have access to all results and correlations.</p>
      </div>

      {/* Email */}
      <div className="card">
        <label className="form-label">Email address (essential)</label>
        <input className="form-input" value={user.email} readOnly style={{opacity:.8}} />
      </div>

      {/* Questions */}
      {QUESTIONS.map(q => {
        const answered = answers[q.id] > 0
        return (
          <div key={q.id} className="card" style={{
            marginBottom:'.85rem',
            borderColor: answered ? 'rgba(0,204,102,.3)' : undefined,
          }}>
            <div style={{display:'flex', justifyContent:'space-between',
              alignItems:'flex-start', gap:'.75rem', marginBottom:'.75rem'}}>
              <div style={{flex:1}}>
                <div style={{display:'flex', alignItems:'center', gap:'.5rem'}}>
                  <span style={{
                    width:24, height:24, borderRadius:'50%',
                    background: answered ? 'var(--green)' : 'var(--bg3)',
                    border:'1px solid var(--border)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'.72rem', fontWeight:700,
                    color: answered ? '#000' : 'var(--green)', flexShrink:0,
                    transition: 'all .2s'
                  }}>{answered ? '✓' : q.num}</span>
                  <span style={{fontWeight:600, color:'var(--text)', fontSize:'1.05rem'}}>
                    {q.title}
                  </span>
                  <button onClick={() => setInfo(q)} title="Explanation" style={{
                    width:24, height:24, borderRadius:'50%',
                    background:'var(--bg3)', border:'1px solid var(--border)',
                    color:'var(--blue)', cursor:'pointer', fontSize:'.9rem',
                    fontWeight:700, flexShrink:0, lineHeight:1, padding:0
                  }}>?</button>
                </div>
                {q.subtitle && (
                  <div style={{fontSize:'.85rem', color:'var(--muted)', marginLeft:'2rem', marginTop:'.15rem'}}>
                    {q.subtitle}
                  </div>
                )}
              </div>
            </div>

            <select
              value={answers[q.id] || ''}
              onChange={e => setAnswers(a => ({...a, [q.id]: parseInt(e.target.value) || 0}))}
              className="form-input"
              style={{maxWidth:300}}>
              <option value="" disabled hidden>— Choose an option —</option>
              <option value="1">{q.options[0]}</option>
              <option value="2">{q.options[1]}</option>
            </select>
          </div>
        )
      })}

      {/* Progress + submit */}
      <div className="card">
        <div style={{fontSize:'.82rem', color:'var(--muted)', marginBottom:'.75rem'}}>
          Answered: <b style={{color: allAnswered ? 'var(--green)' : 'var(--amber)'}}>
            {answeredCount}</b> / 8
          {!allAnswered && <span style={{color:'var(--amber)'}}> — all 8 required</span>}
        </div>
        {msg && (
          <div style={{padding:'.5rem .85rem', borderRadius:6, marginBottom:'.75rem', fontSize:'.85rem',
            background:'rgba(255,68,68,.1)', color:'var(--red)'}}>
            {msg}
          </div>
        )}
        <button onClick={submit} disabled={saving || !allAnswered}
          className="btn btn-primary" style={{width:'100%', opacity: allAnswered ? 1 : .5}}>
          {saving ? 'Saving...' : 'Submit All Answers'}
        </button>
      </div>

      {info && <InfoPopup question={info} onClose={() => setInfo(null)} />}
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   RESULTS VIEW — shown after questionnaire is complete
   ═══════════════════════════════════════════════════ */
function ResultsView({ user }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null)

  useEffect(() => {
    fetch(`${API}/questionnaire/results?email=${encodeURIComponent(user.email)}`)
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user.email])

  if (loading) return <div className="card" style={{textAlign:'center', padding:'2rem'}}>Loading results...</div>
  if (error) return <div className="card" style={{color:'var(--red)'}}>Error loading results: {error}</div>
  if (!data) return null

  const { factors, total_questionnaires, reliable, my_answers } = data

  return (
    <div>
      <div className="page-header">
        <h1>Focus Test — Your Results</h1>
        <p>Correlations between the 8 focus factors and physical performance, based
          on {total_questionnaires} completed questionnaire{total_questionnaires !== 1 ? 's' : ''}.</p>
      </div>

      {/* Reliability notice */}
      {!reliable && (
        <div className="card" style={{
          borderColor:'rgba(255,149,0,.4)', background:'rgba(255,149,0,.08)',
          marginBottom:'1rem'
        }}>
          <p style={{margin:0, color:'var(--text)', fontSize:'.92rem', lineHeight:1.7}}>
            Our database is still growing, so these results may not be fully accurate yet.
            The more videos are uploaded, the sooner the statistics become reliable.
            The results are only valid if the information you entered is accurate.
          </p>
          <p style={{margin:'.5rem 0 0', color:'var(--muted)', fontSize:'.8rem'}}>
            Complete questionnaires: <b>{total_questionnaires}</b> / 30 needed for reliable results
          </p>
        </div>
      )}

      {/* Your answers summary */}
      <div className="card" style={{marginBottom:'1rem'}}>
        <h3 style={{fontSize:'1rem', fontWeight:700, color:'var(--green)', marginBottom:'.75rem'}}>
          ✓ Your Answers
        </h3>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:'.5rem'}}>
          {factors.map(f => {
            const myAns = f.my_answer
            const label = myAns === 1 ? f.options[0] : myAns === 2 ? f.options[1] : '—'
            return (
              <div key={f.factor} style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'.4rem .6rem', borderRadius:6,
                background:'var(--bg3)', fontSize:'.85rem'
              }}>
                <span style={{color:'var(--muted)'}}>{f.title}</span>
                <b style={{color:'var(--text)', marginLeft:'.5rem', whiteSpace:'nowrap'}}>{label}</b>
              </div>
            )
          })}
        </div>
      </div>

      {/* Factor correlations */}
      <h2 style={{fontSize:'1.15rem', fontWeight:700, color:'var(--text)', margin:'1.5rem 0 .75rem'}}>
        Factor Correlations with Performance
      </h2>

      {factors.map(f => {
        const q = QUESTIONS.find(q => q.id === f.factor)
        const hasData = !f.error && f.n >= 4

        return (
          <div key={f.factor} className="card" style={{marginBottom:'.85rem'}}>
            <div style={{display:'flex', alignItems:'center', gap:'.5rem', marginBottom:'.5rem'}}>
              <span style={{
                width:24, height:24, borderRadius:'50%',
                background:'var(--bg3)', border:'1px solid var(--border)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'.72rem', fontWeight:700, color:'var(--green)', flexShrink:0
              }}>{q?.num}</span>
              <span style={{fontWeight:600, color:'var(--text)', fontSize:'1.02rem', flex:1}}>
                {f.title}
              </span>
              {q && (
                <button onClick={() => setInfo(q)} style={{
                  width:22, height:22, borderRadius:'50%',
                  background:'var(--bg3)', border:'1px solid var(--border)',
                  color:'var(--blue)', cursor:'pointer', fontSize:'.8rem',
                  fontWeight:700, flexShrink:0, lineHeight:1, padding:0
                }}>?</button>
              )}
            </div>

            {hasData ? (
              <div style={{fontSize:'.9rem', lineHeight:1.7}}>
                <div style={{display:'flex', gap:'1.5rem', flexWrap:'wrap', marginBottom:'.5rem'}}>
                  <span style={{color:'var(--muted)'}}>
                    N = <b style={{color:'var(--text)'}}>{f.N}</b>
                  </span>
                  <span style={{color:'var(--muted)'}}>
                    Odds Ratio = <b style={{
                      color: f.significant ? 'var(--green)' : 'var(--text)'
                    }}>{f.odds_ratio}</b>
                  </span>
                  <span style={{color:'var(--muted)', fontSize:'.8rem'}}>
                    95% CI: [{f.ci_lower} – {f.ci_upper}]
                  </span>
                </div>
                <div style={{fontSize:'.82rem', color: f.significant ? 'var(--green)' : 'var(--muted)'}}>
                  {f.significant
                    ? `Statistically significant (p = ${f.p_value})`
                    : `Not statistically significant (p = ${f.p_value})`
                  }
                </div>
                <div style={{marginTop:'.4rem', fontSize:'.8rem', color:'var(--muted)'}}>
                  {f.options[0]}: {f.A + f.B} responses · {f.options[1]}: {f.C + f.D} responses
                </div>
              </div>
            ) : (
              <div style={{fontSize:'.85rem', color:'var(--muted)', fontStyle:'italic'}}>
                {f.error || 'Not enough data yet for this factor.'}
              </div>
            )}
          </div>
        )
      })}

      {info && <InfoPopup question={info} onClose={() => setInfo(null)} />}
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   GATE — show message if questionnaire not completed
   ═══════════════════════════════════════════════════ */
function NotCompletedGate({ onFillOut }) {
  return (
    <div>
      <div className="page-header">
        <h1>Focus Test</h1>
      </div>
      <div className="card" style={{
        borderColor:'rgba(255,149,0,.4)', background:'rgba(255,149,0,.06)',
        textAlign:'center', padding:'2rem 1.5rem'
      }}>
        <h2 style={{fontSize:'1.2rem', fontWeight:700, color:'var(--text)', marginBottom:'1rem'}}>
          This data isn't available yet because you haven't completed the questionnaire.
        </h2>
        <p style={{color:'var(--text)', lineHeight:1.7, fontSize:'.95rem', maxWidth:520, margin:'0 auto 1.5rem'}}>
          Please fill out the form below to join the study. Once you're done,
          you'll have access to all the data.
        </p>
        <p style={{color:'var(--muted)', lineHeight:1.7, fontSize:'.9rem', maxWidth:520, margin:'0 auto 1.5rem'}}>
          Our community is growing, and we'd love for you to join us!
          Explore all the data and use the results to improve your quality of life.
        </p>
        <button onClick={onFillOut} className="btn btn-primary" style={{padding:'.7rem 2rem'}}>
          Fill Out Questionnaire
        </button>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   MAIN EXPORT — routes between gate / form / results
   ═══════════════════════════════════════════════════ */
export default function Questionnaire() {
  const { user } = useAuth()
  const [status, setStatus] = useState('loading')  // loading | gate | form | results
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!user) return
    fetch(`${API}/questionnaire/my?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(d => {
        if (d.completed) {
          setStatus('results')
        } else {
          setStatus('gate')
        }
      })
      .catch(() => setStatus('gate'))
      .finally(() => setChecked(true))
  }, [user])

  if (!user) return null
  if (!checked) return <div className="card" style={{textAlign:'center', padding:'2rem'}}>Loading...</div>

  if (status === 'results') return <ResultsView user={user} />
  if (status === 'form')   return <QuestionnaireForm user={user} onCompleted={() => setStatus('results')} />
  if (status === 'gate')   return <NotCompletedGate onFillOut={() => setStatus('form')} />

  return null
}