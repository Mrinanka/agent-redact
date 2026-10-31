// A reader for the TOML subset the Gitleaks file uses: comments, [table],
// [[array.of.tables]], `key = value` where a value is a basic string, a literal
// string (single or triple quoted), a number, a boolean, or an array of those.
// Anything else fails with the line number, so a changed upstream file can't be
// misread quietly.

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable
export type TomlTable = { [key: string]: TomlValue }

class Reader {
  pos = 0
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
  line(at = this.pos): number {
    let n = 1
    for (let i = 0; i < at && i < this.text.length; i++) if (this.text[i] === '\n') n++
    return n
  }
  fail(message: string, at = this.pos): never {
    throw new Error(`toml line ${this.line(at)}: ${message}`)
  }
  peek(): string | undefined {
    return this.text[this.pos]
  }
  /** Skips spaces and tabs only. */
  skipBlank(): void {
    while (this.text[this.pos] === ' ' || this.text[this.pos] === '\t') this.pos++
  }
  skipComment(): void {
    if (this.text[this.pos] === '#') while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++
  }
  /** Spaces, comments and newlines (inside arrays). */
  skipAll(): void {
    for (;;) {
      const c = this.text[this.pos]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') this.pos++
      else if (c === '#') this.skipComment()
      else return
    }
  }
}

const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' }

function readValue(r: Reader): TomlValue {
  const start = r.pos
  const c = r.peek()
  if (c === undefined) return r.fail('missing value')
  if (r.text.startsWith("'''", r.pos)) {
    const end = r.text.indexOf("'''", r.pos + 3)
    if (end < 0) return r.fail('unterminated string', start)
    // A literal may end with up to two extra quotes right before the closing three.
    let close = end
    while (r.text[close + 3] === "'" && close - end < 2) close++
    let body = r.text.slice(r.pos + 3, close)
    r.pos = close + 3
    if (body.startsWith('\r\n')) body = body.slice(2)
    else if (body.startsWith('\n')) body = body.slice(1)
    return body
  }
  if (r.text.startsWith('"""', r.pos)) return r.fail('multi-line basic strings are not supported')
  if (c === "'") {
    const end = r.text.indexOf("'", r.pos + 1)
    const nl = r.text.indexOf('\n', r.pos)
    if (end < 0 || (nl >= 0 && nl < end)) return r.fail('unterminated string', start)
    const body = r.text.slice(r.pos + 1, end)
    r.pos = end + 1
    return body
  }
  if (c === '"') {
    let out = ''
    r.pos++
    for (;;) {
      const ch = r.text[r.pos]
      if (ch === undefined || ch === '\n') return r.fail('unterminated string', start)
      r.pos++
      if (ch === '"') return out
      if (ch === '\\') {
        const e = r.text[r.pos++]
        const mapped = e === undefined ? undefined : ESCAPES[e]
        if (mapped === undefined) return r.fail('unsupported escape', r.pos - 2)
        out += mapped
      } else out += ch
    }
  }
  if (c === '[') {
    r.pos++
    const items: TomlValue[] = []
    for (;;) {
      r.skipAll()
      const n = r.peek()
      if (n === undefined) return r.fail('unterminated array', start)
      if (n === ']') {
        r.pos++
        return items
      }
      items.push(readValue(r))
      r.skipAll()
      if (r.peek() === ',') r.pos++
      else if (r.peek() !== ']') return r.fail('unterminated array or missing comma', r.pos)
    }
  }
  const m = /^(?:true|false|-?\d+(?:\.\d+)?)(?![\w.:-])/.exec(r.text.slice(r.pos, r.pos + 40))
  if (!m) return r.fail('unsupported value', start)
  r.pos += m[0].length
  return m[0] === 'true' ? true : m[0] === 'false' ? false : Number(m[0])
}

function descend(root: TomlTable, names: string[], r: Reader, at: number, createLast: 'table' | 'array'): TomlTable {
  let cur = root
  names.forEach((name, i) => {
    const last = i === names.length - 1
    const existing = cur[name]
    if (last && createLast === 'array') {
      if (existing === undefined) {
        const t: TomlTable = {}
        cur[name] = [t]
        cur = t
      } else if (Array.isArray(existing)) {
        const t: TomlTable = {}
        existing.push(t)
        cur = t
      } else r.fail(`${name} is not an array of tables`, at)
      return
    }
    if (existing === undefined) {
      const t: TomlTable = {}
      cur[name] = t
      cur = t
    } else if (Array.isArray(existing)) {
      const tail = existing[existing.length - 1]
      if (typeof tail !== 'object' || tail === null || Array.isArray(tail)) r.fail(`${name} is not a table`, at)
      cur = tail as TomlTable
    } else if (typeof existing === 'object') cur = existing
    else r.fail(`${name} is not a table`, at)
  })
  return cur
}

export function parseToml(text: string): TomlTable {
  const r = new Reader(text)
  const root: TomlTable = {}
  let current = root
  while (r.pos < text.length) {
    r.skipAll()
    if (r.pos >= text.length) break
    const at = r.pos
    const c = r.peek()
    if (c === '[') {
      const isArray = text[r.pos + 1] === '['
      const open = isArray ? 2 : 1
      const close = isArray ? ']]' : ']'
      const end = text.indexOf(close, r.pos + open)
      const nl = text.indexOf('\n', r.pos)
      if (end < 0 || (nl >= 0 && nl < end)) r.fail('bad table header')
      const names = text.slice(r.pos + open, end).trim().split('.')
      if (names.some(n => !/^[A-Za-z0-9_-]+$/.test(n))) r.fail('bad table name')
      r.pos = end + close.length
      current = descend(root, names, r, at, isArray ? 'array' : 'table')
    } else {
      const m = /^([A-Za-z0-9_-]+)[ \t]*=[ \t]*/.exec(text.slice(r.pos, r.pos + 80))
      if (!m) throw r.fail('expected key = value')
      const key = m[1] as string
      r.pos += m[0].length
      if (key in current) r.fail(`duplicate key ${key}`, at)
      current[key] = readValue(r)
    }
    r.skipBlank()
    r.skipComment()
    const tail = r.peek()
    if (tail !== undefined && tail !== '\n' && tail !== '\r') r.fail('unexpected text after value')
  }
  return root
}
