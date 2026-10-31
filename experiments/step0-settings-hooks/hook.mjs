// Step 0 settings hook (checks 0.8, 0.9, 0.13, 0.14). Claude Code runs it as a
// command hook and passes the event as JSON on stdin. It appends one metadata
// line to <cwd>/.step0-probe/settings-hook.jsonl (event, tool, sizes, flags;
// never content), and acts only when a marker file in that folder says so:
//   hook-pre-rewrite      PreToolUse on Bash: updatedInput runs `echo PRE-REWRITTEN`
//   hook-post-rewrite     PostToolUse: updatedToolOutput "POST-REWRITTEN" (a plain string)
//   hook-post-scrub       PostToolUse: updatedToolOutput = tool_response in its own shape, canaries -> POST-SCRUBBED
//   hook-prompt-suppress  UserPromptSubmit: suppressOriginalPrompt + additionalContext "PROMPT-REPLACED"
//   hook-prompt-block     UserPromptSubmit: decision "block"
// `--source <name>` (for example "managed") is logged, to tell managed hooks from user ones.
// If the folder doesn't exist, it writes nothing. Node built-ins only.

import fs from 'node:fs'
import path from 'node:path'

const CANARY = /CANARY-[0-9a-f]{16}/
const LABEL = /^[A-Za-z0-9_.:-]{1,64}$/
const label = v => (typeof v === 'string' && LABEL.test(v) ? v : v === undefined ? undefined : '(odd)')
const scrub = v =>
  typeof v === 'string' ? v.replace(new RegExp(CANARY.source, 'g'), 'POST-SCRUBBED')
    : Array.isArray(v) ? v.map(scrub)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
    : v
const size = v => (v === undefined ? undefined : typeof v === 'string' ? v.length : JSON.stringify(v).length)

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function main() {
  const raw = readStdin()
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    process.stderr.write('step0 settings hook: stdin is not JSON\n')
    return
  }
  const dir = typeof input.cwd === 'string' ? path.join(input.cwd, '.step0-probe') : undefined
  if (!dir || !fs.existsSync(dir)) return
  const on = name => fs.existsSync(path.join(dir, name))
  const event = input.hook_event_name

  let answer
  let acted = 'none'
  if (event === 'PreToolUse' && input.tool_name === 'Bash' && on('hook-pre-rewrite')) {
    acted = 'pre-rewrite'
    answer = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...input.tool_input, command: 'echo PRE-REWRITTEN' } } }
  } else if (event === 'PostToolUse' && on('hook-post-scrub')) {
    acted = 'post-scrub'
    answer = { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: scrub(input.tool_response) } }
  } else if (event === 'PostToolUse' && on('hook-post-rewrite')) {
    acted = 'post-rewrite'
    answer = { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'POST-REWRITTEN' } }
  } else if (event === 'UserPromptSubmit' && on('hook-prompt-suppress')) {
    acted = 'prompt-suppress'
    answer = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true, additionalContext: 'PROMPT-REPLACED' } }
  } else if (event === 'UserPromptSubmit' && on('hook-prompt-block')) {
    acted = 'prompt-block'
    answer = { decision: 'block', reason: 'step0 settings hook blocked this prompt' }
  }

  const at = process.argv.indexOf('--source')
  const line = {
    kind: 'settings-hook',
    source: at > 0 ? label(process.argv[at + 1] ?? '') : undefined,
    event: label(event),
    tool: label(input.tool_name),
    node: process.version,
    inputChars: size(input.tool_input),
    responseChars: size(input.tool_response),
    promptChars: size(input.prompt),
    hasCanary: CANARY.test(raw),
    safeMode: process.env.CLAUDE_CODE_SAFE_MODE === '1',
    acted,
    t: Date.now(),
  }
  for (const k of Object.keys(line)) if (line[k] === undefined) delete line[k]
  try {
    fs.appendFileSync(path.join(dir, 'settings-hook.jsonl'), JSON.stringify(line) + '\n')
  } catch {
    process.stderr.write('step0 settings hook: could not write its log\n')
  }
  if (answer) process.stdout.write(JSON.stringify(answer))
}

main()
