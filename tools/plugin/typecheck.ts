// npm run plugin:typecheck: type-checks the mod against the Claude Code API types, because
// `claude plugin validate` doesn't catch type errors. The types come from the pinned Claude Code or a
// path passed in; the tsconfig is the one the types file's header gives, written outside the repo,
// since Claude Code writes its own tsconfig.json beside a loaded mod.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..', '..')
const local = path.join(root, 'plugin', '.claude-plugin', 'types', 'claude-code', 'index.d.ts')
const types = path.resolve(process.argv[2] ?? local)
if (!fs.existsSync(types)) {
  console.error(`no API types at ${types}: pass the path to claude-code.d.ts, or load the mod once so Claude Code writes them`)
  process.exit(2)
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-typecheck-'))
const config = path.join(dir, 'tsconfig.json')
fs.writeFileSync(config, JSON.stringify({
  compilerOptions: {
    target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler',
    strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true,
    jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
    paths: { 'claude-code': [types], 'claude-code/testing': [types] },
  },
  include: [types, path.join(root, 'plugin', 'hooks', '**', '*.ts'), path.join(root, 'plugin', 'hooks', '**', '*.tsx'), path.join(root, 'plugin', 'types', '*.d.ts')],
}))
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const r = spawnSync(process.execPath, [tsc, '-p', config], { encoding: 'utf8', cwd: root })
fs.rmSync(dir, { recursive: true, force: true })
process.stdout.write(r.stdout ?? '')
process.stderr.write(r.stderr ?? '')
if (r.status === 0) console.log('plugin type-check passed')
process.exit(r.status ?? 1)
