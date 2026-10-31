// Step 0 scenarios for the mock driver (run.ts). Each scenario is one or more
// `claude -p` runs in a fresh scratch folder, with the probe loaded, against
// the mock in server.ts. Canaries are made at run time and named by label;
// only the labels and true/false ever reach the summary.

import path from 'node:path'
import type { Reply, Script, ParsedRequest } from './server.ts'

export type Ctx = {
  dir: string
  canary: Record<string, string>
}

export type Run = {
  /** The prompt, as given to `claude -p`. */
  prompt: (ctx: Ctx) => string
  /** Probe markers (on-<check>) and settings-hook markers (hook-<x>) for this run. */
  markers?: string[]
  /** Extra CLI flags, put after the prompt. */
  args?: string[]
  env?: Record<string, string>
  /** Resume the session of the scenario's first run. */
  resume?: boolean
  script: (ctx: Ctx) => Script
}

export type Scenario = {
  name: string
  checks: string[]
  /** Canary labels to make. */
  canaries: string[]
  files?: (ctx: Ctx) => Record<string, string | Uint8Array>
  /** Install the step 0 settings hook in the run's user settings. */
  settingsHooks?: boolean
  /** Written to <dir>/.claude/settings.json and settings.local.json. */
  projectSettings?: Record<string, unknown>
  localSettings?: Record<string, unknown>
  /** Load the probe with --plugin-dir (default true). */
  probe?: boolean
  runs: Run[]
}

// Words to look for in each request besides the canaries (not secrets).
export const WATCH_WORDS = [
  'PRE-REWRITTEN', 'POST-REWRITTEN', 'PROMPT-REPLACED', '[caught!]', 'media dropped', '[HIDDEN]', 'held this request', 'SUBAGENT-TASK', 'POST-SCRUBBED', 'STEP0-COMMAND-LOADED',
]

const ALLOWED = ['--allowedTools', 'Read', 'Bash', 'Agent', 'Task']

// A 1x1 PNG, built from bytes.
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

const text = (t: string): Reply => ({ kind: 'text', text: t })
const tool = (name: string, input: Record<string, unknown>): Reply => ({ kind: 'tool', name, input })

const isSummaryRequest = (r: ParsedRequest) => /summary of the conversation|detailed summary|summarize the conversation/i.test(r.lastUserText)
const isSub = (r: ParsedRequest) => r.firstUserText.includes('SUBAGENT-TASK')
const assistantTurns = (r: ParsedRequest) => r.messages.filter(m => m.role === 'assistant').length
const subagentTool = (r: ParsedRequest) => (r.toolNames.includes('Agent') ? 'Agent' : 'Task')

/**
 * Main-loop replies by step (the number of assistant messages so far), subagent
 * replies the same way, a summary for a compaction request, 'ok' for side requests.
 */
function steps(main: ((r: ParsedRequest) => Reply)[], opts: { sub?: ((r: ParsedRequest) => Reply)[]; summary?: string } = {}): Script {
  return r => {
    if (isSummaryRequest(r)) return text(opts.summary ?? 'Summary: nothing to note.')
    if (!r.hasTools) return text('ok')
    const k = assistantTurns(r)
    if (isSub(r)) return (opts.sub ?? [])[k]?.(r) ?? text('sub-done')
    return main[k]?.(r) ?? text('done')
  }
}

const read = (ctx: Ctx, file: string) => () => tool('Read', { file_path: path.join(ctx.dir, file) })
const bash = (command: string) => () => tool('Bash', { command, description: 'step0 scenario command' })

const notes = (ctx: Ctx) => ({ 'notes.txt': `line one\r\nthe value is ${ctx.canary.file}\nline three ✓\n` })

const budget = (trigger: string): Scenario => ({
  name: `budget-${trigger.toLowerCase()}`,
  checks: ['0.6'],
  canaries: [],
  runs: [{ prompt: () => `Please note BUDGET-${trigger} and reply.`, markers: ['on-budget'], script: () => steps([]) }],
})

