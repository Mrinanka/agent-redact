// The backup lock's compiled copy (spec §5.2, D-068). Claude Code runs a settings hook with plain Node, and
// an installed plugin gets no build step, so `tsc` turns src/backup, src/core and src/checker into
// plugin/backup/*.js and that is committed. `tsc` is the only tool: TypeScript 7's npm package has no JS
// API, so it is run as a command (plan step 5, spike S5).
//
//   node tools/plugin/backup-build.ts           write plugin/backup/
//   node tools/plugin/backup-build.ts --check   fail if it differs from the sources (CI)
//
// Also written: package.json ("type": "module"), manifest.json (the version and a SHA-256 per file, which
// `/redact backup` compares to refresh the stable copy), and the licences, which travel with the Gitleaks rules.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listFiles } from './build.ts'

export type BackupFile = { rel: string; content: string }

const LICENCES = ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES']
const TSC = (root: string): string => path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Compiles into a scratch folder and returns the files, forward-slash names, sorted. */
export function compileBackup(root: string): BackupFile[] {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-build-'))
  try {
    const r = spawnSync(process.execPath, [TSC(root), '-p', path.join(root, 'tools', 'plugin', 'tsconfig.backup.json'), '--outDir', out], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`)
    return listFiles(out)
      .filter(f => f.endsWith('.js'))
      .map(f => ({ rel: path.relative(out, f).split(path.sep).join('/'), content: fs.readFileSync(f, 'utf8') }))
      .sort((a, b) => (a.rel < b.rel ? -1 : 1))
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}

export function backupPlan(root: string): { files: BackupFile[]; stale: string[] } {
  const compiled = compileBackup(root)
  const version = (JSON.parse(fs.readFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version
  const files: BackupFile[] = [...compiled, { rel: 'package.json', content: '{ "type": "module" }\n' }]
  for (const name of LICENCES) files.push({ rel: name, content: fs.readFileSync(path.join(root, name), 'utf8') })
  const hashes = Object.fromEntries(files.map(f => [f.rel, sha256(f.content)]).sort(([a], [b]) => ((a as string) < (b as string) ? -1 : 1)))
  files.push({ rel: 'manifest.json', content: `${JSON.stringify({ version, files: hashes }, null, 2)}\n` })
  const dir = path.join(root, 'plugin', 'backup')
  const made = new Set(files.map(f => f.rel))
  const stale = listFiles(dir)
    .map(f => path.relative(dir, f).split(path.sep).join('/'))
    .filter(rel => !made.has(rel))
  return { files, stale }
}

export function runBackupBuild(root: string, check: boolean): void {
  const { files, stale } = backupPlan(root)
  const dir = path.join(root, 'plugin', 'backup')
  const drift: string[] = []
  for (const f of files) {
    const file = path.join(dir, ...f.rel.split('/'))
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== f.content) drift.push(`plugin/backup/${f.rel}`)
  }
  if (check) {
    for (const s of stale) drift.push(`plugin/backup/${s} (no source)`)
    if (drift.length > 0) {
      console.error(`plugin/backup is out of date (${drift.length} files). Run: npm run plugin:build\n  ${drift.slice(0, 20).join('\n  ')}`)
      process.exit(1)
    }
    console.log(`plugin/backup is current (${files.length} files)`)
    return
  }
  for (const f of files) {
    const file = path.join(dir, ...f.rel.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, f.content)
  }
  for (const s of stale) fs.rmSync(path.join(dir, ...s.split('/')))
  console.log(`wrote ${files.length} files to plugin/backup, removed ${stale.length}`)
}

if (import.meta.main) runBackupBuild(path.join(import.meta.dirname, '..', '..'), process.argv.includes('--check'))
