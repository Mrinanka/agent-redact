// The mod has no node:path, so a path is joined with the separator the base path already uses.
// (Node code in this repo uses path.join; this file is only for the mod.)

import type { EngineInterface } from 'claude-code'

export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

/** <CLAUDE_CONFIG_DIR or ~/.claude>. */
export async function configDir($: EngineInterface): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return config
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  // No home folder means nowhere safe to write; callers treat this as a failed write.
  if (!home) throw new Error('no home folder')
  return joinPath(home, '.claude')
}

/** <config>/secret-shield: the log, the marker and (on Windows) the encrypted store. */
export async function dataDir($: EngineInterface): Promise<string> {
  return joinPath(await configDir($), 'secret-shield')
}