const killSwitch = (name: string, extra: Partial<Scenario>, run: Partial<Run> = {}): Scenario => ({
  name,
  checks: ['0.14'],
  canaries: ['prompt'],
  settingsHooks: true,
  ...extra,
  runs: [{ prompt: ctx => `Reply about ${ctx.canary.prompt}`, script: () => steps([]), ...run }],
})

export const SCENARIOS: Scenario[] = [
  {
    name: 'basic',
    checks: ['0.1', '0.11'],
    canaries: ['prompt', 'file', 'bash'],
    files: ctx => ({ ...notes(ctx), 'bash-out.txt': `out ${ctx.canary.bash}\n` }),
    runs: [{
      prompt: ctx => `My note: ${ctx.canary.prompt}. Read notes.txt, then show bash-out.txt.`,
      args: ALLOWED,
      script: ctx => steps([read(ctx, 'notes.txt'), bash('cat bash-out.txt'), bash('cat no-such-file.txt')]),
    }],
  },
  {
    name: 'mention-base',
    checks: ['0.1', '0.2'],
    canaries: ['file'],
    files: notes,
    runs: [{ prompt: () => 'Look at @notes.txt and reply.', script: () => steps([]) }],
  },
  {
    name: 'mention-redirect',
    checks: ['0.2'],
    canaries: ['file'],
    files: notes,
    runs: [{ prompt: () => 'Look at @notes.txt and reply.', markers: ['on-mention'], script: () => steps([]) }],
  },
  {
    name: 'subagent',
    checks: ['0.1'],
    canaries: ['file'],
    files: notes,
    runs: [{
      prompt: () => 'Ask a helper to read notes.txt.',
      args: ALLOWED,
      script: ctx => steps(
        [r => tool(subagentTool(r), { description: 'read notes', prompt: 'SUBAGENT-TASK: read notes.txt and report', subagent_type: 'general-purpose' })],
        { sub: [read(ctx, 'notes.txt')] },
      ),
    }],
  },
  {
    name: 'compact',
    checks: ['0.1'],
    canaries: ['prompt', 'summary'],
    runs: [
      { prompt: ctx => `Remember ${ctx.canary.prompt} and reply.`, script: () => steps([]) },
      { prompt: () => '/compact', resume: true, script: ctx => steps([], { summary: `Summary: the user shared ${ctx.canary.summary}.` }) },
      { prompt: () => 'Reply with ok.', resume: true, script: () => steps([]) },
    ],
  },
  {
    name: 'image-base',
    checks: ['0.5'],
    canaries: [],
    files: () => ({ 'photo.png': PNG }),
    runs: [{ prompt: () => 'Read photo.png.', args: ALLOWED, script: ctx => steps([read(ctx, 'photo.png')]) }],
  },
  {
    name: 'image-drop',
    checks: ['0.5'],
    canaries: [],
    files: () => ({ 'photo.png': PNG }),
    runs: [{ prompt: () => 'Read photo.png.', args: ALLOWED, markers: ['on-media'], script: ctx => steps([read(ctx, 'photo.png')]) }],
  },
  {
    name: 'resume',
    checks: ['0.3'],
    canaries: ['prompt'],
    runs: [
      { prompt: ctx => `Remember ${ctx.canary.prompt} and reply.`, script: () => steps([]) },
      { prompt: () => 'Reply with ok.', resume: true, markers: ['on-resume'], script: () => steps([]) },
      { prompt: () => 'Reply with ok again.', resume: true, markers: ['on-resume', 'on-resume-hold'], script: () => steps([]) },
    ],
  },
  budget('THROW'),
  budget('CPU'),
  budget('AWAIT'),
  budget('SLEEP'),
  budget('CATCHSLOW'),
  {
    name: 'budget-repeat',
    checks: ['0.6'],
    canaries: [],
    runs: [{
      prompt: () => 'Run three commands.',
      args: ALLOWED,
      markers: ['on-budget'],
      script: () => steps([bash('echo BUDGET-CPU one'), bash('echo BUDGET-CPU two'), bash('echo BUDGET-CPU three'), bash('echo after')]),
    }],
  },
  {
    name: 'runtime',
    checks: ['0.4', '0.13'],
    canaries: [],
    runs: [{ prompt: () => 'Reply with ok.', markers: ['on-runtime'], script: () => steps([]) }],
  },
  {
    name: 'store',
    checks: ['0.4'],
    canaries: [],
    runs: [{ prompt: () => 'Reply with ok.', markers: ['on-store'], script: () => steps([]) }],
  },
  {
    name: 'hooks-tools',
    checks: ['0.9', '0.13'],
    canaries: ['file', 'bash'],
    settingsHooks: true,
    files: ctx => ({ ...notes(ctx), 'bash-out.txt': `out ${ctx.canary.bash}\n` }),
    runs: [{
      prompt: () => 'Show bash-out.txt, then read notes.txt.',
      args: ALLOWED,
      markers: ['hook-pre-rewrite', 'hook-post-rewrite'],
      script: ctx => steps([bash('cat bash-out.txt'), read(ctx, 'notes.txt')]),
    }],
  },
  {
    name: 'hooks-post-only',
    checks: ['0.9'],
    canaries: ['file', 'bash'],
    settingsHooks: true,
    files: ctx => ({ ...notes(ctx), 'bash-out.txt': `out ${ctx.canary.bash}\n` }),
    runs: [{
      prompt: () => 'Show bash-out.txt, then read notes.txt.',
      args: ALLOWED,
      markers: ['hook-post-rewrite'],
      script: ctx => steps([bash('cat bash-out.txt'), read(ctx, 'notes.txt')]),
    }],
  },
  {
    name: 'hooks-post-scrub',
    checks: ['0.9'],
    canaries: ['file', 'bash'],
    settingsHooks: true,
    files: ctx => ({ ...notes(ctx), 'bash-out.txt': `out ${ctx.canary.bash}
` }),
    runs: [{
      prompt: () => 'Show bash-out.txt, then read notes.txt.',
      args: ALLOWED,
      markers: ['hook-post-scrub'],
      script: ctx => steps([bash('cat bash-out.txt'), read(ctx, 'notes.txt')]),
    }],
  },
  {
    name: 'hide',
    checks: ['0.10'],
    canaries: ['prompt', 'file'],
    files: notes,
    runs: [{
      prompt: ctx => `My note: ${ctx.canary.prompt}. Read notes.txt.`,
      args: ALLOWED,
      markers: ['on-hide'],
      script: ctx => steps([read(ctx, 'notes.txt')]),
    }],
  },
  {
    name: 'command',
    checks: ['0.7'],
    canaries: [],
    runs: [{ prompt: () => '/step0-probe:step0-status', script: () => steps([]) }],
  },
  {
    name: 'hooks-prompt',
    checks: ['0.9'],
    canaries: ['prompt'],
    settingsHooks: true,
    runs: [{ prompt: ctx => `Here is ${ctx.canary.prompt}, reply.`, markers: ['hook-prompt-suppress'], script: () => steps([]) }],
  },
  {
    name: 'hooks-block',
    checks: ['0.9'],
    canaries: ['prompt'],
    settingsHooks: true,
    runs: [{ prompt: ctx => `Here is ${ctx.canary.prompt}, reply.`, markers: ['hook-prompt-block'], script: () => steps([]) }],
  },
  killSwitch('safe-mode', { checks: ['0.8'] }, { args: ['--safe-mode'] }),
  killSwitch('kill-project', { projectSettings: { disableAllHooks: true } }),
  killSwitch('kill-local', { localSettings: { disableAllHooks: true } }),
  killSwitch('kill-bare', {}, { args: ['--bare'] }),
  killSwitch('kill-simple', {}, { env: { CLAUDE_CODE_SIMPLE: '1' } }),
  killSwitch('control', { checks: ['0.8', '0.14'] }),
]
