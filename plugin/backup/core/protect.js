// The tool protecting itself (spec §17, D-055): Claude's tool calls can't change its files, or the
// settings that would switch it off. The shell check reads text, so it is best effort: a command that
// hides what it does gets past it (spec §22).
/** Top-level settings that can switch the tool off or change what it does. */
const KILL_SWITCHES = ['disableAllHooks', 'allowManagedHooksOnly', 'hooks', 'enabledPlugins', 'aegisContext'];
const KILL_ENV = 'CLAUDE_CODE_SIMPLE';
const CHANGES = /(?:^|[\s;&|(])(?:rm|rmdir|mv|cp|del|erase|rd|ren|rename|move|copy|truncate|tee|chmod|chown|ln|touch|Remove-Item|Rename-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Clear-Content|Out-File|New-Item|ri|ni)\b|>|sed\s+(?:-\S*\s+)*-i|perl\s+-\S*i|(?:node|python3?|ruby|perl|deno|bun)\s+-\S*[ec]\b/i;
export function normalize(path, caseless) {
    const out = [];
    const raw = path.replace(/\\/g, '/').split('/');
    raw.forEach((part, i) => {
        if (part === '..') {
            if (out.length > 1)
                out.pop();
        }
        else if (part !== '.' && (part !== '' || i === 0))
            out.push(part);
    });
    const joined = out.join('/');
    return caseless ? joined.toLowerCase() : joined;
}
const under = (path, root) => path === root || path.startsWith(`${root}/`);
export function isProtected(path, r) {
    const p = normalize(path, r.caseless);
    return r.own.some(root => under(p, normalize(root, r.caseless)));
}
export function isSettingsFile(path, r) {
    const p = normalize(path, true);
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (name === 'managed-settings.json')
        return true;
    if (name !== 'settings.json' && name !== 'settings.local.json')
        return false;
    return p.endsWith(`/.claude/${name}`) || p === `${normalize(r.config, true)}/${name}`;
}
function parse(text) {
    try {
        const v = JSON.parse(text === '' ? '{}' : text);
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
    }
    catch {
        return undefined;
    }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The setting a change would alter, if it is one that matters. */
export function blockedSettingsChange(before, after) {
    const old = parse(before) ?? {};
    const next = parse(after);
    if (!next)
        return [...KILL_SWITCHES, KILL_ENV].find(k => after.includes(k));
    for (const key of KILL_SWITCHES)
        if (!same(old[key], next[key]))
            return key;
    const env = (o) => o.env?.[KILL_ENV];
    return same(env(old), env(next)) ? undefined : KILL_ENV;
}
const quotedOrBare = (command, caseless) => normalize(command, caseless).replace(/\/+/g, '/');
/** What a shell command would change that it must not, in a word, or nothing. */
export function shellChangesProtected(command, r) {
    if (/\bclaude\s+plugins?\s+(?:disable|uninstall|remove)\b/i.test(command))
        return 'the plugin';
    if (/\b(?:delete-generic-password\b.*aegiscontext|secret-tool\s+clear\b.*aegiscontext)/i.test(command))
        return 'the saved secrets';
    if (!CHANGES.test(command))
        return undefined;
    const text = quotedOrBare(command, r.caseless);
    if (r.own.some(root => text.includes(normalize(root, r.caseless))))
        return "the tool's own files";
    if (/\.claude[\\/]settings(?:\.local)?\.json|managed-settings\.json/i.test(command))
        return 'Claude Code settings';
    if ([...KILL_SWITCHES.filter(k => k !== 'hooks' && k !== 'enabledPlugins'), KILL_ENV].some(k => command.includes(k)) && /settings/i.test(command))
        return 'Claude Code settings';
    return undefined;
}
