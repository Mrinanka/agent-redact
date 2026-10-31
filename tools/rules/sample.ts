// Random strings that match a parsed pattern, for tests only. Built at test time,
// never stored, so no whole key shape is ever written in the repo.

import { setRanges } from '../../src/checker/re/analyze.ts'
import type { Node } from '../../src/checker/re/parse.ts'

export type Rng = () => number

/** A small seeded generator (mulberry32), so a failing sample can be replayed. */
export function rng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pickInt = (r: Rng, n: number): number => Math.floor(r() * n)

function pickChar(node: Extract<Node, { t: 'set' }>, r: Rng): string {
  const ranges = setRanges(node)
  // Prefer printable ASCII, so samples read as text.
  const clipped = ranges
    .map(([lo, hi]): [number, number] => [Math.max(lo, 0x21), Math.min(hi, 0x7e)])
    .filter(([lo, hi]) => lo <= hi)
  const use = clipped.length > 0 ? clipped : ranges
  let total = 0
  for (const [lo, hi] of use) total += hi - lo + 1
  if (total === 0) return ' '
  let k = pickInt(r, total)
  for (const [lo, hi] of use) {
    const n = hi - lo + 1
    if (k < n) return String.fromCharCode(lo + k)
    k -= n
  }
  return ' '
}

export function sample(node: Node, r: Rng, extra = 6): string {
  switch (node.t) {
    case 'char': {
      const ch = String.fromCharCode(node.c)
      return node.fold && r() < 0.5 ? (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) : ch
    }
    case 'set':
      return pickChar(node, r)
    case 'assert':
      return ''
    case 'group':
      return sample(node.node, r, extra)
    case 'cat':
      return node.items.map(i => sample(i, r, extra)).join('')
    case 'alt':
      return sample(node.items[pickInt(r, node.items.length)] as Node, r, extra)
    case 'rep': {
      const top = Math.min(node.max === Infinity ? node.min + extra : node.max, node.min + extra)
      const n = node.min + pickInt(r, top - node.min + 1)
      let out = ''
      for (let i = 0; i < n; i++) out += sample(node.node, r, extra)
      return out
    }
  }
}
