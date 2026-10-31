// The leak test kit's command line (spec §20).
//
//   node tools/leak-test/run.ts [--plugin <dir> | --no-plugin] [--expect clean|leaks]
//     [--claude <path>] [--only <scenario>]... [--report <file>]
//     [--require-pinned] [--scratch <dir>] [--keep]
//
// Exit codes: 0 pass, 1 leak (or a blind baseline), 2 invalid run or bad usage.

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pinnedVersion, resolveClaude } from './claude-bin.ts'
import { exitCodeFor, KitError, runKit, type KitOptions } from './kit.ts'
import { formatReport } from './report.ts'
import { SCENARIOS } from './scenarios.ts'

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
scenarios: ${SCENARIOS.map(s => s.name).join(', ')}`

function usage(message: string): never {
  console.error(`${message}\n${USAGE}`)
  process.exit(2)
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
      },
    }).values
  } catch (e) {
    usage(e instanceof Error ? e.message : 'bad arguments')
  }
  if (v.expect !== 'clean' && v.expect !== 'leaks') usage(`--expect must be clean or leaks, not ${v.expect}`)
  const unknown = (v.only ?? []).filter(n => !SCENARIOS.some(s => s.name === n))
  if (unknown.length > 0) usage(`unknown scenario: ${unknown.join(', ')}`)

  const plugin = v['no-plugin'] ? null : path.resolve(v.plugin ?? path.join(REPO, 'plugin'))
  if (plugin !== null && !fs.existsSync(path.join(plugin, '.claude-plugin', 'plugin.json'))) {
    usage(`no plugin at ${plugin} (it has no .claude-plugin/plugin.json); pass --plugin <dir> or --no-plugin`)
  }
  const claude = resolveClaude(v.claude ? { explicit: v.claude } : {})
  return {
    report: v.report,
    kit: {
      claude: { ...claude, args: v['claude-arg'] ?? [] },
      plugin,
      expect: v.expect,
      scenarios: v.only ? SCENARIOS.filter(s => v.only?.includes(s.name)) : SCENARIOS,
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
