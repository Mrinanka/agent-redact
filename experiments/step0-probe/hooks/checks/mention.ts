// Check 0.2: can a user-tier plugin's prompt.mention hook point an `@` file at
// a redacted copy? With on-mention, each mentioned file is read, its canaries
// replaced by [HIDDEN], the copy written under .step0-probe/, and the read
// redirected there. If the copy can't be made, the mention is refused.

import type { On } from 'claude-code'
import { CANARY_RE, LOG_DIR, checkLine, hasCanary, isOn, joinPath, label } from './common.ts'
import { append } from '../log.ts'

let copies = 0

export function registerMention(on: On): void {
  on('prompt.mention', async ($, e, next) => {
    if (!(await isOn($, 'mention'))) return next(e)
    const text = String(await $.fs.read(e.path))
    copies += 1
    const copy = joinPath(await $.session.cwd(), LOG_DIR, `mention-copy-${copies}.txt`)
    await $.fs.write(copy, text.replace(CANARY_RE, '[HIDDEN]'))
    const out = await next({ ...e, path: copy })
    await append($, await checkLine($, '0.2', {
      step: 'redirect',
      redirected: true,
      attached: out.deny === undefined ? label(out.type ?? 'none') : 'denied',
      hadCanary: hasCanary(text),
      agent: e.agentId !== undefined,
    }))
    return out
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    await append($, await checkLine($, '0.2', { step: 'refused', failure: next.error.kind }))
    return { deny: 'step0-probe: could not make a redacted copy' }
  })
}
