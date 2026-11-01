// The built-in guard check (spec §5.3, §22): prompt.compose leaves a mark in $.state, and the first main
// turn.step that finds no mark warns once. The words and the doctor lines are in lib/core/guard-check.ts.
// Only flags are kept; nothing here holds content.

import type { EngineInterface } from 'claude-code'
import { guardDoctorLines, guardFix, guardWarning, type GuardFacts } from './lib/core/guard-check.ts'
import { warn } from './warn.ts'

let composeCached = false
let ownTier: string | undefined

/** prompt.compose ran: the events reach this plugin. Written once per worker, kept for the session. */
export async function markComposeSeen($: EngineInterface): Promise<void> {
  if (composeCached) return
  composeCached = true
  try {
    await $.state.set({ plugin: 'aegiscontext', key: 'composeSeen' }, true)
  } catch {
    // The flag is a courtesy; the cache above still answers for this worker.
  }
}

/** The first main step without a compose warns, once for the session. A failure here never touches the step. */
export async function checkGuard($: EngineInterface, agentId: string | undefined): Promise<void> {
  if (agentId !== undefined || composeCached) return
  try {
    if ((await $.state.get({ plugin: 'aegiscontext', key: 'composeSeen' })).value === true) {
      composeCached = true
      return
    }
    if ((await $.state.get({ plugin: 'aegiscontext', key: 'guardWarned' })).value === true) return
    await $.state.set({ plugin: 'aegiscontext', key: 'guardWarned' }, true)
    warn($, 'guard', guardWarning())
  } catch {
    // Checking for the guard must never stop a request.
  }
}

/** Called from the command.list hook: our own call shows the tier this plugin was seated in. */
export function noteOrigin(origin: { plugin: string; tier: string }): void {
  if (origin.plugin === 'aegiscontext') ownTier = origin.tier
}

async function pluginTier($: EngineInterface): Promise<string | undefined> {
  ownTier = undefined
  await $.command.list().catch(() => [])
  return ownTier
}

export async function guardFacts($: EngineInterface, policy: boolean): Promise<GuardFacts> {
  const composeSeen = composeCached || (await $.state.get({ plugin: 'aegiscontext', key: 'composeSeen' }).catch(() => ({ value: undefined }))).value === true
  const warned = (await $.state.get({ plugin: 'aegiscontext', key: 'guardWarned' }).catch(() => ({ value: undefined }))).value === true
  return { composeSeen, warned, tier: await pluginTier($), policy }
}

export async function guardLines($: EngineInterface, policy: boolean): Promise<{ lines: string[]; fix: string | undefined }> {
  const facts = await guardFacts($, policy)
  return { lines: guardDoctorLines(facts), fix: guardFix(facts) }
}

/** For tests: a fresh worker. */
export function resetGuard(): void {
  composeCached = false
  ownTier = undefined
}
