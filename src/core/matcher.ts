// SecretMatcher: finds every occurrence of many words (a secret's forms) in one pass over the
// text (spec §18 step 3, D-043). The checker's `Aho` keeps a full table of states x distinct
// units, which for 10,000 secrets would need about 780 MB; this one keeps flat arrays with
// failure links, about 22 bytes per trie node.
//
// The automaton runs over text with ASCII letters folded, so a hex form matches in either
// case. Words that are case-sensitive are checked against the real text before a hit is
// reported. Units are UTF-16 code units, so a lone surrogate is matched like any other unit.

export type MatcherWord = {
  text: string
  /** Who the word belongs to (a secret's index); reported with each hit. */
  owner: number
  /** True: the text must match with its case. False: ASCII case is ignored. */
  exact: boolean
}

const fold = (u: number): number => (u >= 0x41 && u <= 0x5a ? u + 32 : u)

export class SecretMatcher {
  private readonly words: MatcherWord[]
  private readonly ownerOf: Int32Array
  private readonly lengthOf: Int32Array
  private readonly needsCheck: Uint8Array
  // Trie nodes. Node 0 is the root; 0 also means "none" for a child, sibling or link.
  private readonly unit: Uint16Array
  private readonly first: Int32Array
  private readonly sibling: Int32Array
  private readonly fail: Int32Array
  private readonly head: Int32Array // first word ending at a node, plus 1
  private readonly wordNext: Int32Array // next word ending at the same node, plus 1
  private readonly outLink: Int32Array // nearest node on the failure chain that ends a word
  private readonly rootNext = new Int32Array(128)
  private readonly nodes: number

  constructor(words: MatcherWord[]) {
    this.words = words
    const n = words.length
    this.ownerOf = new Int32Array(n)
    this.lengthOf = new Int32Array(n)
    this.needsCheck = new Uint8Array(n)
    let max = 1
    for (const w of words) max += w.text.length
    const unit = new Uint16Array(max)
    const first = new Int32Array(max)
    const sibling = new Int32Array(max)
    const head = new Int32Array(max)
    const wordNext = new Int32Array(n)
    const rootNext = this.rootNext
    let count = 1

    for (let i = 0; i < n; i++) {
      const w = words[i] as MatcherWord
      this.ownerOf[i] = w.owner
      this.lengthOf[i] = w.text.length
      if (w.text.length === 0) continue
      let exactNeeded = 0
      let node = 0
      for (let k = 0; k < w.text.length; k++) {
        const raw = w.text.charCodeAt(k)
        const u = fold(raw)
        if (w.exact && u !== raw) exactNeeded = 1
        else if (w.exact && u >= 0x61 && u <= 0x7a) exactNeeded = 1 // text may hold the upper-case letter
        let child = node === 0 && u < 128 ? (rootNext[u] as number) : 0
        if (child === 0 && !(node === 0 && u < 128)) {
          for (let c = first[node] as number; c !== 0; c = sibling[c] as number) {
            if (unit[c] === u) {
              child = c
              break
            }
          }
        }
        if (child === 0) {
          child = count++
          unit[child] = u
          sibling[child] = first[node] as number
          first[node] = child
          if (node === 0 && u < 128) rootNext[u] = child
        }
        node = child
      }
      this.needsCheck[i] = w.exact && exactNeeded ? 1 : 0
      wordNext[i] = head[node] as number
      head[node] = i + 1
    }

    // Failure links, breadth first.
    const fail = new Int32Array(count)
    const outLink = new Int32Array(count)
    const queue = new Int32Array(count)
    let qh = 0
    let qt = 0
    for (let c = first[0] as number; c !== 0; c = sibling[c] as number) queue[qt++] = c
    const childOf = (node: number, u: number): number => {
      if (node === 0 && u < 128) return rootNext[u] as number
      for (let c = first[node] as number; c !== 0; c = sibling[c] as number) if (unit[c] === u) return c
      return 0
    }
    while (qh < qt) {
      const v = queue[qh++] as number
      const f0 = fail[v] as number
      outLink[v] = (head[f0] as number) !== 0 ? f0 : (outLink[f0] as number)
      for (let c = first[v] as number; c !== 0; c = sibling[c] as number) {
        const u = unit[c] as number
        let f = f0
        let to = childOf(f, u)
        while (to === 0 && f !== 0) {
          f = fail[f] as number
          to = childOf(f, u)
        }
        fail[c] = to === c ? 0 : to
        queue[qt++] = c
      }
    }
    this.nodes = count
    this.unit = unit.slice(0, count)
    this.first = first.slice(0, count)
    this.sibling = sibling.slice(0, count)
    this.fail = fail
    this.head = head.slice(0, count)
    this.wordNext = wordNext
    this.outLink = outLink
  }

  get size(): number {
    return this.words.length
  }

  get nodeCount(): number {
    return this.nodes
  }

  /** Calls `onHit(owner, start, end)` for every occurrence; `end` is exclusive. */
  search(text: string, onHit: (owner: number, start: number, end: number) => void): void {
    if (this.nodes <= 1) return
    const { unit, first, sibling, fail, head, wordNext, outLink, rootNext, words, needsCheck, ownerOf, lengthOf } = this
    let s = 0
    for (let i = 0; i < text.length; i++) {
      const u = fold(text.charCodeAt(i))
      let to = 0
      for (;;) {
        if (s === 0 && u < 128) {
          to = rootNext[u] as number
        } else {
          for (let c = first[s] as number; c !== 0; c = sibling[c] as number) {
            if (unit[c] === u) {
              to = c
              break
            }
          }
        }
        if (to !== 0 || s === 0) break
        s = fail[s] as number
      }
      s = to
      let node = (head[s] as number) !== 0 ? s : (outLink[s] as number)
      while (node !== 0) {
        for (let w = head[node] as number; w !== 0; w = wordNext[w - 1] as number) {
          const word = w - 1
          const len = lengthOf[word] as number
          const start = i + 1 - len
          if (needsCheck[word] === 1 && !text.startsWith((words[word] as MatcherWord).text, start)) continue
          onHit(ownerOf[word] as number, start, i + 1)
        }
        node = outLink[node] as number
      }
    }
  }
}
