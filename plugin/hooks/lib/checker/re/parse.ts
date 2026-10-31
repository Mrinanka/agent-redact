// Go RE2 regex syntax to a tree. Nothing here imports from Node, so it runs in the
// mod and under Node (guard test in tests/checker-guard.test.ts).
//
// Anything outside RE2, or RE2 syntax this checker doesn't support (Unicode
// classes, the m and U flags), throws a RegexError. The error names a position and
// a reason, never the pattern, so a secret-like pattern can't reach a log.

export type Range = [lo: number, hi: number]

export type Node =
  | { t: 'char'; c: number; fold: boolean }
  | { t: 'set'; ranges: Range[]; neg: boolean; fold: boolean }
  | { t: 'cat'; items: Node[] }
  | { t: 'alt'; items: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number; lazy: boolean }
  | { t: 'group'; node: Node; capture: number }
  | { t: 'assert'; kind: 'bol' | 'eol' | 'wordb' | 'nwordb' }

export class RegexError extends Error {
  readonly at: number
  constructor(message: string, at: number) {
    super(`${message} at ${at}`)
    this.name = 'RegexError'
    this.at = at
  }
}

/** The largest code unit the emitter handles. */
export const MAX_UNIT = 0xffff
/** RE2's limit on an explicit repeat count. */
const MAX_COUNT = 1000

const DIGIT: Range[] = [[0x30, 0x39]]
const WORD: Range[] = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]]
// Go's \s: tab, newline, form feed, carriage return, space. Not vertical tab, not Unicode spaces.
const SPACE: Range[] = [[0x09, 0x0a], [0x0c, 0x0d], [0x20, 0x20]]

const POSIX: Record<string, Range[]> = {
  alnum: [[0x30, 0x39], [0x41, 0x5a], [0x61, 0x7a]],
  alpha: [[0x41, 0x5a], [0x61, 0x7a]],
  ascii: [[0x00, 0x7f]],
  blank: [[0x09, 0x09], [0x20, 0x20]],
  cntrl: [[0x00, 0x1f], [0x7f, 0x7f]],
  digit: DIGIT,
  graph: [[0x21, 0x7e]],
  lower: [[0x61, 0x7a]],
  print: [[0x20, 0x7e]],
  punct: [[0x21, 0x2f], [0x3a, 0x40], [0x5b, 0x60], [0x7b, 0x7e]],
  space: [[0x09, 0x0d], [0x20, 0x20]],
  upper: [[0x41, 0x5a]],
  word: WORD,
  xdigit: [[0x30, 0x39], [0x41, 0x46], [0x61, 0x66]],
}

