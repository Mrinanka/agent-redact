// What Claude Code keeps on disk (plan 1a.5). Reported, not failed: some of it is
// outside the tool's control (spec §22). Only the run's own isolated config folder
// is searched; the user's real ~/.claude is never touched. Labels and counts only.

import fs from 'node:fs'
import path from 'node:path'
import type { Needle } from './detect.ts'

export type DiskHit = { where: string; fakes: number }

const MAX_FILE = 64 * 1024 * 1024

function files(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files(full, out)
    else if (entry.isFile()) out.push(full)
  }
}

/** `projects/*.jsonl` for anything below a folder; session ids and paths stay out of the report. */
function whereLabel(rel: string): string {
  const parts = rel.split(path.sep)
  return parts.length === 1 ? (parts[0] ?? '') : `${parts[0]}/*${path.extname(rel)}`
}

/** Fake ids found per location, merged into `seen`. Only the forms a text file would hold. */
export function searchDisk(configDir: string, needles: readonly Needle[], seen: Map<string, Set<string>>): void {
  const wanted = needles.filter(n => n.form === 'plain' || n.form === 'json-escaped')
  const found: string[] = []
  files(configDir, found)
  for (const file of found) {
    if (fs.statSync(file).size > MAX_FILE) continue
    const bytes = fs.readFileSync(file)
    const where = whereLabel(path.relative(configDir, file))
    for (const n of wanted) {
      if (bytes.includes(n.text)) seen.set(where, (seen.get(where) ?? new Set()).add(n.fakeId))
    }
  }
}

export function summarizeDisk(seen: Map<string, Set<string>>): DiskHit[] {
  return [...seen.entries()]
    .map(([where, ids]) => ({ where, fakes: ids.size }))
    .sort((a, b) => a.where.localeCompare(b.where))
}
