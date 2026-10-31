// The false-alarm set (plan 1b, D-019): the .ts files of the pinned dev
// dependencies, already installed, so there is nothing to download. Harmless text
// that happens to read like secrets; hiding any of it counts as a false alarm.

import fs from 'node:fs'
import path from 'node:path'

const PACKAGES = [['typescript'], ['@types', 'node']]

export type CorpusFile = {
  /** Relative to node_modules, always with forward slashes. */
  name: string
  file: string
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
  }
}

export function falseAlarmFiles(repoRoot: string): CorpusFile[] {
  const modules = path.join(repoRoot, 'node_modules')
  const found: string[] = []
  for (const parts of PACKAGES) {
    const dir = path.join(modules, ...parts)
    if (!fs.existsSync(dir)) throw new Error(`false-alarm set: ${parts.join('/')} is not installed; run npm ci --ignore-scripts`)
    walk(dir, found)
  }
  return found
    .map(file => ({ name: path.relative(modules, file).split(path.sep).join('/'), file }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
