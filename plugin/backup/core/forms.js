// The written forms of a secret that the matcher looks for (spec §7 check 5, §18 step 3):
// plain, JSON-escaped (once and twice, and with \u escapes), URL-encoded, the value's
// UTF-8 bytes as Latin-1 (what a decoder produces), hex, and base64 / base64url at the
// 3 alignments with the edge characters trimmed.
//
// No Node imports: this runs in the mod. TextEncoder is a web API the mod has.
/** Encoded forms shorter than this match too much ordinary text. */
export const MIN_ENCODED = 8;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ALPHABET_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const encoder = new TextEncoder();
export const utf8 = (s) => encoder.encode(s);
/** Each byte as one character, 0 to 255. */
export function bytesToLatin1(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 4096)
        out += String.fromCharCode(...bytes.subarray(i, i + 4096));
    return out;
}
/** The value's UTF-8 bytes as one character each: how a decoded buffer shows it. Same as the value for ASCII. */
export const utf8Latin1 = (s) => bytesToLatin1(utf8(s));
export function base64Encode(bytes, url) {
    const table = url ? ALPHABET_URL : ALPHABET;
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += table.charAt(n >> 18) + table.charAt((n >> 12) & 63) + table.charAt((n >> 6) & 63) + table.charAt(n & 63);
    }
    const left = bytes.length - i;
    if (left === 1) {
        const n = bytes[i] << 16;
        out += table.charAt(n >> 18) + table.charAt((n >> 12) & 63);
    }
    else if (left === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += table.charAt(n >> 18) + table.charAt((n >> 12) & 63) + table.charAt((n >> 6) & 63);
    }
    return out; // unpadded: the padding is not part of the value
}
/**
 * The characters of the base64 of `bytes` at byte offset `lead` that depend only on the
 * value: the edges, which mix in the bytes around it, are cut off. So this text appears
 * in the base64 of anything holding the value at that alignment.
 */
function base64Core(bytes, lead, url) {
    const padded = new Uint8Array(bytes.length + lead);
    padded.set(bytes, lead);
    const encoded = base64Encode(padded, url);
    const total = padded.length;
    const end = Math.floor(total / 3) * 4 + (total % 3);
    return encoded.slice(lead === 0 ? 0 : lead + 1, end);
}
const jsonOnce = (s) => JSON.stringify(s).slice(1, -1);
function hex4(unit) {
    return unit.toString(16).padStart(4, '0');
}
function percentLower(s) {
    return s.replace(/%[0-9A-F]{2}/g, m => m.toLowerCase());
}
export function formsOf(value) {
    if (value === '')
        return [];
    const bytes = utf8(value);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const url = encodeURIComponent(value);
    const once = jsonOnce(value);
    const candidates = [
        ['plain', value],
        ['json-escaped', once],
        ['json-escaped-twice', jsonOnce(once)],
        ['json-ascii', once.replace(/[\u0080-￿]/g, c => `\\u${hex4(c.charCodeAt(0))}`)],
        ['url', url],
        ['url-lower', percentLower(url)],
        ['url-plus', url.replace(/%20/g, '+')],
        ['url-strict', url.replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)],
        ['binary', bytesToLatin1(bytes)],
        ['hex', hex],
        ...[0, 1, 2].map((lead) => [`base64-${lead}`, base64Core(bytes, lead, false)]),
        ...[0, 1, 2].map((lead) => [`base64url-${lead}`, base64Core(bytes, lead, true)]),
    ];
    const seen = new Set();
    const out = [];
    for (const [form, text] of candidates) {
        if (text === '' || seen.has(text))
            continue;
        if (form !== 'plain' && text.length < MIN_ENCODED)
            continue;
        seen.add(text);
        out.push({ form, text, exact: form !== 'hex' });
    }
    return out;
}
/** Whether a form is a base64 form, whose hits widen to cover the trimmed edges. */
export const isBase64Form = (form) => form.startsWith('base64');
