// The kit's guarded and organization modes (plan step 6, spec §5.3 and §22).
//
//   --guarded  the tool loaded as a user plugin on a machine with a real managed settings file. Claude Code's
//              built-in guard (`sec-default@builtin`) seats itself outermost there and passes some events past
//              user-tier mods. The kit measures which doors that opens; GUARDED_OPEN lists them, and the run
//              fails if a listed door is clean or any other door leaks, so the limit in spec §22 stays true.
//   --org      the organization install: a folder marketplace on the machine, the plugin enabled by managed
//              settings and named in `prependPlugins`, so it runs in the outermost tier. Every door must be clean.
//
// Both write the machine's managed settings file, so they run in CI only (D-020). Each run's debug log is the
// proof that the tool sat in the tier under test; a log without it makes the run invalid, never clean.

import fs from 'node:fs'
import path from 'node:path'
import { orgPluginSnippet } from '../../src/core/snippet.ts'

export type TierMode = 'guarded' | 'org'

/**
 * Doors the built-in guard passes over for a user-tier plugin, as `scenario/door`. These are measured in CI
 * (`npm run leak-test:guarded`) and every one must leak there. Spec §22 lists the same doors.
 */
export const GUARDED_OPEN: string[] = ['claude-md/claude-md', 'hook-context/hook-context', 'compaction/summary', 'mention-file/mention']

/** The organization install cannot run the resume door: it needs a run made before the tool was installed. */
export const ORG_SCENARIOS: string[] = [
  'prompt-typed', 'prompt-pasted', 'read-file', 'mention-file', 'bash-output', 'bash-failed', 'bash-large',
  'mcp-result', 'subagent-read', 'compaction', 'claude-md', 'hook-context',
]

/** The plugin's name in the marketplace, the way the settings name it. */
export const ORG_PLUGIN_ID = 'aegiscontext@aegiscontext'

/** The managed settings of the organization install, pointing at a marketplace folder. */
export function orgManagedContent(marketplaceDir: string): ReturnType<typeof orgPluginSnippet> {
  return orgPluginSnippet(marketplaceDir)
}

/** Copies the repo's marketplace manifest and plugin into `dir`: what an administrator puts on each machine. */
export function buildMarketplaceFolder(dir: string, repo: string): void {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.copyFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), path.join(dir, '.claude-plugin', 'marketplace.json'))
  // A loaded mod writes its types and a tsconfig.json into its own folder; a copy made after a test run must not take them.
  const skip = (src: string): boolean => path.basename(src) === 'types' && path.basename(path.dirname(src)) === '.claude-plugin'
  fs.cpSync(path.join(repo, 'plugin'), path.join(dir, 'plugin'), { recursive: true, filter: src => !skip(src) })
}

const MODULE_LINE = /hooks module (\S+) loaded \([^)]*?\btier (\w+)\)/g

/**
 * What a debug log must show for a run to count: our plugin loaded in the tier under test, and no sign that
 * the built-in guard was left out. Returns the problem, or undefined when the log proves the tier.
 */
export function tierProblem(log: string, mode: TierMode): string | undefined {
  if (/\bnot seated\b/.test(log)) return 'the debug log says the built-in guard was "not seated", so the machine is not set up as the run claims'
  const want = mode === 'org' ? 'prepend' : 'user'
  const ours = [...log.matchAll(MODULE_LINE)].filter(m => (m[1] ?? '').startsWith('aegiscontext@'))
  if (ours.length === 0) return 'the debug log shows the tool never loaded its hooks module'
  const wrong = ours.find(m => m[2] !== want)
  if (wrong) return `the tool loaded in tier ${wrong[2]}, not tier ${want}`
  if (mode === 'guarded' && !/sec-default@builtin seated outermost/.test(log)) return 'the debug log never shows the built-in guard seated; the managed settings file may not have been read'
  if (mode === 'org' && !/sec-default@builtin seated by managed prependPlugins/.test(log)) return 'the debug log never shows the built-in guard seated by prependPlugins'
  return undefined
}
