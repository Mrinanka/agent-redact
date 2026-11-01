// A parsed pattern to JS regex source. The emitter writes out case folding and
// character classes itself, so the result needs no newer regex feature: no
// lookbehind, no named groups, no flags beyond a plain `i`.
//
// Go's `.` becomes [^\n]; Go's \s is the narrow set; `$` and `^` mean the ends
// of the text. All three are set by the parser, so here they are plain sets.
import { CAP, foldRanges, setRanges } from './analyze.js';
const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');
function unit(code) {
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a))
        return String.fromCharCode(code);
    return code < 0x100 ? `\\x${hex(code, 2)}` : `\\u${hex(code, 4)}`;
}
function classBody(ranges) {
    return ranges.map(([lo, hi]) => (lo === hi ? unit(lo) : hi === lo + 1 ? unit(lo) + unit(hi) : `${unit(lo)}-${unit(hi)}`)).join('');
}
const isLetter = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
/** What case folding means for the pattern as a whole. */
function foldUse(node, use) {
    switch (node.t) {
        case 'char':
            if (isLetter(node.c))
                node.fold ? (use.fold = true) : (use.exact = true);
            return;
        case 'set': {
            const letters = node.neg || node.ranges.some(([lo, hi]) => lo <= 0x7a && hi >= 0x41);
            if (letters)
                node.fold ? (use.fold = true) : (use.exact = true);
            return;
        }
        case 'cat':
        case 'alt':
            node.items.forEach(i => foldUse(i, use));
            return;
        case 'rep':
        case 'group':
            foldUse(node.node, use);
            return;
        case 'assert':
            return;
    }
}
const ASSERT = { bol: '^', eol: '$', wordb: '\\b', nwordb: '\\B' };
function atomic(node, ctx) {
    const s = out(node, ctx);
    return node.t === 'char' || node.t === 'set' || node.t === 'group' ? s : `(?:${s})`;
}
function out(node, ctx) {
    switch (node.t) {
        case 'char': {
            if (ctx.expand && node.fold && isLetter(node.c)) {
                const lo = node.c | 0x20;
                return `[${unit(lo - 32)}${unit(lo)}]`;
            }
            return unit(node.c);
        }
        case 'set': {
            const base = ctx.expand && node.fold ? foldRanges(node.ranges) : node.ranges;
            const ranges = ctx.expand && node.fold ? base : setRanges({ ...node, fold: false });
            if (node.neg) {
                const raw = ctx.expand && node.fold ? base : node.ranges;
                return raw.length === 0 ? '[^]' : `[^${classBody(raw)}]`;
            }
            return ranges.length === 0 ? '[]' : `[${classBody(ranges)}]`;
        }
        case 'assert':
            return ASSERT[node.kind];
        case 'group':
            return node.capture > 0 ? `(${out(node.node, ctx)})` : `(?:${out(node.node, ctx)})`;
        case 'cat':
            return node.items.map(i => (i.t === 'alt' ? `(?:${out(i, ctx)})` : out(i, ctx))).join('');
        case 'alt':
            return node.items.map(i => out(i, ctx)).join('|');
        case 'rep': {
            const top = node.max === Infinity ? ctx.cap : Math.min(node.max, ctx.cap);
            const min = Math.min(node.min, top);
            const q = node.min === 0 && top === 1 ? '?' : min === top ? `{${min}}` : `{${min},${top}}`;
            return `${atomic(node.node, ctx)}${q}${node.lazy ? '?' : ''}`;
        }
    }
}
export function emit(node, options) {
    const use = { fold: false, exact: false };
    foldUse(node, use);
    const cap = options.cap ?? CAP;
    if (use.fold && !use.exact)
        return { source: out(stripFold(node), { expand: false, cap }), flags: 'i' };
    return { source: out(node, { expand: use.fold, cap }), flags: '' };
}
// With the i flag the nodes are written as they are; fold marks play no part.
function stripFold(node) {
    switch (node.t) {
        case 'char':
            return { ...node, fold: false };
        case 'set':
            return { ...node, fold: false };
        case 'cat':
        case 'alt':
            return { ...node, items: node.items.map(stripFold) };
        case 'rep':
        case 'group':
            return { ...node, node: stripFold(node.node) };
        case 'assert':
            return node;
    }
}
