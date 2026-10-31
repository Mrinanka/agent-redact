// A private key whose end is missing (output cut off, a paste that stopped short).
// The Gitleaks rule needs the closing line; this one doesn't. It hides the header,
// the base64 body lines, and the closing line if there is one.

const BODY = /^[A-Za-z0-9+/=]+$/
const PEM_HEADER = /^[A-Za-z][A-Za-z0-9-]{0,40}: /
const MIN_BODY = 32

function lineEnd(text: string, from: number): number {
  const nl = text.indexOf('\n', from)
  return nl < 0 ? text.length : nl
}

/** `hitStart` is where the words "private key" begin. Returns the span to hide, or null. */
export function checkTruncatedKey(text: string, hitStart: number, hitEnd: number): { start: number; end: number } | null {
  // The header starts on the same line, up to 110 characters back.
  let start = -1
  for (let k = hitStart; k >= Math.max(0, hitStart - 110); k--) {
    const c = text.charCodeAt(k)
    if (c === 0x0a) break
    if (c === 0x2d && text.slice(k, k + 10).toUpperCase() === '-----BEGIN') {
      start = k
      break
    }
  }
  if (start < 0) return null
  let i = hitEnd
  if (text.slice(i, i + 6).toUpperCase() === ' BLOCK') i += 6
  if (text.slice(i, i + 5) !== '-----') return null
  i += 5
  let last = i
  let bodyChars = 0
  let blanks = 0
  let pos = lineEnd(text, i)
  while (pos < text.length) {
    const ls = pos + 1
    const le = lineEnd(text, ls)
    const end = le > ls && text.charCodeAt(le - 1) === 0x0d ? le - 1 : le
    const line = text.slice(ls, end)
    pos = le
    if (line.length === 0) {
      if (++blanks > 1) break
      continue
    }
    blanks = 0
    if (line.startsWith('-----END')) {
      last = end
      break
    }
    if (BODY.test(line)) {
      bodyChars += line.length
      last = end
    } else if (PEM_HEADER.test(line)) {
      last = end
    } else break
  }
  return bodyChars >= MIN_BODY ? { start, end: last } : null
}
