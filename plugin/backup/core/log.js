// The log (spec §16, R-12, R-17). One JSON line per event: when, what fired, where, what was done,
// and the random tag. Never a value. Text that comes from outside (a file path, a command) goes
// through `clean`, which the hooks bind to the Redactor, before it is cut and written.
import { cleanLabel } from './placeholder.js';
/** A log file is rolled over before it passes this size. */
export const ROLLOVER_BYTES = 256 * 1024;
const MAX_TEXT = 400;
const MAX_ID = 64;
const TAG = /^[a-z2-7]{13}$/;
const WORD = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
function tidy(s, max) {
    let out = '';
    for (const ch of s) {
        const c = ch.codePointAt(0);
        out += c < 0x20 || c === 0x7f ? ' ' : ch;
        if (out.length >= max)
            break;
    }
    return out.slice(0, max);
}
const word = (s) => {
    if (s === undefined)
        return undefined;
    const t = tidy(s, MAX_ID);
    return WORD.test(t) ? t : undefined;
};
export function formatLine(entry, clean) {
    const out = { t: Math.trunc(entry.t), event: entry.event };
    const door = word(entry.door);
    if (door !== undefined)
        out.door = door;
    if (entry.where !== undefined)
        out.where = tidy(clean(tidy(entry.where, 4000)), MAX_TEXT);
    const rule = word(entry.rule);
    if (rule !== undefined)
        out.rule = rule;
    if (entry.label !== undefined)
        out.label = cleanLabel(clean(entry.label));
    if (entry.tag !== undefined && TAG.test(entry.tag))
        out.tag = entry.tag;
    const action = word(entry.action);
    if (action !== undefined)
        out.action = action;
    const mode = word(entry.mode);
    if (mode !== undefined)
        out.mode = mode;
    if (entry.detail !== undefined)
        out.detail = tidy(clean(tidy(entry.detail, 4000)), MAX_TEXT);
    return JSON.stringify(out);
}
/** Relative to the plugin's data folder. `part` is 1 for the first file of a session and day. */
export function logFileName(date, sessionId, part) {
    const safe = /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : 'unknown-session';
    return `log/${date}-${safe}${part > 1 ? `.${part}` : ''}.jsonl`;
}
/** The file's text with the line added; `rollover` means the file was full, so `text` is the next part's. */
export function appendLine(existing, line) {
    if (existing.length + line.length + 1 > ROLLOVER_BYTES && existing.length > 0)
        return { text: `${line}\n`, rollover: true };
    return { text: `${existing}${line}\n`, rollover: false };
}
function dayNumber(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m)
        return undefined;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
        return undefined;
    return Math.floor(t / 86_400_000);
}
/** Log file names (not paths) older than `days`, by the date in the name. */
export function staleLogs(names, today, days) {
    const now = dayNumber(today);
    if (now === undefined)
        return [];
    return names.filter(name => {
        const m = /^(\d{4}-\d{2}-\d{2})-.+\.jsonl$/.exec(name);
        const day = m ? dayNumber(m[1]) : undefined;
        return day !== undefined && now - day > days;
    });
}
