// The kit's search. A fake can reach a request in the clear or in a disguised
// form, and JSON escaping can hide it from a plain search of the raw body. So each
// part of a request is searched twice over: its raw JSON and its decoded strings,
// for every form of every fake. A miss here is a false "clean".
//
// Results are labels only. Nothing here keeps or prints a value.

export type Needle = { fakeId: string; form: string; text: string }

export type Part = 'messages' | 'system' | 'tools' | 'headers' | 'url' | 'other'

export type ScanHit = { fakeId: string; part: Part; form: string }

export type RequestView = {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

const jsonEscape = (s: string): string => JSON.stringify(s).slice(1, -1)

/**
 * The characters of base64 (at byte offset `lead`) that depend only on the value:
 * the edges, which mix in the bytes around it, are trimmed. So this text appears
 * in the base64 of anything holding the value at that alignment.
 */
function base64Core(bytes: Buffer, lead: number, url: boolean): string {
  const total = bytes.length + lead
  const encoded = Buffer.concat([Buffer.alloc(lead), bytes]).toString(url ? 'base64url' : 'base64')
  const rest = total % 3
  const end = Math.floor(total / 3) * 4 + rest
  const start = lead === 0 ? 0 : lead + 1
  return encoded.slice(start, end)
}

export function needlesFor(fakeId: string, value: string): Needle[] {
  const bytes = Buffer.from(value, 'utf8')
  const hex = bytes.toString('hex')
  const forms: [form: string, text: string][] = [
    ['plain', value],
    ['json-escaped', jsonEscape(value)],
    ['json-escaped-twice', jsonEscape(jsonEscape(value))],
    ['url', encodeURIComponent(value)],
    ['hex', hex],
    ['hex-upper', hex.toUpperCase()],
    ...[0, 1, 2].map((lead): [string, string] => [`base64-${lead}`, base64Core(bytes, lead, false)]),
    ...[0, 1, 2].map((lead): [string, string] => [`base64url-${lead}`, base64Core(bytes, lead, true)]),
  ]
  // A form identical to an earlier one (most values need no escaping) adds nothing.
  const seen = new Set<string>()
  const out: Needle[] = []
  for (const [form, text] of forms) {
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push({ fakeId, form, text })
  }
  return out
}

/** A witness proves a door was used. It must appear as is, so one plain needle is enough. */
export const witnessNeedle = (id: string, witness: string): Needle => ({ fakeId: id, form: 'plain', text: witness })

function leaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) leaves(v, out)
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) leaves(v, out)
}

/** Raw JSON (escapes intact) plus every decoded string. */
function searchable(value: unknown): string {
  const strings: string[] = []
  leaves(value, strings)
  return [JSON.stringify(value), ...strings].join('\0')
}

const BODY_PARTS: Record<string, Part> = { messages: 'messages', system: 'system', tools: 'tools' }

function partsOf(view: RequestView): [Part, string][] {
  const out: [Part, string][] = [
    ['url', decodeSafely(view.url)],
    ['headers', JSON.stringify(view.headers)],
  ]
  const text = view.body.toString('utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    out.push(['other', text])
    return out
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    out.push(['other', searchable(json)])
    return out
  }
  const grouped = new Map<Part, unknown[]>()
  for (const [key, value] of Object.entries(json)) {
    const part = BODY_PARTS[key] ?? 'other'
    grouped.set(part, [...(grouped.get(part) ?? []), value])
  }
  for (const [part, values] of grouped) out.push([part, searchable(values)])
  return out
}

// The URL as sent and as decoded: a query string can percent-encode a value.
function decodeSafely(url: string): string {
  try {
    return `${url}\0${decodeURIComponent(url)}`
  } catch {
    return url
  }
}

export function scanRequest(view: RequestView, needles: readonly Needle[]): ScanHit[] {
  const hits: ScanHit[] = []
  for (const [part, text] of partsOf(view)) {
    for (const n of needles) {
      if (text.includes(n.text)) hits.push({ fakeId: n.fakeId, part, form: n.form })
    }
  }
  return hits
}

export const holdsFake = (text: string, needles: readonly Needle[]): boolean => needles.some(n => text.includes(n.text))

/** Replaces every form of every fake with a label. Longest first, so no part of a value survives. */
export function scrub(text: string, needles: readonly Needle[]): string {
  const longestFirst = [...needles].sort((a, b) => b.text.length - a.text.length)
  return longestFirst.reduce((acc, n) => acc.split(n.text).join(`<fake:${n.fakeId}>`), text)
}
