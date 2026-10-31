// Check 0.6: hook budget, .catch grace, and repeated worker failures.
// With on-budget, a session.append row (prompt or tool result) whose text holds
// a trigger word makes the probe's session.append hook misbehave on purpose:
//   BUDGET-THROW      throws
//   BUDGET-CPU        spins the CPU for 11 s (own time: counts)
//   BUDGET-AWAIT      awaits an 11 s $.process.run (a $ call: should not count)
//   BUDGET-SLEEP      awaits $.clock.sleep(11 s) (documented to count)
//   BUDGET-CATCHSLOW  spins 11 s, and the .catch spins 2 s (past the 1 s grace)
// The .catch logs the failure and rewrites the row to a 9-character marker
// text, so the mock's record shows whether the catch's answer stood.

import type { EngineInterface, SessionAppendInput, SessionAppendResult } from 'claude-code'
import { checkLine, isOn } from './common.ts'
import { append } from '../log.ts'

const TRIGGERS = ['BUDGET-THROW', 'BUDGET-CPU', 'BUDGET-AWAIT', 'BUDGET-SLEEP', 'BUDGET-CATCHSLOW'] as const
type Trigger = (typeof TRIGGERS)[number]

const CAUGHT = '[caught!]'

type CaughtNext = {
  (e: SessionAppendInput): Promise<SessionAppendResult>
  readonly called: boolean
  readonly error: { readonly kind: string; readonly budget: number }
}

function spin(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) { /* busy on purpose */ }
}

function triggerOf(e: SessionAppendInput): Trigger | undefined {
  if (e.door !== 'prompt' && e.door !== 'tool-result') return undefined
  const text = JSON.stringify(e.message.content)
  return TRIGGERS.find(t => text.includes(t))
}

/** Called from the probe's session.append hook before next: misbehaves on a trigger. */
export async function budgetBefore($: EngineInterface, e: SessionAppendInput): Promise<void> {
  const trigger = triggerOf(e)
  if (!trigger || !(await isOn($, 'budget'))) return
  if (trigger === 'BUDGET-THROW') throw new Error('step0-probe: thrown on purpose')
  const t0 = Date.now()
  // Logged before the slow part, so a run that is cut off still shows it began.
  await append($, await checkLine($, '0.6', { step: 'enter', trigger }))
  switch (trigger) {
    case 'BUDGET-CPU':
    case 'BUDGET-CATCHSLOW':
      spin(11_000)
      break
    case 'BUDGET-AWAIT':
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 11'], { timeoutMs: 60_000 })
      break
    case 'BUDGET-SLEEP':
      await $.clock.sleep(11_000)
      break
  }
  await append($, await checkLine($, '0.6', { step: 'done', trigger, ms: Date.now() - t0 }))
}

/**
 * Called from the probe's session.append .catch. Answers for a budget trigger;
 * resolves undefined for any other failure, which the caller passes on.
 */
export async function budgetCatch($: EngineInterface, e: SessionAppendInput, next: CaughtNext): Promise<SessionAppendResult | undefined> {
  const trigger = triggerOf(e)
  if (!trigger || !(await isOn($, 'budget'))) return undefined
  await append($, await checkLine($, '0.6', { step: 'caught', trigger, failure: next.error.kind, grace: next.error.budget, called: next.called }))
  if (trigger === 'BUDGET-CATCHSLOW') spin(2_000)
  if (next.called) return next(e)
  // Whether this answer stood shows in the mock's record (a 9-character text).
  return next({ ...e, message: { ...e.message, content: [{ type: 'text', text: CAUGHT }] } } as SessionAppendInput)
}
