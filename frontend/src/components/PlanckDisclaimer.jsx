/**
 * PlanckDisclaimer.jsx
 * Small notice shown where Lajtner Resonance (LR) value first appears.
 * Tamas's requirement: explain that Planck formula refers to
 * "a theoretical, non-existent photon and serves merely as a computational aid."
 */

export default function PlanckDisclaimer() {
  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #3a3a5a',
      borderRadius: 8,
      padding: '10px 14px',
      margin: '8px 0',
      fontSize: 12,
      color: '#999',
      lineHeight: 1.5,
    }}>
      <span style={{ color: '#4a90d9', fontWeight: 600 }}>ℹ️ Note:</span>{' '}
      The Lajtner Resonance value is calculated using the Planck formula (E = h × f).
      In this context, the formula refers to a theoretical, non-existent photon and serves
      merely as a computational aid to express the measured kinetic energy as an equivalent
      frequency value. It does not imply the emission of actual photons.
    </div>
  );
}