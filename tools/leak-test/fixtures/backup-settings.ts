// The settings the kit gives Claude Code to run the backup lock (plan step 5, "kit modes"): the same snippet
// a person would paste, so a change to the snippet is tested here too.
//
//   user     hooks in <config>/settings.json, with the plugin not loaded (--no-plugin)
//   managed  hooks in the machine's managed settings file, which still run under --safe-mode (check 0.8),
//            plus a `aegisContext` key. The key carries a setting no version of the tool knows, so the
//            backup lock logs a notice for it: that notice in the log proves a real managed file was read.

import { backupSnippet, type Snippet } from '../../../src/core/snippet.ts'

type Hooks = Record<string, unknown[]>

/** The proof the managed run looks for in the backup log. */
export const MANAGED_PROOF_KEY = 'kitProof'
export const MANAGED_PROOF_NOTICE = `policy: unknown setting "${MANAGED_PROOF_KEY}" ignored`

export function userSettings(main: string, extraHooks: Hooks = {}): { hooks: Hooks } {
  return { hooks: mergeHooks(backupSnippet({ main, managed: false }).hooks, extraHooks) }
}

export function managedFileContent(main: string): { hooks: Snippet['hooks']; aegisContext: Record<string, unknown> } {
  return { ...backupSnippet({ main, managed: true }), aegisContext: { [MANAGED_PROOF_KEY]: true } }
}

/** Event lists are joined, so a scenario's own hook runs beside the backup lock's. */
export function mergeHooks(a: Hooks, b: Hooks): Hooks {
  const out: Hooks = { ...a }
  for (const [event, list] of Object.entries(b)) out[event] = [...(out[event] ?? []), ...list]
  return out
}
