import { useDeviceAuth } from '../hooks/useDeviceAuth'

// Set to true to require an NFC tap. false = gate disabled (open access).
const DEVICE_GATE_ENABLED = false

/**
 * Wrap the measurement UI:
 *   <DeviceGate><Upload .../></DeviceGate>
 * Children render only after the user has tapped a genuine wheel tag
 * (i.e. a valid dev_token was confirmed this browser session).
 *
 * For local testing without a chip, use the /sim endpoint to get a tap_url,
 * open it, and you'll be redirected back here authorized.
 */
export default function DeviceGate({ children }) {
  if (!DEVICE_GATE_ENABLED) return children
  const { deviceAuthorized, checking } = useDeviceAuth()

  if (checking) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <div style={{ color: 'var(--muted)' }}>Verifying your device…</div>
      </div>
    )
  }

  if (deviceAuthorized) return children

  return (
    <div className="card" style={{ textAlign: 'center', padding: '2.25rem 1.5rem' }}>
      <div style={{ fontSize: '2.4rem', marginBottom: '.5rem' }}>📟</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '.4rem' }}>
        Tap your device to begin
      </div>
      <p style={{ color: 'var(--muted)', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
        Hold your phone to the secure tag on the product box. Your browser will open
        and unlock the measurement automatically — this confirms you are using a
        genuine device.
      </p>
      <p style={{ color: 'var(--dim)', fontSize: '.8rem', marginTop: '1rem' }}>
        No NFC prompt? Make sure NFC is enabled on your phone and the tag is near the back of the device.
      </p>
    </div>
  )
}