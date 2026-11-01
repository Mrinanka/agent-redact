// The decoder (spec §18 step 4): finds what looks encoded, decodes it into one buffer per
// layer, and keeps for every decoded character the span of the original text it came from.
// The caller runs the matcher and the checker over each layer's text and maps hits back
// with sourceSpan(). At most 3 layers (spec §18).
//
// What it looks for, all by hand (no regular expression runs over the text):
//   - base64 / base64url runs of 16 or more characters, including lines wrapped at one width,
//     indented or not. A run may start with a word that is not part of it (`id-QUJD...`), so it is
//     tried at all 4 alignments and after each of its first separators
//   - hex runs of 16 or more characters, at both alignments
//   - percent-escapes (%XX), in the whitespace-delimited token that holds one
//   - JSON escapes, in the line that holds one
//
// Decoded bytes are kept 1:1 as Latin-1 characters, so an offset is a byte. Runs that decode
// to under 256 bytes must be 85% printable (valid UTF-8 counts); longer ones have no gate, because
// a secret can sit inside binary filler (the `base64-block-2m` item in the speed set). Tries at
// any other alignment always pass the gate, or a large block would be decoded four times over.
export const MAX_LAYERS = 3;
const MIN_RUN = 16;
const SHORT_BYTES = 256;
const PRINTABLE_SHARE = 0.85;
const MAX_LAYER_UNITS = 8_000_000;
const CHECK_EVERY = 8192;
/** Longer runs are tried from their start and after their first separators only. */
const LONG_RUN = 256 * 1024;
const SEPARATOR_REACH = 64;
const MAX_SEPARATOR_TRIES = 4;
export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const B64 = new Int8Array(128).fill(-1);
const HEX = new Int8Array(128).fill(-1);
(() => {
    const set = (chars, value) => {
        for (let i = 0; i < chars.length; i++)
            B64[chars.charCodeAt(i)] = value(i);
    };
    set('ABCDEFGHIJKLMNOPQRSTUVWXYZ', i => i);
    set('abcdefghijklmnopqrstuvwxyz', i => 26 + i);
    set('0123456789', i => 52 + i);
    B64[0x2b] = 62; // +
    B64[0x2d] = 62; // -
    B64[0x2f] = 63; // /
    B64[0x5f] = 63; // _
    for (let i = 0; i < 10; i++)
        HEX[0x30 + i] = i;
    for (let i = 0; i < 6; i++) {
        HEX[0x61 + i] = 10 + i;
        HEX[0x41 + i] = 10 + i;
    }
})();
const b64Value = (c) => (c < 128 ? B64[c] : -1);
const hexValue = (c) => (c < 128 ? HEX[c] : -1);
/** Growable output: characters and the original span of each. */
class Out {
    units = new Uint16Array(4096);
    start = new Int32Array(4096);
    end = new Int32Array(4096);
    n = 0;
    grow() {
        const size = this.units.length * 2;
        const u = new Uint16Array(size);
        u.set(this.units);
        const s = new Int32Array(size);
        s.set(this.start);
        const e = new Int32Array(size);
        e.set(this.end);
        this.units = u;
        this.start = s;
        this.end = e;
    }
    push(unit, s, e) {
        if (this.n === this.units.length)
            this.grow();
        this.units[this.n] = unit;
        this.start[this.n] = s;
        this.end[this.n] = e;
        this.n++;
    }
    toLayer() {
        let text = '';
        for (let i = 0; i < this.n; i += 8192)
            text += String.fromCharCode(...this.units.subarray(i, Math.min(this.n, i + 8192)));
        return { text, start: this.start.slice(0, this.n), end: this.end.slice(0, this.n) };
    }
}
const isPrintable = (b) => (b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d;
/** How many of the bytes are printable, a whole valid UTF-8 sequence counting as printable. */
function printableBytes(units, from, to) {
    let count = 0;
    for (let i = from; i < to;) {
        const b = units[i];
        if (b < 0x80) {
            if (isPrintable(b))
                count++;
            i++;
            continue;
        }
        const extra = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0;
        let valid = extra > 0 && i + extra < to;
        for (let k = 1; valid && k <= extra; k++)
            valid = (units[i + k] & 0xc0) === 0x80;
        if (valid) {
            count += extra + 1;
            i += extra + 1;
        }
        else
            i++;
    }
    return count;
}
/** Whether the bytes just written (from `mark`) pass the gate; if not, they are taken back. */
function keepOrRollback(out, mark, always = false) {
    const count = out.n - mark;
    if (always || count < SHORT_BYTES) {
        if (printableBytes(out.units, mark, out.n) < count * PRINTABLE_SHARE) {
            out.n = mark;
            return false;
        }
    }
    return true;
}
class Run {
    late = false;
    deadline;
    constructor(deadline) {
        this.deadline = deadline;
    }
    /** Called now and then from long loops. */
    tick() {
        if (this.late)
            return true;
        if (now() >= this.deadline)
            this.late = true;
        return this.late;
    }
}
function findBase64Runs(text, run) {
    const runs = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        if ((i & (CHECK_EVERY - 1)) === 0 && run.tick())
            break;
        const c = text.charCodeAt(i);
        if (b64Value(c) < 0) {
            i++;
            continue;
        }
        const s = i;
        while (i < n && b64Value(text.charCodeAt(i)) >= 0)
            i++;
        const e = i;
        let padEnd = e;
        while (padEnd < n && padEnd - e < 2 && text.charCodeAt(padEnd) === 0x3d)
            padEnd++;
        if (e - s >= MIN_RUN) {
            let ls = s;
            while (ls > 0 && (text.charCodeAt(ls - 1) === 0x20 || text.charCodeAt(ls - 1) === 0x09))
                ls--;
            const before = ls === 0 ? 0x0a : text.charCodeAt(ls - 1);
            const after = padEnd >= n ? 0x0a : text.charCodeAt(padEnd);
            runs.push({ s, e, padEnd, whole: (before === 0x0a || before === 0x0d) && (after === 0x0a || after === 0x0d), indent: s - ls });
        }
        // Skip a padding run, which is not part of another run.
        i = Math.max(i, padEnd);
    }
    return runs;
}
function eolLength(text, at) {
    const c = text.charCodeAt(at);
    if (c === 0x0a)
        return 1;
    if (c === 0x0d && text.charCodeAt(at + 1) === 0x0a)
        return 2;
    return 0;
}
/** Decodes the runs joined as one stream of base64 characters, leaving out the first `skip`. */
function decodeBase64(text, runs, skip, out, src, scratch) {
    let total = -skip;
    for (const r of runs)
        total += r.e - r.s;
    if (total < MIN_RUN)
        return;
    if (scratch.idx.length < total)
        scratch.idx = new Int32Array(Math.max(total, scratch.idx.length * 2));
    const idx = scratch.idx;
    const bytes = Math.floor((total * 6) / 8);
    if (bytes === 0)
        return;
    const mark = out.n;
    let k = 0;
    let acc = 0;
    let bits = 0;
    let produced = 0;
    let left = skip;
    for (let r = 0; r < runs.length && produced < bytes; r++) {
        const run = runs[r];
        for (let p = run.s; p < run.e; p++) {
            if (left > 0) {
                left--;
                continue;
            }
            idx[k] = p;
            acc = (acc << 6) | b64Value(text.charCodeAt(p));
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                const byte = (acc >> bits) & 0xff;
                acc &= (1 << bits) - 1;
                // Byte b covers characters floor(4b/3) .. floor((8b+7)/6).
                const b = produced++;
                const cs = Math.floor((b * 4) / 3);
                const ce = k; // the character that completed this byte
                out.push(byte, src.start(idx[cs]), src.end(idx[ce] + 1));
            }
            k++;
        }
    }
    if (keepOrRollback(out, mark, skip !== 0))
        out.push(0x0a, src.end(runs[0].e), src.end(runs[0].e));
}
/** Where to start decoding a run: every alignment, and just past each of its first separators. */
function startsOf(text, run) {
    const starts = new Set(run.e - run.s <= LONG_RUN ? [0, 1, 2, 3] : [0]);
    const reach = Math.min(run.e, run.s + SEPARATOR_REACH);
    let tries = 0;
    for (let p = run.s; p < reach && tries < MAX_SEPARATOR_TRIES; p++) {
        const c = text.charCodeAt(p);
        if (c === 0x2d || c === 0x5f || c === 0x2f || c === 0x2b) {
            starts.add(p - run.s + 1);
            tries++;
        }
    }
    return [...starts];
}
/** The short last line of a wrapped block, too short to be a run of its own. */
function shortTail(text, last, indent) {
    if (last.padEnd !== last.e)
        return undefined;
    const eol = eolLength(text, last.e);
    if (eol === 0)
        return undefined;
    const s = last.e + eol + indent;
    for (let p = last.e + eol; p < s; p++) {
        const c = text.charCodeAt(p);
        if (c !== 0x20 && c !== 0x09)
            return undefined;
    }
    let e = s;
    while (e < text.length && e - s < MIN_RUN && b64Value(text.charCodeAt(e)) >= 0)
        e++;
    if (e === s || e - s >= MIN_RUN)
        return undefined;
    let padEnd = e;
    while (padEnd < text.length && padEnd - e < 2 && text.charCodeAt(padEnd) === 0x3d)
        padEnd++;
    if (padEnd < text.length && eolLength(text, padEnd) === 0)
        return undefined;
    return { s, e, padEnd, whole: true, indent };
}
function scanBase64(text, out, src, run) {
    const runs = findBase64Runs(text, run);
    const scratch = { idx: new Int32Array(1024) };
    let r = 0;
    while (r < runs.length) {
        if (run.tick())
            return;
        const first = runs[r];
        let last = r;
        if (first.whole) {
            const width = first.e - first.s;
            // Lines of one width, the last one shorter or equal (MIME, PEM).
            while (last + 1 < runs.length) {
                const prev = runs[last];
                const next = runs[last + 1];
                const prevWidth = prev.e - prev.s;
                if (!next.whole || prevWidth !== width || prev.padEnd !== prev.e)
                    break;
                const eol = eolLength(text, prev.padEnd);
                if (eol === 0 || prev.padEnd + eol + first.indent !== next.s || next.indent !== first.indent || next.e - next.s > width)
                    break;
                last++;
            }
        }
        const block = runs.slice(r, last + 1);
        if (first.whole) {
            const tail = shortTail(text, block.at(-1), first.indent);
            if (tail)
                block.push(tail);
        }
        for (const skip of startsOf(text, first)) {
            if (run.tick())
                return;
            decodeBase64(text, block, skip, out, src, scratch);
        }
        r = last + 1;
    }
}
// ---- hex -----------------------------------------------------------------------------
function scanHex(text, out, src, run) {
    const n = text.length;
    let i = 0;
    while (i < n) {
        if ((i & (CHECK_EVERY - 1)) === 0 && run.tick())
            return;
        if (hexValue(text.charCodeAt(i)) < 0) {
            i++;
            continue;
        }
        const s = i;
        while (i < n && hexValue(text.charCodeAt(i)) >= 0)
            i++;
        const len = i - s;
        if (len < MIN_RUN)
            continue;
        for (const skip of [0, 1]) {
            if (len - skip < MIN_RUN)
                continue;
            const mark = out.n;
            for (let p = s + skip; p + 1 < i; p += 2) {
                const byte = (hexValue(text.charCodeAt(p)) << 4) | hexValue(text.charCodeAt(p + 1));
                out.push(byte, src.start(p), src.end(p + 2));
            }
            if (keepOrRollback(out, mark, skip !== 0))
                out.push(0x0a, src.end(i), src.end(i));
        }
    }
}
// ---- percent-escapes -------------------------------------------------------------------
const isDelimiter = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x22 || c === 0x27 || c === 0x3c || c === 0x3e || c === 0x60;
function scanPercent(text, out, src, run) {
    const n = text.length;
    let i = 0;
    while (i < n) {
        if ((i & (CHECK_EVERY - 1)) === 0 && run.tick())
            return;
        i = text.indexOf('%', i);
        if (i < 0)
            return;
        if (hexValue(text.charCodeAt(i + 1)) < 0 || hexValue(text.charCodeAt(i + 2)) < 0) {
            i++;
            continue;
        }
        let ts = i;
        while (ts > 0 && !isDelimiter(text.charCodeAt(ts - 1)))
            ts--;
        let te = i;
        while (te < n && !isDelimiter(text.charCodeAt(te)))
            te++;
        for (let p = ts; p < te;) {
            const c = text.charCodeAt(p);
            if (c === 0x25 && p + 2 < te && hexValue(text.charCodeAt(p + 1)) >= 0 && hexValue(text.charCodeAt(p + 2)) >= 0) {
                out.push((hexValue(text.charCodeAt(p + 1)) << 4) | hexValue(text.charCodeAt(p + 2)), src.start(p), src.end(p + 3));
                p += 3;
            }
            else {
                out.push(c, src.start(p), src.end(p + 1));
                p++;
            }
        }
        out.push(0x0a, src.end(te), src.end(te));
        i = te;
    }
}
// ---- JSON escapes ----------------------------------------------------------------------
function jsonEscapeAt(text, i) {
    const c = text.charCodeAt(i + 1);
    switch (c) {
        case 0x22: return { unit: 0x22, length: 2 };
        case 0x5c: return { unit: 0x5c, length: 2 };
        case 0x2f: return { unit: 0x2f, length: 2 };
        case 0x62: return { unit: 0x08, length: 2 };
        case 0x66: return { unit: 0x0c, length: 2 };
        case 0x6e: return { unit: 0x0a, length: 2 };
        case 0x72: return { unit: 0x0d, length: 2 };
        case 0x74: return { unit: 0x09, length: 2 };
        case 0x75: {
            let v = 0;
            for (let k = 2; k < 6; k++) {
                const h = hexValue(text.charCodeAt(i + k));
                if (h < 0)
                    return undefined;
                v = (v << 4) | h;
            }
            return { unit: v, length: 6 };
        }
        default: return undefined;
    }
}
function scanJson(text, out, src, run) {
    const n = text.length;
    let i = 0;
    while (i < n) {
        if (run.tick())
            return;
        i = text.indexOf('\\', i);
        if (i < 0)
            return;
        if (!jsonEscapeAt(text, i)) {
            i++;
            continue;
        }
        const ls = text.lastIndexOf('\n', i) + 1;
        let le = text.indexOf('\n', i);
        if (le < 0)
            le = n;
        for (let p = ls; p < le;) {
            if (((p - ls) & (CHECK_EVERY - 1)) === 0 && p > ls && run.tick())
                return;
            const esc = text.charCodeAt(p) === 0x5c ? jsonEscapeAt(text, p) : undefined;
            if (esc && p + esc.length <= le) {
                out.push(esc.unit, src.start(p), src.end(p + esc.length));
                p += esc.length;
            }
            else {
                out.push(text.charCodeAt(p), src.start(p), src.end(p + 1));
                p++;
            }
        }
        out.push(0x0a, src.end(le), src.end(le));
        i = le;
    }
}
// ---- layers ----------------------------------------------------------------------------
export function decodeLayers(original, options) {
    const maxLayers = options.maxLayers ?? MAX_LAYERS;
    const run = new Run(options.deadline);
    const layers = [];
    const cap = Math.max(MAX_LAYER_UNITS, original.length);
    let text = original;
    let base;
    let complete = true;
    for (let depth = 0; depth < maxLayers; depth++) {
        const src = base ? { start: i => base.start[i], end: j => base.end[j - 1] } : { start: i => i, end: j => j };
        const out = new Out();
        scanBase64(text, out, src, run);
        if (out.n < cap)
            scanHex(text, out, src, run);
        if (out.n < cap)
            scanPercent(text, out, src, run);
        if (out.n < cap)
            scanJson(text, out, src, run);
        if (out.n >= cap)
            complete = false;
        if (run.late)
            complete = false;
        if (out.n === 0)
            break;
        const layer = out.toLayer();
        layers.push(layer);
        if (!complete)
            break;
        text = layer.text;
        base = layer;
    }
    return { layers, complete };
}
/** The span of the original text for characters [s, e) of a layer's text. */
export function sourceSpan(layer, s, e) {
    return [layer.start[s], layer.end[Math.max(s, e - 1)]];
}
