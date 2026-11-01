// Password labels (spec §7.1) and URL passwords, as a hand-written scanner. No
// regex, so there is nothing to get stuck on: every loop moves forward and every
// look-ahead is bounded.
//
// The checker finds label words with Aho-Corasick; this file decides, for one hit,
// whether a label, a separator and a value follow, and what part to hide.
import { isHarmless, isPlaceholder, isVariableRef, looksRandom } from './harmless.js';
const STRONG_SINGLE = ['password', 'passwd', 'pwd', 'pw', 'pass', 'secret', 'token', 'apikey', 'conn_str', 'connection_string'];
const STRONG_PAIRS = [['api', 'key'], ['private', 'key'], ['client', 'secret'], ['conn', 'str'], ['connection', 'string']];
const WEAK = ['key', 'auth', 'credential', 'access'];
// Short words stay out: they end ordinary words (`bypass`, `monkey`, `oauth`).
const SUFFIX = new Set(['password', 'passwd', 'secret', 'token', 'apikey']);
/** Every label word, in the spellings that differ only by the joining character. */
export const LABELS = (() => {
    const out = new Map();
    for (const w of STRONG_SINGLE)
        out.set(w, true);
    for (const [a, b] of STRONG_PAIRS)
        for (const j of ['', '_', '-', '.'])
            out.set(a + j + b, true);
    for (const w of WEAK)
        if (!out.has(w))
            out.set(w, false);
    return [...out].map(([word, strong]) => ({ word, strong, suffix: SUFFIX.has(word) }));
})();
const isDigit = (c) => c >= 0x30 && c <= 0x39;
const isLower = (c) => c >= 0x61 && c <= 0x7a;
const isUpper = (c) => c >= 0x41 && c <= 0x5a;
const isAlnum = (c) => isDigit(c) || isLower(c) || isUpper(c);
const isQuote = (c) => c === 0x22 || c === 0x27 || c === 0x60;
/** A label starts a name, or is the end part of one (`DB_PASSWORD`, `smtpPass`). */
function startsName(text, start, def) {
    if (start === 0 || def.suffix)
        return true;
    const p = text.charCodeAt(start - 1);
    if (!isAlnum(p))
        return true;
    // An escaped newline, return or tab: \npassword inside a JSON string.
    if ((p === 0x6e || p === 0x72 || p === 0x74) && text.charCodeAt(start - 2) === 0x5c)
        return true;
    return isUpper(text.charCodeAt(start)) && (isLower(p) || isDigit(p));
}
/** `--password`, `--db-password`: the label ends a long command-line flag. */
function isFlagName(text, start) {
    const low = Math.max(0, start - 64);
    let k = start;
    while (k > low) {
        const c = text.charCodeAt(k - 1);
        if (!isAlnum(c) && c !== 0x2d)
            break;
        k--;
    }
    return text.startsWith('--', k) && isAlnum(text.charCodeAt(k + 2));
}
const MAX_LOOK = 256;
const MAX_DECLARATION = 400;
const PROSE_WORD = /^[a-z]{6,}$/;
const PROSE_NEXT = /^ [A-Za-z]/;
/** `type Name<T> =`, with `export` and `declare` allowed in front: the head of a TypeScript type alias. */
const TYPE_ALIAS = /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?type[ \t]+[A-Za-z_$][\w$]*[ \t]*(?:<[^=\n]*>)?[ \t]*=/;
/** Whether the line the label is on is a type alias. Code whatever the file is called, so the value after it is no password. */
function onTypeAliasLine(text, at, lineEnd) {
    let s = at;
    const low = Math.max(0, at - MAX_DECLARATION);
    while (s > low && text.charCodeAt(s - 1) !== 0x0a)
        s--;
    if (s > 0 && text.charCodeAt(s - 1) !== 0x0a)
        return false;
    return TYPE_ALIAS.test(text.slice(s, Math.min(lineEnd, s + MAX_DECLARATION)));
}
/** Index of the first unescaped `code` in text[from, limit), or -1. */
function closingQuote(text, code, from, limit) {
    for (let k = from; k < limit; k++) {
        const c = text.charCodeAt(k);
        if (c === 0x5c)
            k++;
        else if (c === code)
            return k;
    }
    return -1;
}
/** Index of a \" that closes a value inside escaped JSON, or -1. Three backslashes are a quote in the value. */
function closingEscapedQuote(text, code, from, limit) {
    for (let k = from; k < limit; k++) {
        if (text.charCodeAt(k) !== 0x5c)
            continue;
        let run = 1;
        while (k + run < limit && text.charCodeAt(k + run) === 0x5c)
            run++;
        if (run === 1 && text.charCodeAt(k + 1) === code)
            return k;
        k += run;
    }
    return -1;
}
/** Index of `needle` in text[from, limit), or -1. Bounded, unlike indexOf. */
function findWithin(text, needle, from, limit) {
    const last = Math.min(limit, text.length) - needle.length;
    for (let k = from; k <= last; k++)
        if (text.startsWith(needle, k))
            return k;
    return -1;
}
const isTerminator = (c) => c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a || c === 0x3b || c === 0x2c || c === 0x26 || c === 0x29 || c === 0x5d || c === 0x7d;
export function parseValue(text, at, lineEnd) {
    const c = text.charCodeAt(at);
    if (isQuote(c)) {
        const close = closingQuote(text, c, at + 1, lineEnd);
        const end = close >= 0 ? close : trimCr(text, at + 1, lineEnd);
        return { start: at + 1, end, quoted: true, token: text.slice(at + 1, end), readTo: close >= 0 ? close + 1 : lineEnd };
    }
    if (c === 0x5c && at + 1 < lineEnd && isQuote(text.charCodeAt(at + 1))) {
        // An escaped quote, as in JSON inside a JSON string: \"value\"
        const close = closingEscapedQuote(text, text.charCodeAt(at + 1), at + 2, lineEnd);
        const end = close >= 0 ? close : trimCr(text, at + 2, lineEnd);
        return { start: at + 2, end, quoted: true, token: text.slice(at + 2, end), readTo: close >= 0 ? close + 2 : lineEnd };
    }
    let j = at;
    while (j < lineEnd) {
        const ch = text.charCodeAt(j);
        if (ch === 0x24 /* $ */ && text[j + 1] === '{') {
            const double = text[j + 2] === '{';
            const close = findWithin(text, double ? '}}' : '}', j + 2, Math.min(lineEnd, j + MAX_LOOK));
            if (close >= 0) {
                j = close + (double ? 2 : 1);
                continue;
            }
        }
        else if (ch === 0x7b /* { */ && text[j + 1] === '{') {
            const close = findWithin(text, '}}', j + 2, Math.min(lineEnd, j + MAX_LOOK));
            if (close >= 0) {
                j = close + 2;
                continue;
            }
        }
        if (isTerminator(ch))
            break;
        j++;
    }
    // The token for code shapes keeps brackets: up to a space, ;, comma or &.
    let t = j;
    while (t < lineEnd) {
        const ch = text.charCodeAt(t);
        if (ch === 0x20 || ch === 0x09 || ch === 0x0d || ch === 0x3b || ch === 0x2c || ch === 0x26)
            break;
        t++;
    }
    // An open call keeps going to its closing bracket: getToken(a, b)
    const limit = Math.min(lineEnd, at + MAX_LOOK);
    let depth = 0;
    for (let k = at; k < limit && (k < t || depth > 0); k++) {
        const ch = text.charCodeAt(k);
        if (ch === 0x28 || ch === 0x5b)
            depth++;
        else if (ch === 0x29 || ch === 0x5d)
            depth--;
        if (k >= t - 1)
            t = k + 1;
    }
    return { start: at, end: j, quoted: false, token: text.slice(at, Math.min(t, limit)), readTo: j };
}
function trimCr(text, from, lineEnd) {
    return lineEnd > from && text.charCodeAt(lineEnd - 1) === 0x0d ? lineEnd - 1 : lineEnd;
}
/**
 * Decides one label hit. `start`/`end` bound the label word in `text`.
 * `lineEnd` is where the line ends (the caller finds it once per line).
 * Returns the span of the value to hide, or null.
 */
