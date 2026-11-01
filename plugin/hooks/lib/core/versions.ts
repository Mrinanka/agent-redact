// The tested-versions list (spec §4, §20, R-01). The CLI's pinned version, and the VS Code extension's
// own copy of Claude Code, which check 0.10 ran.

export const TESTED_VERSIONS: readonly string[] = ['2.1.316', '2.1.314']

export const isTested = (version: string): boolean => TESTED_VERSIONS.includes(version)

export function versionWarning(version: string): string | undefined {
  if (isTested(version)) return undefined
  return `Claude Code ${version.slice(0, 32)} is not on the tested list (${TESTED_VERSIONS.join(', ')}); it keeps working, but check it with /redact self-check.`
}
