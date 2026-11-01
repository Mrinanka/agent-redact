// Aho-Corasick: finds every occurrence of many words in one pass over the text.
//
// Case folding is ASCII only and per UTF-16 unit, so the text is never lowercased
// as a whole (some characters change length) and offsets are always the caller's.
// The automaton is a full table (states x distinct units), built once. It
// is no longer reused: src/core/matcher.ts keeps flat arrays instead (D-043).
const fold = (u) => (u >= 0x41 && u <= 0x5a ? u + 32 : u);
export class Aho {
    classOf = new Map();
    classes = 1; // class 0 is "a unit no word uses"
    table = new Int32Array(0);
    lengths;
    // For each state: head of a list of words ending there (word index + 1), and links.
    head = new Int32Array(0);
    next = new Int32Array(0);
    wordOf = new Int32Array(0);
    words;
    /** Fast path for text units below 128. */
    ascii = new Int32Array(128);
    constructor(words) {
        this.words = words;
        this.lengths = words.map(w => w.length);
        const trie = [new Map()];
        const ends = [[]];
        words.forEach((w, index) => {
            let s = 0;
            for (let i = 0; i < w.length; i++) {
                const u = fold(w.charCodeAt(i));
                if (!this.classOf.has(u))
                    this.classOf.set(u, this.classes++);
                const c = this.classOf.get(u);
                let to = trie[s].get(c);
                if (to === undefined) {
                    to = trie.length;
                    trie.push(new Map());
                    ends.push([]);
                    trie[s].set(c, to);
                }
                s = to;
            }
            if (w.length > 0)
                ends[s].push(index);
        });
        for (const [u, c] of this.classOf) {
            if (u >= 128)
                continue;
            this.ascii[u] = c;
            if (u >= 0x61 && u <= 0x7a)
                this.ascii[u - 32] = c;
        }
        const states = trie.length;
        const K = this.classes;
        const table = new Int32Array(states * K);
        const fail = new Int32Array(states);
        const queue = [];
        for (const [c, to] of trie[0]) {
            table[c] = to;
            queue.push(to);
        }
        for (let q = 0; q < queue.length; q++) {
            const s = queue[q];
            for (let c = 1; c < K; c++) {
                const to = trie[s].get(c);
                if (to === undefined)
                    table[s * K + c] = table[fail[s] * K + c];
                else {
                    fail[to] = table[fail[s] * K + c];
                    table[s * K + c] = to;
                    queue.push(to);
                }
            }
        }
        // Output lists: a state's own words, then those of its failure state.
        const head = new Int32Array(states);
        // Build as arrays of word indexes per state, then a flat linked list.
        const all = ends.map(e => [...e]);
        for (const s of queue)
            all[s] = [...ends[s], ...all[fail[s]]];
        const flatWords = [];
        const flatNext = [];
        for (let s = 0; s < states; s++) {
            let h = 0;
            for (const w of all[s]) {
                flatWords.push(w);
                flatNext.push(h);
                h = flatWords.length;
            }
            head[s] = h;
        }
        this.table = table;
        this.head = head;
        this.wordOf = Int32Array.from(flatWords);
        this.next = Int32Array.from(flatNext);
    }
    get size() {
        return this.words.length;
    }
    /** Calls `onHit(wordIndex, endOffset)` for every occurrence; endOffset is exclusive. */
    search(text, onHit) {
        if (this.words.length === 0)
            return;
        const K = this.classes;
        const { table, head, next, wordOf, ascii, classOf } = this;
        let s = 0;
        for (let i = 0; i < text.length; i++) {
            const u = text.charCodeAt(i);
            const c = u < 128 ? ascii[u] : (classOf.get(u) ?? 0);
            s = table[s * K + c];
            let h = head[s];
            while (h !== 0) {
                onHit(wordOf[h - 1], i + 1);
                h = next[h - 1];
            }
        }
    }
    /** The length of a word, so a caller can turn an end offset into a start. */
    lengthOf(word) {
        return this.lengths[word];
    }
}
