// The backup lock's entry: a settings hook that runs `node main.js`. Claude Code gives the event as JSON on
// stdin; the answer, if any, goes to stdout as JSON (spec §5.2).
//
//   node main.js [--policy <file>]...
//
// The marker comes first: when the main lock is alive nothing else is loaded or run. The checker is
// loaded with a dynamic import after that, so standing down costs one file read.
//
// Exit codes: 0 whenever there is an answer or nothing to say, because a non-0 code counts as a hook
// failure; 1 only when the lock could not run at all, which `onFailure: "block"` turns into a stop.
// Nothing is printed to stderr that could hold content.
import os from 'node:os';
import path from 'node:path';
import { isMainLockAlive, readMarker } from './marker.js';
const MAX_STDIN = 16 * 1024 * 1024;
const HEAD = 16 * 1024;
async function readStdin() {
    const chunks = [];
    let size = 0;
    let over = false;
    let head = '';
    for await (const chunk of process.stdin) {
        const b = chunk;
        if (size === 0)
            head = b.toString('utf8', 0, HEAD);
        size += b.length;
        if (size > MAX_STDIN) {
            over = true;
            chunks.length = 0;
        }
        else if (!over)
            chunks.push(b);
    }
    return { text: over ? '' : Buffer.concat(chunks).toString('utf8'), head, over };
}
const sniff = (head, key) => new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]{1,128})"`).exec(head)?.[1];
function policyFiles(argv) {
    const out = [];
    for (let i = 0; i < argv.length; i++)
        if (argv[i] === '--policy' && argv[i + 1] !== undefined)
            out.push(path.resolve(argv[++i]));
    return out;
}
async function main() {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const stdin = await readStdin();
    let input;
    if (!stdin.over) {
        try {
            const v = JSON.parse(stdin.text);
            if (typeof v === 'object' && v !== null && !Array.isArray(v))
                input = v;
        }
        catch {
            // Handled below with the rest of the unreadable input.
        }
    }
    const session = input?.session_id ?? sniff(stdin.head, 'session_id');
    if (isMainLockAlive(readMarker(configDir, session), Date.now()))
        return;
    const options = { configDir, policyFiles: policyFiles(process.argv.slice(2)) };
    const run = await import('./run.js');
    let answer;
    if (input === undefined) {
        const event = sniff(stdin.head, 'hook_event_name');
        if (event === undefined)
            return;
        answer = run.runUnreadable(event, options, sniff(stdin.head, 'cwd'), stdin.over ? 'too-large' : 'unreadable-input');
    }
    else {
        answer = await run.runBackup(input, options);
    }
    if (answer !== undefined)
        await new Promise(done => process.stdout.write(JSON.stringify(answer), () => done()));
}
try {
    await main();
}
catch {
    process.stderr.write('aegiscontext backup lock: could not run\n');
    process.exitCode = 1;
}
