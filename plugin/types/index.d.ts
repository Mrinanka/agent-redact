// The plugin's $.state contract. These values live in the host's memory for the session, so a
// restarted hooks worker keeps the session's catches and tags (spec §7 check 4, §9). Nothing here is
// ever written to disk by this plugin.

export type ShieldCatch = {
  value: string
  tag: string
  label: string
  ruleId: string
  showHint: boolean
  caught: boolean
  action?: 'hide' | 'block' | 'warn'
}

declare module 'claude-code' {
  interface PluginState {
    'secret-shield': { catches: ShieldCatch[] }
  }
}
