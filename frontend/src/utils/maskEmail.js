// Mask an email for public display on the forum, e.g.
//   lajtnert@gmail.com  ->  l…t@g…m
// The full address is never shown on the page (only this "usual solution").
export function maskEmail(email) {
  const e = (email || '').trim()
  if (!e.includes('@')) return 'user'
  const [local, domain] = e.split('@')
  const m = (s) => {
    s = s || ''
    if (s.length <= 2) return (s[0] || '') + '…'
    return s[0] + '…' + s[s.length - 1]
  }
  return `${m(local)}@${m(domain)}`
}

export default maskEmail
