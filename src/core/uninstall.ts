// How to delete the saved secrets from the OS password store (spec §19, "Uninstall"). Built here so the docs,
// the real-store test and the person all use the same command. A removed plugin leaves the saved list behind
// on purpose: it is the person's data, and only they delete it.
//
//   macOS    items of one service (`index` and `list-<generation>-<n>`); `security` deletes one per call
//   Linux    `secret-tool clear` removes the items that match the service attribute
//   Windows  DPAPI files in `<config folder>/aegiscontext/store/` (a plugin cannot delete a file, so the
//            person removes the folder)

import { SERVICE, type StoreOS } from './backends.ts'

export { SERVICE }

export type UninstallOptions = { service: string; dataDir: string }

export function uninstallCommand(os: StoreOS, o: UninstallOptions): string[] {
  switch (os) {
    case 'macos': return ['sh', '-c', `while security delete-generic-password -s ${o.service} >/dev/null 2>&1; do :; done`]
    case 'linux': return ['secret-tool', 'clear', 'service', o.service]
    case 'windows': return ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -Recurse -Force -LiteralPath '${o.dataDir.replace(/'/g, "''")}'`]
  }
}

/** The same commands as one line each, the way the docs show them. */
export function uninstallText(): Record<StoreOS, string> {
  const dataDir = '$env:USERPROFILE\\.claude\\aegiscontext'
  return {
    macos: `while security delete-generic-password -s ${SERVICE} >/dev/null 2>&1; do :; done`,
    linux: `secret-tool clear service ${SERVICE}`,
    windows: `Remove-Item -Recurse -Force "${dataDir}"`,
  }
}
