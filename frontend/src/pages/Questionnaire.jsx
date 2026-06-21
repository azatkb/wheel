import { useState } from 'react'
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

// Info popup (Wikipedia-style)
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

export default function Questionnaire() {
  const { user } = useAuth()

  const [answers, setAnswers] = useState({})   // { q1_illness: 1, ... }  1=first opt, 2=second
  const [info, setInfo] = useState(null)         // question shown in popup
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  if (!user) return null

  const answeredCount = Object.values(answers).filter(v => v > 0).length

  const submit = async () => {
    if (answeredCount < 2) {
      setMsg('Please answer at least 2 questions.')
      return
    }
    setSaving(true); setMsg('')
    // Build payload — 0 for unanswered
    const payload = { user_email: user.email, is_measurement: true }
    QUESTIONS.forEach(q => { payload[q.id] = answers[q.id] || 0 })
    payload.answered_count = answeredCount
    try {
      const r = await fetch(`${API}/questionnaire`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      })
      if (r.ok) {
        setMsg('✓ Saved! Thank you.')
        setAnswers({})
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
        <p>Answer all 8, or at least 2. Tap the <b>?</b> for an explanation of each factor.</p>
      </div>

      {/* Email (essential, read-only from account) */}
      <div className="card">
        <label className="form-label">Email address (essential)</label>
        <input className="form-input" value={user.email} readOnly
          style={{opacity:.8}} />
      </div>

      {/* Questions */}
      {QUESTIONS.map(q => (
        <div key={q.id} className="card" style={{marginBottom:'.85rem'}}>
          <div style={{display:'flex', justifyContent:'space-between',
            alignItems:'flex-start', gap:'.75rem', marginBottom:'.75rem'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex', alignItems:'center', gap:'.5rem'}}>
                <span style={{
                  width:24, height:24, borderRadius:'50%',
                  background:'var(--bg3)', border:'1px solid var(--border)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:'.72rem', fontWeight:700, color:'var(--green)', flexShrink:0
                }}>{q.num}</span>
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

          {/* Options dropdown */}
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
      ))}

      {/* Progress + submit */}
      <div className="card">
        <div style={{fontSize:'.82rem', color:'var(--muted)', marginBottom:'.75rem'}}>
          Answered: <b style={{color: answeredCount >= 2 ? 'var(--green)' : 'var(--amber)'}}>
            {answeredCount}</b> / 8
          {answeredCount < 2 && <span style={{color:'var(--amber)'}}> (minimum 2 required)</span>}
        </div>
        {msg && (
          <div style={{padding:'.5rem .85rem', borderRadius:6, marginBottom:'.75rem', fontSize:'.85rem',
            background: msg.startsWith('✓') ? 'rgba(0,255,136,.1)' : 'rgba(255,68,68,.1)',
            color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)'}}>
            {msg}
          </div>
        )}
        <button onClick={submit} disabled={saving || answeredCount < 2}
          className="btn btn-primary" style={{width:'100%'}}>
          {saving ? 'Saving...' : 'Submit Answers'}
        </button>
      </div>

      {info && <InfoPopup question={info} onClose={() => setInfo(null)} />}
    </div>
  )
}