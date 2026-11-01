// Runs the README's install line for real (plan step 6): reads the `/plugin install <name> --marketplace <owner>/<repo>`
// line from a code block in README.md, runs it as `claude plugin install` (the same flag, for a terminal) against a
// scratch Claude folder, checks the plugin shows as enabled, then uninstalls it and checks it is gone. Used by the
// release workflow on all three systems, from GitHub. Needs `claude` on the PATH and network access to GitHub.
//
// The line installs what the repo's default branch holds, not the commit being released, so it first refuses unless
// the two are the same commit. Otherwise a pass would be about other code.
//
//   node tools/release/readme-install.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LINE = /^\/plugin install ([A-Za-z0-9._-]+) --marketplace ([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\s*$/

export type InstallLine = { name: string; source: string; args: string[] }

/** The install line in the README's code blocks, and the `claude` arguments for it. */
export function installCommands(readme: string): InstallLine {
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
  return { name, source, args: ['plugin', 'install', name, '--marketplace', source] }
}

/** The problem with installing from GitHub, given this commit and `git ls-remote <repo> HEAD`, or undefined when they match. */
export function headProblem(local: string, lsRemote: string): string | undefined {
  const remote = /^([0-9a-f]{40})\s+HEAD\s*$/m.exec(lsRemote)?.[1]
  if (!remote) return 'could not read the default branch of the repository from GitHub'
  if (remote !== local) return `the default branch is at ${remote.slice(0, 12)}, not ${local.slice(0, 12)}, so the install would test other code: tag the tip of the default branch`
  return undefined
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8', timeout: 60_000 })
  return r.status === 0 ? r.stdout : ''
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
  const { name, source, args } = installCommands(readme)
  const problem = headProblem(git(['rev-parse', 'HEAD']).trim(), git(['ls-remote', `https://github.com/${source}.git`, 'HEAD']))
  if (problem) {
    console.error(`readme-install: ${problem}`)
    process.exitCode = 1
    return
  }
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-install-'))
  try {
    const r = claude(config, args)
    console.log(`claude ${args.join(' ')} -> ${r.status}`)
    if (r.status !== 0) throw new Error(`${args.join(' ')} failed:\n${r.out}`)
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
