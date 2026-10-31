// Which `claude` the kit runs. `npm ci --ignore-scripts` in claude-pin/ leaves
// bin/claude as a stub, so the kit runs the platform binary directly (it needs no
// Node and no install step). Order: an explicit path, the pinned install, PATH.

import fs from 'node:fs'
import path from 'node:path'

export const PIN_DIR = path.join(import.meta.dirname, 'claude-pin')

export type ClaudeCommand = { cmd: string; args?: string[] }

function pinnedBinary(pinDir: string): string {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  return path.join(pinDir, 'node_modules', '@anthropic-ai', `claude-code-${process.platform}-${process.arch}`, exe)
}

export function resolveClaude(opts: { explicit?: string; pinDir?: string } = {}): ClaudeCommand {
  if (opts.explicit) return { cmd: opts.explicit }
  const pinned = pinnedBinary(opts.pinDir ?? PIN_DIR)
  return { cmd: fs.existsSync(pinned) ? pinned : 'claude' }
}

export function pinnedVersion(pinDir = PIN_DIR): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(pinDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  return pkg.dependencies['@anthropic-ai/claude-code'] ?? ''
}
