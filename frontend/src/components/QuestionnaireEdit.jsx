/**
 * QuestionnaireEdit.jsx
 * Edit Focus Test answers (e.g., user stopped smoking).
 * Uses the same binary options (1/2) as the original questionnaire.
 * Props: email, questions (QUESTIONS array from parent), onSaved, onCancel
 */
import { useState, useEffect } from 'react'
import { API } from '../config'

export default function QuestionnaireEdit({ email, questions, onSaved, onCancel }) {
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetch(`${API}/questionnaire/my?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(data => {
        // data.answers or data itself might have q1_illness, q2_loneliness etc.
        const src = data.answers || data
        const a = {}
        questions.forEach(q => { a[q.id] = src[q.id] || 0 })
        setAnswers(a)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [email])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${API}/questionnaire/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...answers })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      setSuccess(true)
      setTimeout(() => onSaved?.(), 1500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="card" style={{textAlign:'center',padding:'2rem',color:'var(--muted)'}}>Loading your answers...</div>

  return (
    <div>
      <p style={{color:'var(--muted)', fontSize:'.85rem', marginBottom:'1rem'}}>
        Update your answers if your lifestyle has changed (e.g., you stopped smoking).
      </p>

      {questions.map(q => (
        <div key={q.id} className="card" style={{
          marginBottom:'.75rem',
          borderColor: answers[q.id] > 0 ? 'rgba(0,204,102,.3)' : undefined
        }}>
          <div style={{display:'flex', alignItems:'center', gap:'.5rem', marginBottom:'.5rem'}}>
            <span style={{
              width:22, height:22, borderRadius:'50%',
              background: answers[q.id] > 0 ? 'var(--green)' : 'var(--bg3)',
              border:'1px solid var(--border)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'.7rem', fontWeight:700,
              color: answers[q.id] > 0 ? '#000' : 'var(--green)', flexShrink:0
            }}>{answers[q.id] > 0 ? '✓' : q.num}</span>
            <span style={{fontWeight:600, color:'var(--text)', fontSize:'.95rem'}}>
              {q.title}
            </span>
          </div>
          {q.subtitle && (
            <div style={{fontSize:'.8rem', color:'var(--muted)', marginLeft:'1.8rem', marginBottom:'.5rem'}}>
              {q.subtitle}
            </div>
          )}
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

      {error && (
        <div style={{padding:'.5rem .85rem', borderRadius:6, marginBottom:'.75rem', fontSize:'.85rem',
          background:'rgba(255,68,68,.1)', color:'var(--red)'}}>
          {error}
        </div>
      )}
      {success && (
        <div style={{padding:'.5rem .85rem', borderRadius:6, marginBottom:'.75rem', fontSize:'.85rem',
          background:'rgba(0,255,136,.1)', color:'var(--green)'}}>
          ✅ Saved successfully!
        </div>
      )}

      <div style={{display:'flex', gap:'.75rem', marginTop:'1rem'}}>
        <button onClick={onCancel} className="btn btn-secondary" style={{flex:1}}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary" style={{flex:1}}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}