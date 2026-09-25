import { useState, useEffect, useCallback } from 'react'
import { API } from '../config'

const SS_KEY = 'wt_device_auth'
let _checkedThisLoad = false   // validate the URL token only once per page load

function readStored() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY)) || { authorized: false } }
  catch { return { authorized: false } }
}

// Call this from the app's logout handler so the NFC gate closes on sign-out
// (the next visit will then require a fresh tap).
export function clearDeviceAuth() {
  try { sessionStorage.removeItem(SS_KEY) } catch {}
}

/**
 * Device authorization for the NTAG verify flow.
 *
 * When the user taps the wheel's NFC tag, the chip opens
 *   https://wheelttt.xyz/verify?picc=..&cmac=..
 * which (on success) redirects the browser to the web app with ?dev_token=..
 *
 * This hook picks up that token, confirms it with GET /device-session,
 * and remembers the result for the rest of the browser session so the
 * user can run measurements without re-tapping every time.
 */
export function useDeviceAuth() {
  const [state, setState] = useState(readStored)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (_checkedThisLoad) return
    _checkedThisLoad = true

    // If this browser was authorized as a laptop (via QR pairing), re-check that
    // its token is still the active one — a newer laptop revokes older ones.
    const stored = readStored()
    if (stored.laptop && stored.token) {
      fetch(`${API}/pair/check?token=${encodeURIComponent(stored.token)}`)
        .then(r => r.json())
        .then(d => {
          if (!d.valid) { sessionStorage.removeItem(SS_KEY); setState({ authorized: false }) }
        })
        .catch(() => {/* keep current state offline */})
    }

    const url = new URL(window.location.href)
    const token = url.searchParams.get('dev_token')
    if (!token) return

    setChecking(true)
    fetch(`${API}/device-session?token=${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('invalid'))))
      .then(d => {
        const next = { authorized: !!d.authorized, uid: d.uid, ts: Date.now() }
        sessionStorage.setItem(SS_KEY, JSON.stringify(next))
        setState(next)
        // Tell the server this logged-in email is chip-verified (for laptop pairing).
        try {
          const u = JSON.parse(localStorage.getItem('wt_user') || '{}')
          if (d.authorized && u.email) {
            fetch(`${API}/chip/confirm`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: u.email, token })
            }).catch(() => {})
          }
        } catch {}
      })
      .catch(() => {/* leave unauthorized */})
      .finally(() => {
        setChecking(false)
        // strip dev_token from the address bar
        url.searchParams.delete('dev_token')
        window.history.replaceState({}, '', url.pathname + url.search + url.hash)
      })
  }, [])

  const reset = useCallback(() => {
    sessionStorage.removeItem(SS_KEY)
    setState({ authorized: false })
  }, [])

  return {
    deviceAuthorized: !!state.authorized,
    deviceUid: state.uid || null,
    checking,
    reset,
  }
}