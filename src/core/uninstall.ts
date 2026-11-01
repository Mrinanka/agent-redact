// How to delete the saved secrets from the OS password store (spec §19, "Uninstall"). Built here so the docs,
// the real-store test and the person all use the same command. A removed plugin leaves the saved list behind
// on purpose: it is the person's data, and only they delete it.
//
//   macOS    items of one service (`index` and `list-<generation>-<n>`); `security` deletes one per call
//   Linux    `secret-tool clear` removes the items that match the service attribute
//   Both     then the data folder, because a marker file (`store/has-list`) stays in it and a plugin cannot delete a file
//   Windows  DPAPI files in `<config folder>/aegiscontext/store/` (a plugin cannot delete a file, so the
//            person removes the folder)

import { SERVICE, type StoreOS } from './backends.ts'

export { SERVICE }

export type UninstallOptions = { service: string; dataDir: string }

const quote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

export function uninstallCommand(os: StoreOS, o: UninstallOptions): string[] {
  // On macOS and Linux a small marker file (`store/has-list`) stays in the data folder, so the folder goes too.
  const folder = `rm -rf ${quote(o.dataDir)}`
  switch (os) {
    case 'macos': return ['sh', '-c', `while security delete-generic-password -s ${o.service} >/dev/null 2>&1; do :; done; ${folder}`]
    case 'linux': return ['sh', '-c', `secret-tool clear service ${o.service}; ${folder}`]
    case 'windows': return ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -Recurse -Force -LiteralPath '${o.dataDir.replace(/'/g, "''")}'`]
  }
}

/** The same commands as one line each, the way the docs show them. */
export function uninstallText(): Record<StoreOS, string> {
  const unix = '"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/aegiscontext"'
  return {
    macos: `while security delete-generic-password -s ${SERVICE} >/dev/null 2>&1; do :; done; rm -rf ${unix}`,
    linux: `secret-tool clear service ${SERVICE}; rm -rf ${unix}`,
    windows: 'Remove-Item -Recurse -Force "$env:USERPROFILE\\.claude\\aegiscontext"',
  }
}
