// Helpers for the Step 0 checks run by hand (findings-step0.md).
//
//   node experiments/step0-mock/manual.ts managed-file <out.json>
//     Writes a managed-settings.json for the Managed-mode simulation (D-020):
//     allowManagedHooksOnly plus the step 0 settings hook as a managed hook
//     (logged with source "managed"). Copy it to the managed settings folder
//     as admin, and delete it right after the run.
//
//   node experiments/step0-mock/manual.ts setup <dir> [marker ...]
//     Makes <dir> with notes.txt holding a fresh canary, and the probe markers
//     given (for example on-hide, on-mention, on-resume). Prints a second
//     canary to paste into a prompt. Canaries are not secrets.
//     --disable-all-hooks also writes <dir>/.claude/settings.json with
//     disableAllHooks: true (check 0.14, project settings before trust).

import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const REPO = path.join(import.meta.dirname, '..', '..')
const HOOK = path.join(REPO, 'experiments', 'step0-settings-hooks', 'hook.mjs')
const canary = () => ['CANARY', randomBytes(8).toString('hex')].join('-')

function managedFile(out: string): void {
  const hook = { type: 'command', command: `node "${HOOK}" --source managed`, timeout: 30 }
  const settings = {
    allowManagedHooksOnly: true,
    hooks: {
      SessionStart: [{ hooks: [hook] }],
      UserPromptSubmit: [{ hooks: [hook] }],
      PreToolUse: [{ matcher: '*', hooks: [hook] }],
      PostToolUse: [{ matcher: '*', hooks: [hook] }],
    },
  }
  const text = JSON.stringify(settings, null, 2) + '\n'
  JSON.parse(text) // an unparseable managed file stops Claude Code from starting
  fs.writeFileSync(out, text)
  console.log(`wrote ${out}`)
}

function setup(dir: string, args: string[]): void {
  const markers = args.filter(a => !a.startsWith('--'))
  if (args.includes('--disable-all-hooks')) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }) + '\n')
  }
  const probeDir = path.join(dir, '.step0-probe')
  fs.mkdirSync(probeDir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'notes.txt'), `line one\nthe value is ${canary()}\nline three\n`)
  for (const m of markers) fs.writeFileSync(path.join(probeDir, m.startsWith('on-') || m.startsWith('hook-') ? m : `on-${m}`), '')
  console.log(`folder: ${dir}`)
  console.log(`markers: ${markers.join(', ') || '(none)'}`)
  console.log(`canary to paste into a prompt: ${canary()}`)
}

const [cmd, target, ...rest] = process.argv.slice(2)
if (cmd === 'managed-file' && target) managedFile(target)
else if (cmd === 'setup' && target) setup(target, rest)
else {
  console.error('usage: manual.ts managed-file <out.json> | manual.ts setup <dir> [marker ...]')
  process.exit(2)
}
