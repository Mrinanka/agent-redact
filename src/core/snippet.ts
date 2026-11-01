// The settings the backup lock needs (plan step 5 item 5, D-068, D-069): three command hooks in exec form
// (`command` + `args`, no shell, so no quoting rule applies and a path may hold spaces). Personal mode
// leaves `onFailure` out; Managed mode sets it to "block", so a hook that cannot start stops the call.

export type SnippetOptions = {
  /** Absolute path of the program, `.../aegiscontext/backup/backup/main.js`. */
  main: string
  managed: boolean
  /** A file holding the managed settings, for an organization that delivers them by MDM or from the server. */
  policyFile?: string
}

type Hook = { type: 'command'; command: 'node'; args: string[]; timeout: number; onFailure?: 'block' }
export type Snippet = { hooks: Record<'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse', { hooks: Hook[] }[]> }

/** The words the docs files show in place of a real path. */
export const SNIPPET_MAIN = '<CONFIG-FOLDER>/aegiscontext/backup/backup/main.js'
export const SNIPPET_POLICY = '<PATH-TO-MANAGED-SETTINGS-COPY>.json'

export function backupSnippet(o: SnippetOptions): Snippet {
  const hook = (): { hooks: Hook[] } => ({
    hooks: [{ type: 'command', command: 'node', args: [o.main, ...(o.policyFile === undefined ? [] : ['--policy', o.policyFile])], timeout: 30, ...(o.managed ? { onFailure: 'block' as const } : {}) }],
  })
  return { hooks: { UserPromptSubmit: [hook()], PreToolUse: [hook()], PostToolUse: [hook()] } }
}

/** The word the docs file shows in place of the folder that holds the marketplace on each machine. */
export const SNIPPET_MARKETPLACE = '<MARKETPLACE-FOLDER>'

export type OrgPluginSnippet = {
  extraKnownMarketplaces: { aegiscontext: { source: { source: 'directory'; path: string } } }
  enabledPlugins: { 'aegiscontext@aegiscontext': true }
  prependPlugins: ['aegiscontext@aegiscontext', 'sec-default@builtin']
}

/**
 * The managed settings for the organization install (spec §5.3, §19): a folder marketplace on each machine,
 * the plugin enabled, and listed first in `prependPlugins` so it runs outermost. The built-in guard is listed
 * after it, because a `prependPlugins` list replaces Claude Code's own default seat for that guard
 * (`sec-default@builtin`, the id every release reads).
 */
export function orgPluginSnippet(marketplaceDir: string): OrgPluginSnippet {
  return {
    extraKnownMarketplaces: { aegiscontext: { source: { source: 'directory', path: marketplaceDir } } },
    enabledPlugins: { 'aegiscontext@aegiscontext': true },
    prependPlugins: ['aegiscontext@aegiscontext', 'sec-default@builtin'],
  }
}
