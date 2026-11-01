// The three OS password stores (spec §8.1, R-10, D-023, D-036). Values go through stdin only, never on
// a command line, where another process could read them. The text handed in is always ASCII (base64),
// so no quoting rule of any shell or program can change it. `exec` and `files` are passed in: the mod
// answers them with `$`, and tests and `tools/measure/store.ts` answer them with Node.
//
// An error message from a program is never kept: it could echo what it was given.
export const SERVICE = 'aegiscontext';
const TIMEOUT_MS = 20_000;
const INDEX = 'index';
const FLAG = 'has-list';
/**
 * How much one item holds, and how many items a list may use. Set from `npm run measure:store`
 * (D-045): well under each store's limit, and few enough that reading them at session start stays quick.
 */
export const LIMITS = {
    macos: { pieceBytes: 2048, maxPieces: 50 },
    linux: { pieceBytes: 4096, maxPieces: 64 },
    windows: { pieceBytes: 256 * 1024, maxPieces: 1 },
};
const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command'];
const SETUP = '$in = [Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security';
const PROTECT = `${SETUP}; $b = [Text.Encoding]::ASCII.GetBytes($in); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))`;
const UNPROTECT = `${SETUP}; $b = [Convert]::FromBase64String($in); [Text.Encoding]::ASCII.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))`;
/** A sign that a list exists, for the stores where a locked read can look like "no item". It holds nothing else. */
function flagged(files, read) {
    const path = files.path(FLAG);
    return {
        hasList: async () => ((await files.exists(path)) && (await files.read(path)).trim() !== '' ? true : read()),
        markList: exists => files.write(path, exists ? '1\n' : ''),
    };
}
async function statusFrom(run, ok) {
    try {
        return ok(await run()) ? 'ok' : 'locked';
    }
    catch {
        return 'missing';
    }
}
function macos({ exec, files, service }) {
    const id = (name) => ['-a', name, '-s', service];
    const backend = {
        id: 'keychain',
        ...LIMITS.macos,
        status: () => statusFrom(() => exec(['security', 'default-keychain'], { timeoutMs: TIMEOUT_MS }), r => r.exitCode === 0),
        ...flagged(files, async () => (await backend.get(INDEX)) !== undefined),
        put: async (name, text) => {
            // `security -i` reads the command from stdin, so the value is on no command line (D-036).
            const r = await exec(['security', '-i'], { stdin: `add-generic-password -a ${name} -s ${service} -U -w "${text}"\n`, timeoutMs: TIMEOUT_MS });
            if (r.exitCode !== 0 || r.stderr.trim() !== '')
                throw new Error('the keychain refused the write');
        },
        get: async (name) => {
            const r = await exec(['security', 'find-generic-password', ...id(name), '-w'], { timeoutMs: TIMEOUT_MS });
            if (r.exitCode === 44)
                return undefined;
            if (r.exitCode !== 0)
                throw new Error('the keychain refused the read');
            return r.stdout.trim();
        },
        del: async (name) => {
            await exec(['security', 'delete-generic-password', ...id(name)], { timeoutMs: TIMEOUT_MS });
        },
    };
    return backend;
}
function linux({ exec, files, service }) {
    const id = (name) => ['service', service, 'account', name];
    const backend = {
        id: 'secret-service',
        ...LIMITS.linux,
        status: () => statusFrom(() => exec(['secret-tool', 'lookup', ...id(INDEX)], { timeoutMs: TIMEOUT_MS }), r => r.exitCode === 0 || r.stderr.trim() === ''),
        ...flagged(files, async () => (await backend.get(INDEX)) !== undefined),
        put: async (name, text) => {
            const r = await exec(['secret-tool', 'store', `--label=${service}`, ...id(name)], { stdin: text, timeoutMs: TIMEOUT_MS });
            if (r.exitCode !== 0)
                throw new Error('the Secret Service refused the write');
        },
        get: async (name) => {
            const r = await exec(['secret-tool', 'lookup', ...id(name)], { timeoutMs: TIMEOUT_MS });
            if (r.exitCode === 0)
                return r.stdout.trim();
            // No item: exit 1 and nothing said. Anything said means the service itself failed.
            if (r.stderr.trim() === '')
                return undefined;
            throw new Error('the Secret Service refused the read');
        },
        del: async (name) => {
            await exec(['secret-tool', 'clear', ...id(name)], { timeoutMs: TIMEOUT_MS });
        },
    };
    return backend;
}
function windows({ exec, files }) {
    const dpapi = async (script, input) => {
        const r = await exec([...POWERSHELL, script], { stdin: input, timeoutMs: TIMEOUT_MS });
        const out = r.stdout.trim();
        if (r.exitCode !== 0 || out === '')
            throw new Error('DPAPI refused the call');
        return out;
    };
    const held = async (name) => {
        const path = files.path(name);
        if (!(await files.exists(path)))
            return undefined;
        const text = (await files.read(path)).trim();
        return text === '' ? undefined : text;
    };
    return {
        id: 'dpapi',
        ...LIMITS.windows,
        status: () => statusFrom(() => exec([...POWERSHELL, 'exit 0'], { timeoutMs: TIMEOUT_MS }), r => r.exitCode === 0),
        hasList: async () => (await held(INDEX)) !== undefined,
        put: async (name, text) => {
            await files.write(files.path(name), await dpapi(PROTECT, text));
        },
        get: async (name) => {
            const blob = await held(name);
            return blob === undefined ? undefined : dpapi(UNPROTECT, blob);
        },
        // A mod can't delete a file, so a removed item is an empty one.
        del: async (name) => {
            if ((await held(name)) !== undefined)
                await files.write(files.path(name), '');
        },
    };
}
export function backendFor(os, tools) {
    const all = { ...tools, service: tools.service ?? SERVICE };
    switch (os) {
        case 'macos': return macos(all);
        case 'linux': return linux(all);
        case 'windows': return windows(all);
    }
}
