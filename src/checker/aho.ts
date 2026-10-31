// Aho-Corasick: finds every occurrence of many words in one pass over the text.
//
// Case folding is ASCII only and per UTF-16 unit, so the text is never lowercased
// as a whole (some characters change length) and offsets are always the caller's.
// The automaton is a full table (states x distinct units), built once. It
// is no longer reused: src/core/matcher.ts keeps flat arrays instead (D-043).

const fold = (u: number): number => (u >= 0x41 && u <= 0x5a ? u + 32 : u)

export class Aho {
  private readonly classOf = new Map<number, number>()
  private classes = 1 // class 0 is "a unit no word uses"
  private table: Int32Array = new Int32Array(0)
  private readonly lengths: number[]
  // For each state: head of a list of words ending there (word index + 1), and links.
  private head: Int32Array = new Int32Array(0)
  private next: Int32Array = new Int32Array(0)
  private wordOf: Int32Array = new Int32Array(0)
  private readonly words: string[]
  /** Fast path for text units below 128. */
  private readonly ascii = new Int32Array(128)

  constructor(words: string[]) {
    this.words = words
    this.lengths = words.map(w => w.length)
    const trie: Map<number, number>[] = [new Map()]
    const ends: number[][] = [[]]
    words.forEach((w, index) => {
      let s = 0
      for (let i = 0; i < w.length; i++) {
        const u = fold(w.charCodeAt(i))
        if (!this.classOf.has(u)) this.classOf.set(u, this.classes++)
        const c = this.classOf.get(u) as number
        let to = (trie[s] as Map<number, number>).get(c)
        if (to === undefined) {
          to = trie.length
          trie.push(new Map())
          ends.push([])
          ;(trie[s] as Map<number, number>).set(c, to)
        }
        s = to
      }
      if (w.length > 0) (ends[s] as number[]).push(index)
    })
    for (const [u, c] of this.classOf) {
      if (u >= 128) continue
      this.ascii[u] = c
      if (u >= 0x61 && u <= 0x7a) this.ascii[u - 32] = c
    }
    const states = trie.length
    const K = this.classes
    const table = new Int32Array(states * K)
    const fail = new Int32Array(states)
    const queue: number[] = []
    for (const [c, to] of trie[0] as Map<number, number>) {
      table[c] = to
      queue.push(to)
    }
    for (let q = 0; q < queue.length; q++) {
      const s = queue[q] as number
      for (let c = 1; c < K; c++) {
        const to = (trie[s] as Map<number, number>).get(c)
        if (to === undefined) table[s * K + c] = table[(fail[s] as number) * K + c] as number
        else {
          fail[to] = table[(fail[s] as number) * K + c] as number
          table[s * K + c] = to
          queue.push(to)
        }
      }
    }
    // Output lists: a state's own words, then those of its failure state.
    const head = new Int32Array(states)
    // Build as arrays of word indexes per state, then a flat linked list.
    const all: number[][] = ends.map(e => [...e])
    for (const s of queue) all[s] = [...(ends[s] as number[]), ...(all[fail[s] as number] as number[])]
    const flatWords: number[] = []
    const flatNext: number[] = []
    for (let s = 0; s < states; s++) {
      let h = 0
      for (const w of all[s] as number[]) {
        flatWords.push(w)
        flatNext.push(h)
        h = flatWords.length
      }
      head[s] = h
    }
    this.table = table
    this.head = head
    this.wordOf = Int32Array.from(flatWords)
    this.next = Int32Array.from(flatNext)
  }

  get size(): number {
    return this.words.length
  }

  /** Calls `onHit(wordIndex, endOffset)` for every occurrence; endOffset is exclusive. */
  search(text: string, onHit: (word: number, end: number) => void): void {
    if (this.words.length === 0) return
    const K = this.classes
    const { table, head, next, wordOf, ascii, classOf } = this
    let s = 0
    for (let i = 0; i < text.length; i++) {
      const u = text.charCodeAt(i)
      const c = u < 128 ? (ascii[u] as number) : (classOf.get(u) ?? 0)
      s = table[s * K + c] as number
      let h = head[s] as number
      while (h !== 0) {
        onHit(wordOf[h - 1] as number, i + 1)
        h = next[h - 1] as number
      }
    }
  }

  /** The length of a word, so a caller can turn an end offset into a start. */
  lengthOf(word: number): number {
    return this.lengths[word] as number
  }
}
