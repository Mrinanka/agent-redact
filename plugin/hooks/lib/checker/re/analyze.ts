// Facts worked out from a parsed pattern, before it ever runs: the literals every
// match must contain (the keywords), the longest match, whether a match can span
// lines, and a bound on how hard the engine can work from one start position.
// Pure: nothing here runs a regex, so a bad custom pattern can be refused first.

import { complement, normalize, type Node, type Range } from './parse.ts'

/** An unbounded repeat is capped here; the emitter uses the same figure. */
export const CAP = 16384

export type Analysis = {
  minLen: number
  maxLen: number
  spansLines: boolean
  /** At least one repeat had no upper bound (and is capped at CAP). */
  unbounded: boolean
  /** Lowercased literals; every match contains at least one of them. Null if none usable. */
  keywords: string[] | null
  /** Rough steps the engine can take from one start position. */
  cost: number
  /** A repeat with a range of counts around a body of variable length. */
  nestedVariable: boolean
  /** A leading lazy repeat of a character set with a small maximum, e.g. [\w.-]{0,50}?. */
  leading: { max: number; node: Node } | null
}

const lower = (code: number): number => (code >= 0x41 && code <= 0x5a ? code + 32 : code)

export function foldRanges(ranges: Range[]): Range[] {
  const out: Range[] = [...ranges]
  for (const [lo, hi] of ranges) {
    const a = Math.max(lo, 0x41)
    const b = Math.min(hi, 0x5a)
    if (a <= b) out.push([a + 32, b + 32])
    const c = Math.max(lo, 0x61)
    const d = Math.min(hi, 0x7a)
    if (c <= d) out.push([c - 32, d - 32])
  }
  return normalize(out)
}

/** The characters a set node can match, with case folding applied. */
export function setRanges(node: Extract<Node, { t: 'set' }>): Range[] {
  const base = node.fold ? foldRanges(node.ranges) : normalize(node.ranges)
  return node.neg ? complement(base) : base
}

function alphabet(node: Node): Range[] {
  switch (node.t) {
    case 'char':
      return node.fold ? foldRanges([[node.c, node.c]]) : [[node.c, node.c]]
    case 'set':
      return setRanges(node)
    case 'cat':
    case 'alt':
      return normalize(node.items.flatMap(alphabet))
    case 'rep':
    case 'group':
      return alphabet(node.node)
    case 'assert':
      return []
  }
}

const overlaps = (a: Range[], b: Range[]): boolean => a.some(([lo, hi]) => b.some(([x, y]) => lo <= y && x <= hi))

function widths(node: Node, cap: number): [number, number] {
  switch (node.t) {
    case 'char':
    case 'set':
      return [1, 1]
    case 'assert':
      return [0, 0]
    case 'group':
      return widths(node.node, cap)
    case 'cat': {
      let min = 0
      let max = 0
      for (const item of node.items) {
        const [a, b] = widths(item, cap)
        min += a
        max += b
      }
      return [min, max]
    }
    case 'alt': {
      const w = node.items.map(i => widths(i, cap))
      return [Math.min(...w.map(x => x[0])), Math.max(...w.map(x => x[1]))]
    }
    case 'rep': {
      const [a, b] = widths(node.node, cap)
      const top = node.max === Infinity ? cap : node.max
      return [a * node.min, b * top]
    }
  }
}

function hasNewline(node: Node): boolean {
  switch (node.t) {
    case 'char':
      return node.c === 0x0a
    case 'set':
      return setRanges(node).some(([lo, hi]) => lo <= 0x0a && 0x0a <= hi)
    case 'cat':
    case 'alt':
      return node.items.some(hasNewline)
    case 'rep':
    case 'group':
      return hasNewline(node.node)
    case 'assert':
      return false
  }
}

function isUnbounded(node: Node): boolean {
  switch (node.t) {
    case 'cat':
    case 'alt':
      return node.items.some(isUnbounded)
    case 'rep':
      return node.max === Infinity || isUnbounded(node.node)
    case 'group':
      return isUnbounded(node.node)
    default:
      return false
  }
}

// ---- cost -----------------------------------------------------------------------

const COST_LIMIT = 1e12

// A group of a sequence is part of the surrounding sequence, as far as adjacency goes.
function flatten(items: Node[]): Node[] {
  return items.flatMap(item => {
    let n = item
    while (n.t === 'group') n = n.node
    return n.t === 'cat' ? flatten(n.items) : [item]
  })
}

