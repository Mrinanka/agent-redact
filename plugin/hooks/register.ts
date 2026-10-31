// secret-shield's hooks (spec §5.1): every row, prompt and context block is cleaned before it is stored
// or sent. Each hook has a `.catch`, so a failure follows `on_check_failure` instead of the engine's
// default of letting the content through (R-03, spec §12).
//
// The bodies are in handlers.ts. The engine lets `$` pass only to functions declared or imported at
// the top of a file, so the hooks call those and keep `next` for themselves.

import type { Register } from 'claude-code'
import { cleanAppend, cleanAttachment, cleanContext, cleanSubmit, failedAppend, failedAttachment, failedCompose, failedContext, failedLifecycle, failedSubmit, PLACEHOLDER_NOTE, shutDown, startUp, stillRunning } from './handlers.ts'
import { NOTE_ID } from './lib/core/note.ts'

export const register: Register = on => {
  // All hiding: every row the conversation keeps passes through here before it is stored.
  on('session.append', async ($, e, next) => {
    const message = await cleanAppend($, e)
    return next(message === e.message ? e : { ...e, message })
  }).catch(async ($, e, next) => {
    // After next was called the row is stored; replay it as it settled.
    if (next.called) return next(e)
    const message = await failedAppend($, e, next.error.kind)
    return next(message === e.message ? e : { ...e, message })
  })

  // The prompt as typed, before it is recorded anywhere. A slash command's line goes to session.append.
  on('prompt.submit', async ($, e, next) => {
    await stillRunning($)
    if (e.command) return next(e)
    const out = await cleanSubmit($, e)
    if ('drop' in out) return { drop: out.drop }
    return next({ ...e, text: out.text, ...(out.context ? { context: out.context } : {}) })
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    const out = await failedSubmit($, next.error.kind)
    return out && 'drop' in out ? { drop: out.drop } : next(e)
  })

  // The project's instruction files and other context blocks of a conversation's first message.
  on('prompt.context', async ($, e, next) => next({ ...e, blocks: await cleanContext($, e) })).catch(async ($, e, next) => {
    if (next.called) return next(e)
    return next({ ...e, blocks: await failedContext($, e, next.error.kind) })
  })

  // Messages the engine injects for the model, rendered per request (a second layer behind session.append).
  on('prompt.attachment', async ($, e, next) => next({ ...e, text: await cleanAttachment($, e) })).catch(async ($, e, next) => {
    if (next.called) return next(e)
    return next({ ...e, text: await failedAttachment($, e, next.error.kind) })
  })

  // The note is fixed text, added last, so it is the same for the whole thread and the prompt cache holds.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    return { sections: [...out.sections, { id: NOTE_ID, text: PLACEHOLDER_NOTE, scope: 'session' as const }] }
  }).catch(async ($, e, next) => {
    await failedCompose($, next.error.kind)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await startUp($)
    return next(e)
  }).catch(async ($, e, next) => {
    await failedLifecycle($, 'start', next.error.kind)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await shutDown($)
    return next(e)
  }).catch(async ($, e, next) => {
    await failedLifecycle($, 'end', next.error.kind)
    return next(e)
  })
}
