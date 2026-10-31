// Step 0 probe: writes one JSON line per session.append row to
// <session cwd>/.step0-probe/<session id>.jsonl, with the row's door, kinds,
// ids and sizes. Never content (see summarize.ts).
//
// Load it with: claude --plugin-dir <repo>/experiments/step0-probe

import type { Register } from 'claude-code'
import { summarizeRow } from './summarize.ts'
import { append } from './log.ts'
import { registerMention } from './checks/mention.ts'
import { registerResumeTurns, resumeAtStart } from './checks/resume.ts'
import { runtimeAtStart } from './checks/runtime.ts'
import { storeAtStart } from './checks/store.ts'
import { mediaLog, mediaRewrite } from './checks/media.ts'
import { hideLog, hideRewrite } from './checks/hide.ts'
import { budgetBefore, budgetCatch } from './checks/budget.ts'

const PROBE_VERSION = '0.2.0'

let seq = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    const v = await $.session.version().catch(() => undefined)
    await append($, {
      kind: 'start',
      probe: PROBE_VERSION,
      t: await $.clock.now(),
      engine: v?.version ?? 'unknown',
      surface: e.surface,
      interactive: e.isInteractive,
    })
    // Opt-in checks (each off unless <cwd>/.step0-probe/on-<name> exists).
    await resumeAtStart($)
    await runtimeAtStart($)
    await storeAtStart($)
    return out
  }).catch(($, e, next) => next(e))

  // One hook per event: the opt-in checks are called from here. The row is
  // logged as it arrived; a media check logs what it dropped.
  on('session.append', async ($, e, next) => {
    const hide = await hideRewrite($, e)
    const media = await mediaRewrite($, hide.row)
    await budgetBefore($, e)
    const out = await next(media.row)
    seq += 1
    await append($, summarizeRow(e, seq, await $.clock.now()))
    if (hide.hidden > 0) await hideLog($, e, hide.hidden)
    if (media.dropped > 0) await mediaLog($, e, media.dropped)
    return out
  }).catch(async ($, e, next) => (await budgetCatch($, e, next)) ?? next(e))

  // Events only one check uses register their own hooks.
  registerMention(on)
  registerResumeTurns(on)
}
