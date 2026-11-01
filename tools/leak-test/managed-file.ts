// The machine's managed settings file, for the kit's managed run (plan step 5, D-020). It applies to every
// Claude Code session on the machine while it exists, so the kit touches it only when asked (--allow-managed-file),
// never overwrites a file that is already there, and removes its own in `finally`.
//
//   Windows  C:\Program Files\ClaudeCode\managed-settings.json   (needs an administrator)
//   macOS    /Library/Application Support/ClaudeCode/managed-settings.json   (sudo)
//   Linux    /etc/claude-code/managed-settings.json   (sudo)
//
// Windows runners of CI are administrators; elsewhere the write goes through `sudo -n` (no password prompt).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { managedLocation } from '../../src/backup/settings.ts'

export type ManagedFile = {
  /** Where it goes, for messages. */
  path: string
  install(): void
  remove(): void
}

export class ManagedFileError extends Error {}

type Runner = (cmd: string, args: string[], input?: string) => { status: number | null }

const run: Runner = (cmd, args, input) => spawnSync(cmd, args, { input: input ?? '', encoding: 'utf8', timeout: 30_000 })

export function managedFile(content: unknown, o: { platform?: NodeJS.Platform; run?: Runner; fsImpl?: Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'writeFileSync' | 'rmSync'> } = {}): ManagedFile {
  const platform = o.platform ?? process.platform
  const sh = o.run ?? run
  const f = o.fsImpl ?? fs
  const { dir, file } = managedLocation(platform)
  const text = `${JSON.stringify(content, null, 2)}\n`
  let installed = false
  return {
    path: file,
    install() {
      if (f.existsSync(file)) throw new ManagedFileError(`${file} already exists; the kit will not overwrite a managed settings file`)
      if (platform === 'win32') {
        try {
          f.mkdirSync(dir, { recursive: true })
          f.writeFileSync(file, text)
        } catch {
          throw new ManagedFileError(`could not write ${file}: run as an administrator`)
        }
      } else {
        if (sh('sudo', ['-n', 'mkdir', '-p', dir]).status !== 0 || sh('sudo', ['-n', 'tee', file], text).status !== 0) {
          throw new ManagedFileError(`could not write ${file}: sudo -n failed`)
        }
      }
      installed = true
    },
    remove() {
      if (!installed) return
      installed = false
      if (platform === 'win32') f.rmSync(file, { force: true })
      else if (sh('sudo', ['-n', 'rm', '-f', file]).status !== 0) throw new ManagedFileError(`could not remove ${file}: remove it by hand`)
    },
  }
}

export const managedFolderOf = (platform: NodeJS.Platform = process.platform): string => path.dirname(managedLocation(platform).file)
