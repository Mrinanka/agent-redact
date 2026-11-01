// Runs the README's install line for real (plan step 6): reads the `/plugin install <name> --marketplace <owner>/<repo>`
// line from a code block in README.md, turns it into the two `claude plugin` commands, runs them against a scratch
// Claude folder, checks the plugin shows as enabled, then uninstalls it and checks it is gone. Used by the release
// workflow on all three systems, from GitHub. Needs `claude` on the PATH and network access to GitHub.
//
//   node tools/release/readme-install.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LINE = /^\/plugin install ([A-Za-z0-9._-]+) --marketplace ([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\s*$/

/** The `claude` arguments for the install line in the README's code blocks. */
export function installCommands(readme: string): string[][] {
  const lines: string[] = []
  let inBlock = false
  for (const raw of readme.split(/\r?\n/)) {
    if (/^```/.test(raw)) {
      inBlock = !inBlock
      continue
    }
    if (inBlock && raw.startsWith('/plugin install')) lines.push(raw)
  }
  if (lines.length === 0) throw new Error('no install line found in a code block of the README')
  const unique = [...new Set(lines)]
  if (unique.length > 1) throw new Error('more than one different install line in the README')
  const m = LINE.exec(unique[0] as string)
  if (!m) throw new Error(`unexpected characters in the install line: ${(unique[0] as string).slice(0, 80)}`)
  const [, name, source] = m as unknown as [string, string, string]
  return [
    ['plugin', 'marketplace', 'add', source],
    ['plugin', 'install', `${name}@${name}`],
  ]
}

function claude(config: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: 180_000,
    shell: process.platform === 'win32',
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' },
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

function main(): void {
  const readme = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'README.md'), 'utf8')
  const commands = installCommands(readme)
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-install-'))
  try {
    for (const args of commands) {
      const r = claude(config, args)
      console.log(`claude ${args.join(' ')} -> ${r.status}`)
      if (r.status !== 0) throw new Error(`${args.join(' ')} failed:\n${r.out}`)
    }
    const name = (commands[1] as string[])[2] as string
    const listed = claude(config, ['plugin', 'list'])
    if (!listed.out.includes(name) || !/enabled/.test(listed.out)) throw new Error(`${name} is not listed as enabled after the install:\n${listed.out}`)
    console.log(`${name} is installed and enabled`)
    const removed = claude(config, ['plugin', 'uninstall', name])
    if (removed.status !== 0) throw new Error(`uninstall failed:\n${removed.out}`)
    if (claude(config, ['plugin', 'list']).out.includes(name)) throw new Error(`${name} is still listed after the uninstall`)
    console.log('uninstalled; the README install works')
  } catch (e) {
    console.error(`readme-install: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  } finally {
    fs.rmSync(config, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main()
