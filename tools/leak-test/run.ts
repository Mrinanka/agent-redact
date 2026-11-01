// The leak test kit's command line (spec §20).
//
//   node tools/leak-test/run.ts [--plugin <dir> | --no-plugin] [--expect clean|leaks]
//     [--claude <path>] [--only <scenario>]... [--report <file>]
//     [--require-pinned] [--scratch <dir>] [--keep]
//     [--backup user|managed [--outside] [--safe-mode] [--allow-managed-file]]
//     [--org | --guarded] --allow-managed-file
//
// Exit codes: 0 pass, 1 leak (or a blind baseline), 2 invalid run or bad usage.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pinnedVersion, resolveClaude } from './claude-bin.ts'
import { exitCodeFor, KitError, runKit, type KitOptions } from './kit.ts'
import { formatReport } from './report.ts'
import { managedFile, type ManagedFile } from './managed-file.ts'
import { GUARDED_OPEN, ORG_SCENARIOS, buildMarketplaceFolder, guardedScenarios, orgManagedContent } from './org.ts'
import { managedFileContent } from './fixtures/backup-settings.ts'
import { BACKUP_INSIDE, BACKUP_ONLY, BACKUP_OUTSIDE, SCENARIOS, STORE_SCENARIOS } from './scenarios.ts'

const REPO = path.join(import.meta.dirname, '..', '..')

const USAGE = `usage: node tools/leak-test/run.ts [options]
  --plugin <dir>      tool to test (default: plugin/)
  --no-plugin         load no plugin, for a tool installed by managed settings
  --expect <mode>     clean (default): any fake seen fails
                      leaks: any fake not seen fails (the baseline, on the empty tool)
  --claude <path>     Claude Code binary (default: pinned install, then PATH)
  --only <scenario>   run one scenario; may repeat
  --report <file>     also write the JSON report (labels only)
  --require-pinned    fail unless Claude Code is the pinned version
  --scratch <dir>     parent folder for scratch folders
  --keep              keep scratch folders, which hold the fakes of this run
  --backup <where>    test the backup lock (plugin/backup) instead of the plugin, run as settings hooks:
                      user (in the user settings) or managed (in the machine's managed settings file)
  --outside           with --backup: run the doors the backup lock does not cover, expecting every fake to be seen
  --safe-mode         start Claude Code with --safe-mode (managed hooks still run, check 0.8)
  --allow-managed-file  let the kit write, and remove, the machine's managed settings file (--backup managed, --org, --guarded)
  --org               the organization install: a folder marketplace, the plugin in prependPlugins (every door must be clean)
  --guarded           the plugin as a user plugin on a machine with managed settings: the built-in guard passes some doors over,
                      and those must leak while every other door stays clean
scenarios: ${SCENARIOS.map(s => s.name).join(', ')}`

function usage(message: string): never {
  console.error(`${message}\n${USAGE}`)
  process.exit(2)
}

/** The organization install: a folder marketplace on the machine, then the managed file that names it. Both go when the run ends. */
function orgInstall(): ManagedFile {
  // The folder is made at install with a random name (a predictable one in a shared temp folder could be planted
  // by another user), and the managed file that names it is written only after it holds the plugin.
  let parent: string | undefined
  let file: ManagedFile | undefined
  return {
    path: managedFile({}).path,
    install() {
      parent = fs.mkdtempSync(path.join(os.tmpdir(), 'org market-'))
      const dir = path.join(parent, 'marketplace')
      buildMarketplaceFolder(dir, REPO)
      file = managedFile(orgManagedContent(dir))
      file.install()
    },
    remove() {
      try {
        file?.remove()
      } finally {
        if (parent) fs.rmSync(parent, { recursive: true, force: true })
      }
    },
  }
}

