import { useState, useEffect, createContext, useContext } from 'react'
import { API } from '../config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wt_user')) } catch { return null }
  })

  const login = async (email, password, recaptcha_token = '') => {
    const r = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, recaptcha_token })
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.detail || 'Login failed')
    const u = { email, token: data.token, plan: data.plan || 'free' }
    localStorage.setItem('wt_user', JSON.stringify(u))
    setUser(u)
    return u
  }

  const register = async (email, password, recaptcha_token = '') => {
    const r = await fetch(API + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, recaptcha_token })
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.detail || 'Registration failed')
    return login(email, password, recaptcha_token)
  }

  // Listen for plan updates from Subscription page
  useEffect(() => {
    const handler = () => {
      try {
        const u = JSON.parse(localStorage.getItem('wt_user'))
        if (u) setUser(u)
      } catch {}
    }
    window.addEventListener('wt_plan_updated', handler)
    return () => window.removeEventListener('wt_plan_updated', handler)
  }, [])

  const logout = () => {
    localStorage.removeItem('wt_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)