export function checkLabel(text, start, end, def, file, lineEnd) {
    if (!startsName(text, start, def))
        return null;
    let i = end;
    // A closing quote of a quoted key: "password": or \"password\":
    if (isQuote(text.charCodeAt(i)))
        i++;
    else if (text.charCodeAt(i) === 0x5c && isQuote(text.charCodeAt(i + 1)))
        i += 2;
    while (i < lineEnd && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09))
        i++;
    // Separator: := => = :   ("==" and "::" are not separators)
    let sepColon = false;
    const c = text.charCodeAt(i);
    const n = text.charCodeAt(i + 1);
    if (c === 0x3a && n === 0x3d)
        i += 2;
    else if (c === 0x3d && n === 0x3e)
        i += 2;
    else if (c === 0x3d && n !== 0x3d)
        i += 1;
    else if (c === 0x3a && n !== 0x3a) {
        i += 1;
        sepColon = true;
    }
    else
        return checkFlagValue(text, start, end, i, def, file, lineEnd);
    while (i < lineEnd && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09))
        i++;
    if (i >= lineEnd)
        return null;
    const label = text.slice(start, end);
    let p = parseValue(text, i, lineEnd);
    // `password: string = "value"`: a type annotation, then the real value after "=".
    if (sepColon && !p.quoted && p.end > p.start) {
        const typed = text.slice(p.start, p.end);
        if (isHarmless(typed, { quoted: false, token: p.token, label, file })) {
            let k = p.end;
            while (k < lineEnd && (text.charCodeAt(k) === 0x20 || text.charCodeAt(k) === 0x09))
                k++;
            if (text.charCodeAt(k) === 0x3d && text.charCodeAt(k + 1) !== 0x3d && text.charCodeAt(k + 1) !== 0x3e) {
                k++;
                while (k < lineEnd && (text.charCodeAt(k) === 0x20 || text.charCodeAt(k) === 0x09))
                    k++;
                if (k < lineEnd)
                    p = parseValue(text, k, lineEnd);
            }
        }
    }
    if (p.end <= p.start)
        return null;
    const value = text.slice(p.start, p.end);
    const long = p.readTo - i > MAX_LOOK;
    const hold = () => (long ? { start: p.start, end: p.start, readTo: p.readTo, showHint: false } : null);
    // Prose: `token: signature mismatch`. After a colon, a plain lowercase word with another word right behind it
    // reads as a sentence (spec §7.2). A password in a config file ends its line or is followed by a comment.
    if (sepColon && !p.quoted && PROSE_WORD.test(value) && PROSE_NEXT.test(text.slice(p.end, p.end + 2)))
        return hold();
    // A quoted value is a value whatever the line says; anything else on a type alias line is code.
    if (!p.quoted && onTypeAliasLine(text, start, lineEnd))
        return hold();
    if (isHarmless(value, { quoted: p.quoted, token: p.token, label, file }))
        return hold();
    const wanted = def.strong ? value.length >= 6 : looksRandom(value);
    if (!wanted)
        return hold();
    return { start: p.start, end: p.end, readTo: p.readTo, showHint: false };
}
/** `--password value`, where a space is the separator. A plain lowercase word is prose: "the --password option". */
function checkFlagValue(text, start, end, at, def, file, lineEnd) {
    if (!def.strong || at === end || at >= lineEnd || text.charCodeAt(at) === 0x2d || !isFlagName(text, start))
        return null;
    const p = parseValue(text, at, lineEnd);
    const value = text.slice(p.start, p.end);
    if (value.length < 6 || (!p.quoted && /^[a-z]+$/.test(value)))
        return null;
    if (isHarmless(value, { quoted: p.quoted, token: p.token, label: text.slice(start, end), file }))
        return null;
    return { start: p.start, end: p.end, readTo: p.readTo, showHint: false };
}
const URL_STOP = new Set([0x2f, 0x3f, 0x23, 0x20, 0x09, 0x0a, 0x0d, 0x22, 0x27, 0x60, 0x3c, 0x3e]);
/** After "://": scheme://user:password@host. Returns the password span, or null. */
export function checkUrlPassword(text, afterSlashes) {
    let stop = afterSlashes;
    const limit = Math.min(text.length, afterSlashes + 512);
    let at = -1;
    while (stop < limit && !URL_STOP.has(text.charCodeAt(stop))) {
        if (text.charCodeAt(stop) === 0x40)
            at = stop;
        stop++;
    }
    if (at < 0)
        return null;
    let colon = -1;
    for (let k = afterSlashes; k < at; k++) {
        if (text.charCodeAt(k) === 0x3a) {
            colon = k;
            break;
        }
    }
    if (colon < 0)
        return null;
    const start = colon + 1;
    if (at - start < 6)
        return null;
    const pw = text.slice(start, at);
    if (isPlaceholder(pw) || isVariableRef(pw))
        return null;
    return { start, end: at };
}
