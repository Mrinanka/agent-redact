// The built-in guard (plan step 6, spec §5.3 and §22). On a machine with managed settings or a managed MCP server
// file, or with a Team or Enterprise login (any one is enough), Claude Code seats a guard plugin outermost and routes
// some events (prompt.context, prompt.attachment, prompt.compose, session.compact and some session.append rows) past
// user-tier plugins. Nothing a user-tier plugin does can hide what passes it by, so the plugin says so, once, doctor
// repeats it, and under `on_check_failure: hold` it refuses the request (D-087).
//
// The sign is `prompt.compose`: it runs for every request the plugin is part of. A main turn.step that arrives
// with no compose seen means the events are not reaching the plugin. Pure: the facts go in, words come out.

export type GuardFacts = {
  /** prompt.compose has run in this session. */
  composeSeen: boolean
  /** A main turn.step came with no compose seen, and the person has been told. */
  warned: boolean
  /** The tier this plugin sits in (`prepend`, `user`, ...), when it can be read. */
  tier: string | undefined
  /** The machine has managed settings. */
  policy: boolean
}

/** The policy names this plugin: our settings key, or the plugin enabled under any marketplace name. */
export function managedInstall(policy: Record<string, unknown>): boolean {
  if ('aegisContext' in policy) return true
  const enabled = policy.enabledPlugins
  if (typeof enabled !== 'object' || enabled === null) return false
  return Object.entries(enabled).some(([id, on]) => id.startsWith('aegiscontext@') && on !== false)
}

export type GuardState = 'reaches' | 'passed-over' | 'unknown'

export function guardState(f: GuardFacts): GuardState {
  if (f.composeSeen) return 'reaches'
  return f.warned ? 'passed-over' : 'unknown'
}

export function guardWarning(): string {
  return 'Claude Code is not sending some events to this plugin, so instruction files, hook context, attachments and compaction summaries are NOT being checked. A guard built into Claude Code takes them first on machines with managed settings or a managed MCP file, or with a Team or Enterprise login. Only an organization plugin install closes this (docs/managed.md).'
}

/** The answer in place of a request, under `on_check_failure: hold`. */
export function guardHeld(): string {
  return 'aegiscontext: this request was not sent. on_check_failure is hold, and Claude Code is not sending this plugin instruction files, hook context, attachments or compaction summaries to check. Only an organization plugin install closes this (docs/managed.md). To carry on without those checks, set on_check_failure to allow, if your settings let you.'
}

export function guardFix(f: GuardFacts): string | undefined {
  return guardState(f) === 'passed-over' ? 'Ask your administrator to install aegiscontext as an organization plugin (docs/managed.md): as a user plugin it is passed over for some events on this machine.' : undefined
}

export function guardDoctorLines(f: GuardFacts): string[] {
  const state = guardState(f)
  const tier = f.tier === undefined ? 'Plugin tier: not visible to the plugin.' : `Plugin tier: ${f.tier}.`
  const guard =
    state === 'reaches'
      ? 'Built-in guard: the events I need reach the plugin (prompt.compose ran this session).'
      : state === 'passed-over'
        ? 'Built-in guard: some events are passed over this plugin (no prompt.compose came before a request), so instruction files, hook context, attachments and compaction summaries are not being checked.'
        : f.policy && f.tier === 'user'
          ? 'Built-in guard: not known yet. This machine has managed settings and the plugin is a user plugin, so some events may be passed over; send a message and run this again.'
          : 'Built-in guard: not known yet. It shows after the first message of a session.'
  return [tier, guard]
}