function options(): { kit: KitOptions; report?: string } {
  let v
  try {
    v = parseArgs({
      options: {
        plugin: { type: 'string' },
        'no-plugin': { type: 'boolean' },
        expect: { type: 'string', default: 'clean' },
        claude: { type: 'string' },
        'claude-arg': { type: 'string', multiple: true },
        only: { type: 'string', multiple: true },
        report: { type: 'string' },
        'require-pinned': { type: 'boolean' },
        scratch: { type: 'string' },
        keep: { type: 'boolean' },
        'allow-real-store': { type: 'boolean' },
        backup: { type: 'string' },
        outside: { type: 'boolean' },
        'safe-mode': { type: 'boolean' },
        'allow-managed-file': { type: 'boolean' },
        org: { type: 'boolean' },
        guarded: { type: 'boolean' },
      },
    }).values
  } catch (e) {
    usage(e instanceof Error ? e.message : 'bad arguments')
  }
  if (v.expect !== 'clean' && v.expect !== 'leaks') usage(`--expect must be clean or leaks, not ${v.expect}`)
  if (v.outside && v.expect === 'clean' && process.argv.includes('--expect')) usage('--outside expects every fake to be seen; it cannot be combined with --expect clean')
  // On Windows the store is a file in the run's own folder. Elsewhere it is the machine's real one.
  const withStore = v.expect === 'clean' && (process.platform === 'win32' || v['allow-real-store'] === true)
  const backup = v.backup
  if (backup !== undefined && backup !== 'user' && backup !== 'managed') usage(`--backup must be user or managed, not ${backup}`)
  if (backup !== undefined && (v.plugin || !v['no-plugin'])) usage('--backup tests the backup lock alone: pass --no-plugin, and no --plugin')
  if (backup === undefined && (v.outside || v['safe-mode'] || (v['allow-managed-file'] && !v.org && !v.guarded))) usage('--outside, --safe-mode and --allow-managed-file go with --backup')
  if (backup === 'managed' && !v['allow-managed-file']) usage('--backup managed writes the managed settings file of this machine while it runs; pass --allow-managed-file to allow it')
  if (backup === 'user' && v['allow-managed-file']) usage('--allow-managed-file goes with --backup managed')
  const tier = v.org ? 'org' : v.guarded ? 'guarded' : undefined
  if (v.org && v.guarded) usage('--org and --guarded are two different runs: pass one')
  if (tier !== undefined) {
    if (backup !== undefined || v.outside || v['safe-mode']) usage('--org and --guarded do not combine with the backup lock options')
    if (!v['allow-managed-file']) usage(`--${tier} writes the managed settings file of this machine while it runs; pass --allow-managed-file to allow it`)
    if (v['no-plugin'] || v.plugin) usage(`--${tier} tests the plugin in the repo: pass no --plugin and no --no-plugin`)
  }
  const expect = v.outside ? 'leaks' : v.expect
  const names = v.outside ? BACKUP_OUTSIDE : BACKUP_INSIDE
  const all = tier === 'org' ? SCENARIOS.filter(s => ORG_SCENARIOS.includes(s.name)) : tier === 'guarded' ? guardedScenarios() : backup === undefined ? (withStore ? [...SCENARIOS, ...STORE_SCENARIOS] : SCENARIOS) : [...SCENARIOS, ...BACKUP_ONLY].filter(s => names.includes(s.name))
  const main = path.join(REPO, 'plugin', 'backup', 'backup', 'main.js')
  if (backup !== undefined && !fs.existsSync(main)) usage('plugin/backup is not built: run npm run plugin:build')
  const unknown = (v.only ?? []).filter(n => !all.some(s => s.name === n))
  if (unknown.length > 0) usage(`unknown scenario: ${unknown.join(', ')}`)

  const plugin = v['no-plugin'] || tier === 'org' ? null : path.resolve(v.plugin ?? path.join(REPO, 'plugin'))
  if (plugin !== null && !fs.existsSync(path.join(plugin, '.claude-plugin', 'plugin.json'))) {
    usage(`no plugin at ${plugin} (it has no .claude-plugin/plugin.json); pass --plugin <dir> or --no-plugin`)
  }
  const claude = resolveClaude(v.claude ? { explicit: v.claude } : {})
  return {
    report: v.report,
    kit: {
      claude: { ...claude, args: v['claude-arg'] ?? [] },
      plugin,
      expect,
      ...(backup === undefined ? {} : { backup: { main, where: backup } }),
      ...(v['safe-mode'] ? { safeMode: true } : {}),
      ...(backup === 'managed' ? { managedFile: managedFile(managedFileContent(main)) } : {}),
      ...(tier === 'guarded' ? { managedFile: managedFile({ aegisContext: {} }), tierProof: 'guarded' as const, expectFor: (scenario: string, door: string) => (GUARDED_OPEN.includes(`${scenario}/${door}`) ? 'leaks' as const : 'clean' as const) } : {}),
      ...(tier === 'org' ? { managedFile: orgInstall(), tierProof: 'org' as const, extraEnv: { CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '1' } } : {}),
      scenarios: v.only ? all.filter(s => v.only?.includes(s.name)) : all,
      pinned: pinnedVersion(),
      requirePinned: v['require-pinned'] ?? false,
      keep: v.keep ?? false,
      ...(v.scratch ? { scratch: path.resolve(v.scratch) } : {}),
    },
  }
}

const { kit, report: reportFile } = options()
try {
  const report = await runKit(kit)
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  console.log(formatReport(report))
  process.exit(exitCodeFor(report))
} catch (e) {
  if (!(e instanceof KitError)) throw e
  console.error(`leak test: ${e.message}`)
  process.exit(2)
}