function cost(node: Node, flags: { nested: boolean; cap: number }): number {
  switch (node.t) {
    case 'char':
    case 'set':
    case 'assert':
      return 1
    case 'group':
      return cost(node.node, flags)
    case 'alt': {
      // Branches are tried one after another, but only one compounds with what follows.
      const costs = node.items.map(item => cost(item, flags))
      return Math.min(COST_LIMIT, Math.max(...costs) + costs.length)
    }
    case 'rep': {
      const body = cost(node.node, flags)
      const [minW, maxW] = widths(node.node, flags.cap)
      const top = node.max === Infinity ? flags.cap : node.max
      const range = top - node.min + 1
      if (minW === maxW) return Math.min(COST_LIMIT, range * body)
      if (node.min === node.max) return Math.min(COST_LIMIT, Math.pow(body + 1, node.min))
      // An optional part (at most once) adds one alternative; it can't compound.
      if (node.max <= 1) return Math.min(COST_LIMIT, body + 1)
      flags.nested = true
      return COST_LIMIT
    }
    case 'cat': {
      let total = 0
      let run = 0
      let prev: Node | null = null
      for (const item of flatten(node.items)) {
        const c = cost(item, flags)
        const [a, b] = widths(item, flags.cap)
        if (a !== b) {
          if (prev !== null && overlaps(alphabet(prev), alphabet(item))) run = Math.min(COST_LIMIT, run * c)
          else {
            total += run
            run = c
          }
          prev = item
        } else {
          if (a > 0) {
            total += run
            run = 0
            prev = null
          }
          total += c
        }
      }
      return Math.min(COST_LIMIT, total + run)
    }
  }
}

// ---- required literals -----------------------------------------------------------

type Lits = { exact: string[] | null; req: string[] | null }

const MAX_EXACT = 64
const MAX_EXACT_LEN = 32

function exactChars(node: Extract<Node, { t: 'char' } | { t: 'set' }>): string[] | null {
  const ranges = node.t === 'char' ? alphabet(node) : setRanges(node)
  let n = 0
  for (const [lo, hi] of ranges) n += hi - lo + 1
  if (n > 4) return null
  const out = new Set<string>()
  for (const [lo, hi] of ranges) for (let c = lo; c <= hi; c++) out.add(String.fromCharCode(lower(c)))
  return [...out]
}

const noEmpty = (s: string[] | null): s is string[] => s !== null && s.length > 0 && s.every(x => x.length > 0)

function score(set: string[]): number {
  return Math.min(...set.map(s => s.length)) * 1000 - set.length
}

function best(cands: (string[] | null)[]): string[] | null {
  let out: string[] | null = null
  for (const c of cands) if (noEmpty(c) && (out === null || score(c) > score(out))) out = c
  return out
}

function product(a: string[], b: string[]): string[] | null {
  if (a.length * b.length > MAX_EXACT) return null
  const out = new Set<string>()
  for (const x of a) for (const y of b) out.add(x + y)
  const list = [...out]
  return list.some(s => s.length > MAX_EXACT_LEN) ? null : list
}

function lits(node: Node): Lits {
  switch (node.t) {
    case 'char':
    case 'set': {
      const e = exactChars(node)
      return { exact: e, req: e }
    }
    case 'assert':
      return { exact: [''], req: null }
    case 'group':
      return lits(node.node)
    case 'alt': {
      const parts = node.items.map(lits)
      const exact = parts.every(p => p.exact !== null) ? product([''], [...new Set(parts.flatMap(p => p.exact as string[]))]) : null
      const reqs = parts.map(p => (noEmpty(p.exact) ? p.exact : p.req))
      const req = reqs.every(r => noEmpty(r)) ? [...new Set(reqs.flatMap(r => r as string[]))] : null
      return { exact, req }
    }
    case 'rep': {
      const inner = lits(node.node)
      if (node.min === 0) return { exact: null, req: null }
      let exact: string[] | null = null
      if (node.min === node.max && inner.exact !== null) {
        exact = ['']
        for (let i = 0; i < node.min && exact !== null; i++) exact = product(exact, inner.exact)
      }
      return { exact, req: noEmpty(inner.exact) ? inner.exact : inner.req }
    }
    case 'cat': {
      let cur: string[] | null = ['']
      let broken = false
      const cands: (string[] | null)[] = []
      for (const item of node.items) {
        const l = lits(item)
        const next: string[] | null = cur !== null && l.exact !== null ? product(cur, l.exact) : null
        if (next !== null) {
          cur = next
          continue
        }
        // The run so far, and this item on its own, are each a requirement. Start again after it.
        broken = true
        cands.push(cur, l.req, l.exact)
        cur = ['']
      }
      cands.push(cur)
      return { exact: broken ? null : cur, req: best(cands) }
    }
  }
}

function leadingOf(node: Node): Analysis['leading'] {
  if (node.t !== 'cat') return null
  const first = node.items[0]
  if (first && first.t === 'rep' && first.lazy && first.min === 0 && first.max !== Infinity && first.max <= 100 && first.node.t === 'set' && node.items.length > 1) {
    return { max: first.max, node: first.node }
  }
  return null
}

/** The pattern without its leading lazy set repeat (see Analysis.leading). */
export function dropLeading(node: Node): Node {
  if (node.t !== 'cat') return node
  const rest = node.items.slice(1)
  return rest.length === 1 ? (rest[0] as Node) : { t: 'cat', items: rest }
}

export function analyze(node: Node, cap = CAP): Analysis {
  const [minLen, maxLen] = widths(node, cap)
  const flags = { nested: false, cap }
  const c = cost(node, flags)
  const l = lits(node)
  const keywords = best([noEmpty(l.exact) ? l.exact : null, l.req])
  return {
    minLen,
    maxLen,
    spansLines: hasNewline(node),
    unbounded: isUnbounded(node),
    keywords,
    cost: c,
    nestedVariable: flags.nested,
    leading: leadingOf(node),
  }
}
