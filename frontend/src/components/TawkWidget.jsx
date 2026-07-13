import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

// Tawk.to live chat (floating button, bottom-right on every page).
// Property/widget from the dashboard:
const TAWK_SRC = 'https://embed.tawk.to/6a550e6ec2cec51d490c1b8b/1jte40o80'

export default function TawkWidget() {
  const { user } = useAuth()

  // Inject the Tawk.to embed script exactly once
  useEffect(() => {
    if (window.__tawkInjected) return
    window.__tawkInjected = true
    window.Tawk_API = window.Tawk_API || {}
    window.Tawk_LoadStart = new Date()
    // Pre-set the visitor if we already know who is logged in
    if (user?.email) {
      window.Tawk_API.visitor = { name: user.email.split('@')[0], email: user.email }
    }
    const s1 = document.createElement('script')
    const s0 = document.getElementsByTagName('script')[0]
    s1.async = true
    s1.src = TAWK_SRC
    s1.charset = 'UTF-8'
    s1.setAttribute('crossorigin', '*')
    s0.parentNode.insertBefore(s1, s0)
  }, [])

  // Keep the visitor's email in sync (e.g. after they log in) so support
  // sees who is writing — this is the "connected with the user's email" bit.
  useEffect(() => {
    if (!user?.email) return
    const apply = () => {
      try {
        if (typeof window.Tawk_API?.setAttributes === 'function') {
          window.Tawk_API.setAttributes(
            { name: user.email.split('@')[0], email: user.email },
            () => {}
          )
        }
      } catch {}
    }
    // Tawk may still be loading — run on its onLoad and also try right away
    if (window.Tawk_API) {
      const prev = window.Tawk_API.onLoad
      window.Tawk_API.onLoad = () => { try { prev && prev() } catch {} ; apply() }
      apply()
    }
  }, [user?.email])

  return null
}
