// Prints the folder of the pinned Claude Code binary, for CI to put on PATH
// (node tools/leak-test/claude-path.ts >> "$GITHUB_PATH"). Fails if it isn't installed.

import path from 'node:path'
import { resolveClaude } from './claude-bin.ts'

const { cmd } = resolveClaude()
if (cmd === 'claude') {
  console.error('the pinned Claude Code is not installed: run npm ci --ignore-scripts --prefix tools/leak-test/claude-pin')
  process.exit(1)
}
console.log(path.dirname(cmd))
