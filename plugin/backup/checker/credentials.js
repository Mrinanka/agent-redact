// Credentials in request headers and on command lines (spec §7.1). Hand-written like
// the label scanner, with no regex to get stuck on: every loop moves forward and every
// look-ahead is bounded. The scheme word and the flag stay visible; only the value hides.
import { isPlaceholder, isVariableRef, looksRandom } from './harmless.js';
import { parseValue } from './labels.js';
const SCHEMES = new Set(['bearer', 'basic', 'token']);
const MIN_CREDENTIAL = 8;
const MAX_COMMAND_LOOK = 512;
const isSpace = (c) => c === 0x20 || c === 0x09;
const isQuote = (c) => c === 0x22 || c === 0x27 || c === 0x60;
const isAlnum = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
function skipSpaces(text, from, lineEnd) {
    let i = from;
    while (i < lineEnd && isSpace(text.charCodeAt(i)))
        i++;
    return i;
}
/** Skips a quote, escaped or not, if there is one here. */
function skipQuote(text, i) {
    if (isQuote(text.charCodeAt(i)))
        return i + 1;
    if (text.charCodeAt(i) === 0x5c && isQuote(text.charCodeAt(i + 1)))
        return i + 2;
    return i;
}
const isReference = (v) => isPlaceholder(v) || isVariableRef(v) || /^\{[\w.]+\}$/.test(v);
/** The value at `at`, cut at any quote or backslash that closes the string around it. */
function credentialAt(text, at, lineEnd) {
    if (at >= lineEnd || isQuote(text.charCodeAt(at)))
        return null;
    const p = parseValue(text, at, lineEnd);
    let end = p.start;
    while (end < p.end && !isQuote(text.charCodeAt(end)) && text.charCodeAt(end) !== 0x5c)
        end++;
    return end > p.start ? { start: p.start, end } : null;
}
/** `Authorization: Bearer value`, `Basic value`, `Token value`, or a bare generated value. */
export function checkAuthHeader(text, end, lineEnd) {
    let i = skipQuote(text, end);
    i = skipSpaces(text, i, lineEnd);
    const sep = text.charCodeAt(i);
    if (sep !== 0x3a && sep !== 0x3d)
        return null;
    i = skipQuote(text, skipSpaces(text, i + 1, lineEnd));
    const first = credentialAt(text, i, lineEnd);
    if (!first)
        return null;
    const word = text.slice(first.start, first.end);
    if (!SCHEMES.has(word.toLowerCase()))
        return looksRandom(word) && !isReference(word) ? first : null;
    const value = credentialAt(text, skipSpaces(text, first.end, lineEnd), lineEnd);
    if (!value || value.end - value.start < MIN_CREDENTIAL)
        return null;
    return isReference(text.slice(value.start, value.end)) ? null : value;
}
/** `Bearer value` with no header word: only a value that looks generated, as prose says "bearer token". */
export function checkBearer(text, start, end, lineEnd) {
    if (start > 0 && isAlnum(text.charCodeAt(start - 1)))
        return null;
    if (!isSpace(text.charCodeAt(end)))
        return null;
    const value = credentialAt(text, skipSpaces(text, end, lineEnd), lineEnd);
    if (!value)
        return null;
    const v = text.slice(value.start, value.end);
    return looksRandom(v) && !isReference(v) ? value : null;
}
/**
 * The password flag of the commands that take one attached: `mysql -pvalue`,
 * `mariadb -p'value'`, `sshpass -pvalue`, `sshpass -p value`. Only these commands:
 * `-p` means a port or a parent folder nearly everywhere else.
 */
export function checkCommandPassword(text, start, end, lineEnd) {
    if (start > 0 && isAlnum(text.charCodeAt(start - 1)))
        return null;
    const spaced = text.slice(start, end).toLowerCase() === 'sshpass';
    const limit = Math.min(lineEnd, end + MAX_COMMAND_LOOK);
    for (let k = end; k + 2 < limit; k++) {
        const c = text.charCodeAt(k);
        // The command ends at a pipe or a separator: `mysql ... | mkdir -p8`
        if (c === 0x7c || c === 0x3b || c === 0x26)
            return null;
        if (!isSpace(c) || text.charCodeAt(k + 1) !== 0x2d || text.charCodeAt(k + 2) !== 0x70)
            continue;
        const after = k + 3;
        const attached = after < lineEnd && !isSpace(text.charCodeAt(after)) && text.charCodeAt(after) !== 0x0d;
        if (!attached && !spaced)
            return null; // a bare -p asks for the password at a prompt
        const at = attached ? after : skipSpaces(text, after, lineEnd);
        if (at >= lineEnd)
            return null;
        const p = parseValue(text, at, lineEnd);
        if (p.end <= p.start || isReference(text.slice(p.start, p.end)))
            return null;
        return { start: p.start, end: p.end };
    }
    return null;
}
