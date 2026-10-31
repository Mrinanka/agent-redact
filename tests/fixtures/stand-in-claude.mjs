// A scripted stand-in for `claude`, so the kit's own logic runs in `npm test`
// without Claude Code installed. It gathers what the real one would send (the
// prompt, stdin and the files in its working folder) and posts it to the mock.
// The first argument picks a behaviour.

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import zlib from 'node:zlib'

const argv = process.argv.slice(2)
const mode = argv[0] ?? 'send-all'
const args = argv.slice(1)

if (args.includes('--version')) {
  console.log(mode === 'old-version' ? '1.0.0 (Claude Code)' : '2.1.316 (Claude Code)')
  process.exit(mode === 'version-fails' ? 1 : 0)
}

function promptArg() {
  const at = args.indexOf('-p')
  return at >= 0 ? args[at + 1] ?? '' : ''
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function files() {
  const out = []
  for (const name of fs.readdirSync(process.cwd())) {
    const full = path.join(process.cwd(), name)
    if (fs.statSync(full).isFile()) out.push(fs.readFileSync(full, 'utf8'))
  }
  return out
}

/** Keeps witness lines and drops the rest, like a tool that hides every secret. */
const hideAll = text => text.split('\n').filter(l => l.includes('witness-')).join('\n')

/** Drops the line after each witness: one fake per door goes unseen. */
function hideOne(text) {
  const lines = text.split('\n')
  return lines.filter((_, i) => !(lines[i - 1] ?? '').includes('witness-')).join('\n')
}

const collected = [promptArg(), readStdin(), ...files()].join('\n')

async function post(text, headers = {}, encode = b => b) {
  const body = JSON.stringify({ model: 'stand-in', max_tokens: 8, messages: [{ role: 'user', content: text }] })
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: new Uint8Array(encode(Buffer.from(body))),
  })
  await res.text()
}

function connectThroughProxy() {
  const proxy = new URL(process.env.HTTPS_PROXY)
  return new Promise(resolve => {
    const s = net.connect(Number(proxy.port), proxy.hostname, () => s.write('CONNECT telemetry.example.test:443 HTTP/1.1\r\n\r\n'))
    s.on('data', () => s.destroy())
    s.on('close', resolve)
    s.on('error', resolve)
  })
}

switch (mode) {
  case 'send-all':
  case 'old-version':
    await post(collected)
    break
  case 'hide-all':
    await post(hideAll(collected))
    break
  case 'hide-one':
    await post(hideOne(collected))
    break
  case 'send-nothing':
    break
  case 'hang':
    await new Promise(resolve => setTimeout(resolve, 60_000))
    break
  case 'exit-3':
    await post(collected)
    process.exit(3)
    break
  case 'network':
    await post(collected)
    await connectThroughProxy()
    break
  case 'gzip':
    await post(collected, { 'content-encoding': 'gzip' }, b => zlib.gzipSync(b))
    break
  case 'unknown-encoding':
    await post(collected, { 'content-encoding': 'compress' })
    break
  case 'one-unreadable':
    await post(collected)
    await post('x', { 'content-encoding': 'compress' })
    break
  case 'print-fakes':
    await post(collected)
    process.stdout.write(collected)
    process.stderr.write(collected)
    process.exit(3)
    break
  case 'show-env': {
    const names = Object.keys(process.env).filter(k => /^(ANTHROPIC|CLAUDE)_/i.test(k)).sort()
    await post(`witnessed env: ${names.join(',')}\n${collected}`)
    fs.writeFileSync(process.env.STAND_IN_ENV_FILE ?? path.join(process.cwd(), 'env.json'), JSON.stringify(names))
    break
  }
  case 'write-config': {
    fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'), { recursive: true })
    fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'session.jsonl'), collected)
    await post(collected)
    break
  }
  default:
    process.exit(64)
}
