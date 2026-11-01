// What the backup lock needs from the machine, in Node: running a program for the password store and
// reading the files it keeps (spec §8.1). Moved from tools/measure/store.ts, which now imports them.
// The backup lock only ever reads the store, so its files object refuses writes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
export const nodeExec = async (argv, init) => {
    const [cmd, ...args] = argv;
    const r = spawnSync(cmd, args, { input: init?.stdin ?? '', encoding: 'utf8', timeout: init?.timeoutMs ?? 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    if (r.error)
        throw r.error;
    return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
export function nodeFiles(dir) {
    return {
        read: async (p) => fs.readFileSync(p, 'utf8'),
        write: async (p, t) => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, t);
        },
        exists: async (p) => fs.existsSync(p),
        path: name => path.join(dir, `${name}.dpapi`),
    };
}
/** The backup lock never changes the store: a save or a flag write from here is a bug, so it fails. */
export function readOnlyFiles(dir) {
    return {
        ...nodeFiles(dir),
        write: async () => {
            throw new Error('the backup lock does not write to the password store');
        },
    };
}
export const thisOS = () => (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux');
