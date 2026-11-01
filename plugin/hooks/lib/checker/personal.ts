// Personal data (spec §14, D-037): email addresses and phone numbers, found only when the `personal_data`
// setting is on. Imports nothing from Node. Hand-written scanners with bounded loops, so there is nothing
// to get stuck on, and the same left-alone rules as the secret rules (R-08): each harmless form below has
// a test showing it is skipped and a twin showing a real-looking value in the same spot is hidden.

export type PersonalHit = { start: number; end: number; kind: 'email' | 'phone' }

const isLocal = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2e || c === 0x5f || c === 0x25 || c === 0x2b || c === 0x2d
const isDomain = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2e || c === 0x2d
const isAlpha = (s: string): boolean => /^[A-Za-z]+$/.test(s)

const MAX_LOCAL = 64
const MAX_DOMAIN = 255

/** Names reserved for examples and tests (RFC 2606, RFC 6761, RFC 6762): never a real person's address. */
const RESERVED_TLD = new Set(['test', 'invalid', 'local', 'localhost', 'example', 'localdomain', 'internal'])
/** A file name such as `logo@2x.png` has the shape of an address. */
const FILE_EXTENSION = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif', 'css', 'less', 'scss', 'woff', 'woff2', 'ttf', 'eot', 'js', 'mjs', 'cjs', 'json', 'map', 'txt', 'pdf', 'html', 'htm', 'xml', 'yml', 'yaml',
])

function emailAt(text: string, at: number): PersonalHit | undefined {
  // The local part: the longest run of local characters ending just before the @.
  let s = at
  while (s > 0 && at - s <= MAX_LOCAL && isLocal(text.charCodeAt(s - 1))) s--
  if (at - s > MAX_LOCAL) return undefined
  while (s < at && (text[s] === '.' || text[s] === '-' || text[s] === '+')) s++
  if (s === at) return undefined
  const local = text.slice(s, at)
  if (local.toLowerCase() === 'git') return undefined

  let e = at + 1
  while (e < text.length && e - at <= MAX_DOMAIN && isDomain(text.charCodeAt(e))) e++
  // Whole labels only: stop before an empty label, and drop a trailing dot or dash.
  const raw = text.slice(at + 1, e)
  const labels: string[] = []
  for (const label of raw.split('.')) {
    if (label === '' || label.startsWith('-') || label.endsWith('-') || label.length > 63) break
    labels.push(label)
  }
  if (labels.length < 2) return undefined
  const tld = labels[labels.length - 1] as string
  if (!isAlpha(tld) || tld.length < 2 || tld.length > 24) return undefined
  const lowerTld = tld.toLowerCase()
  if (RESERVED_TLD.has(lowerTld) || FILE_EXTENSION.has(lowerTld)) return undefined
  if (labels.some(l => l.toLowerCase() === 'example')) return undefined
  const end = at + 1 + labels.join('.').length
  // `user@host:path` is an SSH or scp remote; an address at the end of a clause (`bob@x.com: thanks`) is followed by a space.
  if (text[end] === ':' && end + 1 < text.length && !/\s/.test(text[end + 1] as string)) return undefined
  return { start: s, end, kind: 'email' }
}

// A + and 8 to 15 digits (E.164), with the usual separators between them. Not preceded by a letter, digit
// or another plus, and not followed by a digit or a letter.
const INTERNATIONAL = /(?<![A-Za-z0-9_+])\+[1-9](?:[ .\-()]{0,2}\d){6,14}(?![A-Za-z0-9_])/g
// 415-555-0132, 415.555.0132, (415) 555-0132, with an optional 1- in front. Plain spaces are not enough: three groups of
// digits split by spaces are far more often a table than a phone number.
const NATIONAL = /(?<![A-Za-z0-9_.+\-])(?:1[-. ])?(?:\(\d{3}\)[ ]?|\d{3}[-.])\d{3}[-.]\d{4}(?![A-Za-z0-9_])(?![.\-]\d)/g

function phones(text: string, out: PersonalHit[]): void {
  for (const m of text.matchAll(INTERNATIONAL)) {
    const digits = m[0].replace(/\D/g, '').length
    const next = text.charCodeAt(m.index + m[0].length)
    // A separator and then another digit means the number goes on: a longer id, not a phone number.
    const goesOn = (next === 0x2e || next === 0x2d) && /\d/.test(text[m.index + m[0].length + 1] ?? '')
    if (digits >= 8 && digits <= 15 && !goesOn) out.push({ start: m.index, end: m.index + m[0].length, kind: 'phone' })
  }
  for (const m of text.matchAll(NATIONAL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'phone' })
}

export function scanPersonal(text: string, want: { email: boolean; phone: boolean }): PersonalHit[] {
  const out: PersonalHit[] = []
  if (want.email) {
    for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
      const hit = emailAt(text, at)
      if (hit) out.push(hit)
    }
  }
  if (want.phone && text.length > 0) phones(text, out)
  return out
}
