// Shared bits for the opt-in check modules. A check is off unless its marker
// file <cwd>/.step0-probe/on-<name> exists. Check lines are written to the
// probe's log with kind "check"; every value in them is a boolean, a number or
// a label that passes `label()`. Never content.

import type { EngineInterface } from 'claude-code'

export const LOG_DIR = '.step0-probe'

// Matches the canaries the step 0 mock driver plants (experiments/step0-mock).
export const CANARY_RE = /CANARY-[0-9a-f]{16}/g

export const hasCanary = (text: string): boolean => new RegExp(CANARY_RE.source).test(text)

// No Node in a mod, so no path.join: use the separator the base path already uses.
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/

/** A short identifier-like value, or "(odd)". Used for anything read from outside. */
export function label(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return LABEL.test(s) ? s : '(odd)'
}

const markers = new Map<string, Promise<boolean>>()

/** Whether <cwd>/.step0-probe/on-<name> exists. Read once per load. */
export function isOn($: EngineInterface, name: string): Promise<boolean> {
  let held = markers.get(name)
  if (!held) {
    held = $.session.cwd()
      .then(cwd => $.fs.exists(joinPath(cwd, LOG_DIR, `on-${name}`)))
      .catch(() => false)
    markers.set(name, held)
  }
  return held
}

export async function checkLine($: EngineInterface, check: string, fields: Record<string, string | number | boolean>): Promise<object> {
  return { kind: 'check', check, t: await $.clock.now(), ...fields }
}
