/**
 * REGISTRATION PATCH
 * ==================
 * Izmeneniya v forme registracii:
 *
 * 1. Dobav' state:
 *    const [ageConfirmed, setAgeConfirmed] = useState(false);
 *
 * 2. Dobav' checkbox PERED knopkoy "Register":
 */

// --- VSTAVIT' V FORMU REGISTRACII (pered submit button) ---

const AgeConfirmCheckbox = ({ checked, onChange }) => (
  <div style={{ margin: '16px 0' }}>
    <label style={{ display: 'flex', gap: 10, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: '#4a90d9' }}
      />
      <span style={{ color: '#ccc', fontSize: 13, lineHeight: 1.5 }}>
        I confirm that I am an adult where I live.
      </span>
    </label>
  </div>
);

// --- V handleRegister() dobav' age_confirmed v body: ---

/*
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      recaptcha_token: recaptchaToken,
      age_confirmed: ageConfirmed,    // <--- DOBAVIT'
    })
  });
*/

// --- Disable knopku Register esli ne confirmed: ---
// <button disabled={!ageConfirmed || loading} ...>Register</button>


// ═══════════════════════════════════════════════════════════════
// LOGIN PATCH — SecurityCodeModal
// ═══════════════════════════════════════════════════════════════

/*
V Login komponente (posle uspeshnogo logina):

  import SecurityCodeModal from './SecurityCodeModal';

  const [securityCode, setSecurityCode] = useState(null);

  // V handleLogin posle uspeshnogo otveta:
  const data = await res.json();
  if (data.security_code && data.security_code_first_show) {
    setSecurityCode(data.security_code);
    // Ne delat' redirect poka user ne podtverdit
    return;
  }
  // ... normal redirect ...

  // V JSX:
  {securityCode && (
    <SecurityCodeModal
      code={securityCode}
      onClose={() => {
        setSecurityCode(null);
        // normal redirect posle podtverzhdeniya
        navigate('/');
      }}
    />
  )}
*/


// ═══════════════════════════════════════════════════════════════
// SHIPPING RESTRICTIONS — ShippingForm patch
// ═══════════════════════════════════════════════════════════════

const ALLOWED_COUNTRIES = [
  { code: 'US', name: 'United States', regions: ['California', 'New York'] },
  { code: 'NO', name: 'Norway', regions: null },
  { code: 'CH', name: 'Switzerland', regions: null },
  { code: 'GB', name: 'United Kingdom', regions: ['London'] },
];

/*
V forme dostavki:
1. Zameni <select country> na tol'ko ALLOWED_COUNTRIES
2. Esli US ili GB — pokazhi vtoroj select dlya regiona/goroda
3. Dobav' informativnoe soobshchenie:
*/

const ShippingNotice = () => (
  <div style={{
    background: '#1a1a2e', border: '1px solid #3a3a5a',
    borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#aaa'
  }}>
    <strong style={{ color: '#4a90d9' }}>🚚 Shipping availability:</strong>{' '}
    We currently ship hardware to the USA (California, New York City),
    Norway, Switzerland, and the UK (London) only.
    Digital subscriptions are available worldwide.
  </div>
);


// ═══════════════════════════════════════════════════════════════
// TERMINOLOGY PATCH (Account vs Measurement Profile)
// ═══════════════════════════════════════════════════════════════

/*
Zameni vsyudu v UI:
- "Profile" (v kontekste profil usera) → "Account"
  Account = user's email address
- "Profile" (v kontekste chipa/ustrojstva) → "Measurement Profile"
  Measurement Profile = profile associated with user's chip
- Primer: "Switch Profile" → "Switch Measurement Profile"
- Primer: "My Profile" (settings) → "My Account"
- Primer: "Profile linked to chip XYZ" → "Measurement Profile linked to chip XYZ"

NOTE: One account can have multiple measurement profiles.
*/


// ═══════════════════════════════════════════════════════════════
// APP.JSX ROUTES — DOBAVIT'
// ═══════════════════════════════════════════════════════════════

/*
V App.jsx, ryadom s /faq route (VNE Shell, publichnye):

  <Route path="/delete-account" element={<DeleteAccountByCode />} />

Eto publichnaya stranica — pol'zovatel' mozhet byt' ne zaloginen
(potomu chto poteryat device).
*/