export function normalize(ranges: Range[]): Range[] {
  const sorted = ranges.map((r): Range => [r[0], r[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push(r)
  }
  return out
}

export function complement(ranges: Range[]): Range[] {
  const out: Range[] = []
  let next = 0
  for (const [lo, hi] of normalize(ranges)) {
    if (lo > next) out.push([next, lo - 1])
    next = hi + 1
  }
  if (next <= MAX_UNIT) out.push([next, MAX_UNIT])
  return out
}

type Flags = { i: boolean; s: boolean }

class Parser {
  readonly src: string
  pos = 0
  groups = 0
  constructor(src: string) {
    this.src = src
  }

  fail(message: string, at = this.pos): never {
    throw new RegexError(message, at)
  }

  more(): boolean {
    return this.pos < this.src.length
  }

  parseAlt(flags: Flags, depth: number): Node {
    const branches: Node[] = [this.parseCat(flags, depth)]
    while (this.src[this.pos] === '|') {
      this.pos++
      branches.push(this.parseCat(flags, depth))
    }
    return branches.length === 1 ? (branches[0] as Node) : { t: 'alt', items: branches }
  }

  // `flags` is mutated by a bare (?i), and so applies to the rest of the enclosing group.
  parseCat(flags: Flags, depth: number): Node {
    const items: Node[] = []
    while (this.more()) {
      const c = this.src[this.pos]
      if (c === '|' || c === ')') break
      const atom = this.parseAtom(flags, depth)
      if (atom === null) continue
      let node = atom
      const q = this.parseQuantifier()
      if (q !== null) {
        node = { t: 'rep', node, min: q.min, max: q.max, lazy: q.lazy }
        // RE2 rejects a repeat of a repeat written without a group: a**, a++, a{2}{3}
        const next = this.src[this.pos]
        if (next === '*' || next === '+' || next === '?' || (next === '{' && /^\{\d+(?:,\d*)?\}/.test(this.src.slice(this.pos)))) {
          this.fail('nested repetition', this.pos)
        }
      }
      items.push(node)
    }
    return items.length === 1 ? (items[0] as Node) : { t: 'cat', items }
  }

  parseQuantifier(): { min: number; max: number; lazy: boolean } | null {
    const c = this.src[this.pos]
    let min: number
    let max: number
    if (c === '*') (min = 0), (max = Infinity), this.pos++
    else if (c === '+') (min = 1), (max = Infinity), this.pos++
    else if (c === '?') (min = 0), (max = 1), this.pos++
    else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.src.slice(this.pos, this.pos + 24))
      if (!m) return null // a literal brace, as in RE2
      min = Number(m[1])
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3])
      if (min > MAX_COUNT || (max !== Infinity && max > MAX_COUNT)) this.fail('repeat count too large')
      if (max < min) this.fail('bad repeat range')
      this.pos += m[0].length
    } else return null
    let lazy = false
    if (this.src[this.pos] === '?') {
      lazy = true
      this.pos++
    }
    return { min, max, lazy }
  }

  parseAtom(flags: Flags, depth: number): Node | null {
    const at = this.pos
    const c = this.src[this.pos] as string
    switch (c) {
      case '(':
        return this.parseGroup(flags, depth)
      case '[':
        return this.parseClass(flags)
      case '.':
        this.pos++
        return flags.s ? { t: 'set', ranges: [], neg: true, fold: false } : { t: 'set', ranges: [[0x0a, 0x0a]], neg: true, fold: false }
      case '^':
        this.pos++
        return { t: 'assert', kind: 'bol' }
      case '$':
        this.pos++
        return { t: 'assert', kind: 'eol' }
      case '*':
      case '+':
      case '?':
        return this.fail('nothing to repeat', at)
      case '\\':
        return this.parseEscape(flags)
      default:
        this.pos++
        return this.literal(c.charCodeAt(0), flags, at)
    }
  }

  literal(code: number, flags: Flags, at: number): Node {
    if (code > MAX_UNIT) this.fail('character beyond the supported range', at)
    return { t: 'char', c: code, fold: flags.i }
  }

  parseGroup(flags: Flags, depth: number): Node | null {
    const at = this.pos
    if (depth > 64) this.fail('nested too deeply')
    this.pos++ // (
    let capture = 0
    const inner: Flags = { ...flags }
    if (this.src[this.pos] === '?') {
      const rest = this.src.slice(this.pos)
      const named = /^\?P?<([A-Za-z_][A-Za-z0-9_]*)>/.exec(rest)
      if (/^\?P?=|^\?!|^\?<[=!]/.test(rest)) this.fail('lookaround is not supported', at)
      if (named && !rest.startsWith('?<')) {
        // (?P<name>...)
        this.pos += named[0].length
        capture = ++this.groups
      } else if (named) {
        this.fail('this group syntax is not supported in RE2', at)
      } else {
        const f = /^\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(rest)
        if (!f) return this.fail('bad group syntax', at)
        const on = f[1] ?? ''
        const off = f[2] ?? ''
        const apply = (letters: string, value: boolean, target: Flags): void => {
          for (const l of letters) {
            if (l === 'i') target.i = value
            else if (l === 's') target.s = value
            else this.fail(`flag ${l} is not supported`, at)
          }
        }
        if (f[3] === ')') {
          // (?i) changes the flags for the rest of the enclosing group.
          apply(on, true, flags)
          apply(off, false, flags)
          this.pos += f[0].length
          return null
        }
        apply(on, true, inner)
        apply(off, false, inner)
        this.pos += f[0].length
      }
    } else capture = ++this.groups
    const node = this.parseAlt(inner, depth + 1)
    if (this.src[this.pos] !== ')') this.fail('missing closing parenthesis', at)
    this.pos++
    return { t: 'group', node, capture }
  }

  // Reads the escape after a backslash that stands for one character, or null.
  simpleEscape(e: string, at: number): number | null {
    switch (e) {
      case 'a':
        return 0x07
      case 'f':
        return 0x0c
      case 't':
        return 0x09
      case 'n':
        return 0x0a
      case 'r':
        return 0x0d
      case 'v':
        return 0x0b
      case 'x': {
        const rest = this.src.slice(this.pos)
        const m = /^\{([0-9A-Fa-f]{1,6})\}|^([0-9A-Fa-f]{2})/.exec(rest)
        if (!m) return this.fail('bad \\x escape', at)
        this.pos += m[0].length
        const code = parseInt((m[1] ?? m[2]) as string, 16)
        if (code > MAX_UNIT) this.fail('character beyond the supported range', at)
        return code
      }
      case '0':
        return 0
      default:
        if (/[A-Za-z0-9]/.test(e)) return null
        return e.charCodeAt(0)
    }
  }

  classEscape(e: string): Range[] | null {
    switch (e) {
      case 'd':
        return DIGIT
      case 'D':
        return complement(DIGIT)
      case 'w':
        return WORD
      case 'W':
        return complement(WORD)
      case 's':
        return SPACE
      case 'S':
        return complement(SPACE)
      default:
        return null
    }
  }

  parseEscape(flags: Flags): Node {
    const at = this.pos
    this.pos++ // backslash
    const e = this.src[this.pos]
    if (e === undefined) return this.fail('trailing backslash', at)
    this.pos++
    const cls = this.classEscape(e)
    if (cls) return { t: 'set', ranges: cls, neg: false, fold: false }
    switch (e) {
      case 'b':
        return { t: 'assert', kind: 'wordb' }
      case 'B':
        return { t: 'assert', kind: 'nwordb' }
      case 'A':
        return { t: 'assert', kind: 'bol' }
      case 'z':
        return { t: 'assert', kind: 'eol' }
      case 'p':
      case 'P':
        return this.fail('Unicode classes are not supported', at)
      case 'Q': {
        const end = this.src.indexOf('\\E', this.pos)
        const body = end < 0 ? this.src.slice(this.pos) : this.src.slice(this.pos, end)
        this.pos = end < 0 ? this.src.length : end + 2
        const items: Node[] = [...body].map(ch => this.literal(ch.charCodeAt(0), flags, at))
        return items.length === 1 ? (items[0] as Node) : { t: 'cat', items }
      }
    }
    if (/[1-9]/.test(e)) this.fail('backreferences are not supported', at)
    const code = this.simpleEscape(e, at)
    if (code === null) this.fail('unknown escape', at)
    return this.literal(code, flags, at)
  }

  parseClass(flags: Flags): Node {
    const at = this.pos
    this.pos++ // [
    let neg = false
    if (this.src[this.pos] === '^') {
      neg = true
      this.pos++
    }
    const ranges: Range[] = []
    let first = true
    for (;;) {
      const c = this.src[this.pos]
      if (c === undefined) return this.fail('missing closing bracket', at)
      if (c === ']' && !first) {
        this.pos++
        break
      }
      first = false
      if (c === '[' && this.src[this.pos + 1] === ':') {
        const m = /^\[:(\^?)([a-z]+):\]/.exec(this.src.slice(this.pos))
        if (m) {
          const set = POSIX[m[2] as string]
          if (!set) this.fail('unknown character class name', this.pos)
          ranges.push(...(m[1] ? complement(set) : set))
          this.pos += m[0].length
          continue
        }
      }
      const lo = this.classChar(at, ranges)
      if (lo === null) continue
      if (this.src[this.pos] === '-' && this.src[this.pos + 1] !== ']' && this.src[this.pos + 1] !== undefined) {
        this.pos++
        const hi = this.classChar(at, null)
        if (hi === null) return this.fail('bad range', this.pos)
        if (hi < lo) this.fail('bad range', this.pos)
        ranges.push([lo, hi])
      } else ranges.push([lo, lo])
    }
    return { t: 'set', ranges: normalize(ranges), neg, fold: flags.i }
  }

  // One class member. A class escape (\d) adds its ranges and returns null.
  classChar(classAt: number, into: Range[] | null): number | null {
    const at = this.pos
    const c = this.src[this.pos] as string
    this.pos++
    if (c !== '\\') {
      if (c.charCodeAt(0) > MAX_UNIT) this.fail('character beyond the supported range', at)
      return c.charCodeAt(0)
    }
    const e = this.src[this.pos]
    if (e === undefined) return this.fail('trailing backslash', classAt)
    this.pos++
    const cls = this.classEscape(e)
    if (cls) {
      if (into === null) this.fail('bad range', at)
      into.push(...cls)
      return null
    }
    if (e === 'p' || e === 'P') return this.fail('Unicode classes are not supported', at)
    if (e === 'b') return 0x08
    if (/[1-9]/.test(e)) return this.fail('unknown escape', at)
    const code = this.simpleEscape(e, at)
    if (code === null) return this.fail('unknown escape', at)
    return code
  }
}

export function parse(source: string): { node: Node; groups: number } {
  const p = new Parser(source)
  const node = p.parseAlt({ i: false, s: false }, 0)
  if (p.more()) p.fail('unmatched closing parenthesis')
  return { node, groups: p.groups }
}
