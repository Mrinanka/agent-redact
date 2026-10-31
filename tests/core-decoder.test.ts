// Decoder (spec §18 step 4): finds what looks encoded, decodes it into one buffer per layer,
// and maps every decoded character back to the span it came from in the original text.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { decodeLayers, sourceSpan, type Layer } from '../src/core/decoder.ts'
import { speedSet } from '../tools/test-sets/speed.ts'

const FAR = Number.POSITIVE_INFINITY
const SECRET = ['ghp', 'Qw3rTy7UiOp9AsDf1GhJk5LzXc8VbNm2ZxCv'].join('_')
const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64')

function find(text: string, needle: string, max = 3): { layer: Layer; at: number } | undefined {
  const { layers } = decodeLayers(text, { maxLayers: max, deadline: FAR })
  for (const layer of layers) {
    const at = layer.text.indexOf(needle)
    if (at >= 0) return { layer, at }
  }
  return undefined
}

function spanOf(text: string, needle: string): string | undefined {
  const f = find(text, needle)
  if (!f) return undefined
  const [s, e] = sourceSpan(f.layer, f.at, f.at + needle.length)
  return text.slice(s, e)
}

test('base64: decoded, and the source span covers the encoded secret (within 2 characters each side)', () => {
  const text = `config:\nblob=${b64(`token=${SECRET};x`)}\nend`
  const span = spanOf(text, SECRET) as string
  assert.ok(span, 'found')
  const core = b64(SECRET).slice(4, -4)
  assert.ok(span.includes(core), 'covers the characters that depend only on the secret')
  const whole = text.indexOf(b64(`token=${SECRET};x`))
  assert.ok(text.indexOf(span) >= whole && text.indexOf(span) + span.length <= whole + b64(`token=${SECRET};x`).length)
})

test('base64url, unpadded, and padded forms are decoded', () => {
  const raw = `v1/${SECRET}~~`
  const url = Buffer.from(raw).toString('base64url')
  assert.ok(find(`x ${url} y`, SECRET))
  assert.ok(find(`x ${b64(raw)} y`, SECRET))
})

test('hex: decoded, and the source span is exact to the byte', () => {
  const hex = Buffer.from(`key:${SECRET}!`).toString('hex')
  const text = `id=${hex}.`
  const span = spanOf(text, SECRET) as string
  assert.equal(span, Buffer.from(SECRET).toString('hex'))
})

test('hex: an odd number of digits still decodes the even part', () => {
  const hex = Buffer.from(`key:${SECRET}!`).toString('hex') + 'a'
  assert.ok(find(`id=${hex}`, SECRET))
})

test('percent-encoding: decoded, with an exact span, including a lone % that is not an escape', () => {
  const enc = encodeURIComponent(`pass word=${SECRET}&x=100%`)
  const text = `GET /a?q=${enc} HTTP/1.1`
  const span = spanOf(text, SECRET) as string
  assert.equal(span, SECRET)
  assert.equal(find('50% off and %zz and 100%', 'anything'), undefined)
})

test('json escapes: decoded once per layer, with the escape included in the span', () => {
  const once = JSON.stringify(`line1\n"${SECRET}"`).slice(1, -1)
  const text = `{"log":"${once}"}`
  const f = find(text, `"${SECRET}"`)
  assert.ok(f)
  const [s, e] = sourceSpan((f as { layer: Layer }).layer, (f as { at: number }).at, (f as { at: number }).at + SECRET.length + 2)
  assert.equal(text.slice(s, e), `\\"${SECRET}\\"`)
  const unicode = text.replace('Q', '\\u0051')
  assert.ok(find(unicode, SECRET))
})

test('three layers are found, a fourth is not', () => {
  const l1 = b64(`x=${SECRET}`)
  const l2 = b64(l1)
  const l3 = b64(l2)
  const l4 = b64(l3)
  assert.ok(find(`v ${l1}`, SECRET))
  assert.ok(find(`v ${l2}`, SECRET))
  assert.ok(find(`v ${l3}`, SECRET))
  assert.equal(find(`v ${l4}`, SECRET), undefined)
  // The span of a deep find still points at the original text.
  const span = spanOf(`v ${l3}`, SECRET) as string
  assert.ok(l3.includes(span) && span.length > 20)
})

test('line-wrapped base64 (76 and 64 columns, LF and CRLF)', () => {
  const body = b64(`filler ${'z'.repeat(80)} ${SECRET} tail ${'y'.repeat(80)}`)
  for (const [width, eol] of [[76, '\n'], [64, '\r\n'], [64, '\n']] as const) {
    const wrapped = body.match(new RegExp(`.{1,${width}}`, 'g'))!.join(eol)
    const text = `-----\n${wrapped}\n-----\n`
    const f = find(text, SECRET)
    assert.ok(f, `width ${width}`)
    const [s, e] = sourceSpan((f as { layer: Layer }).layer, (f as { at: number }).at, (f as { at: number }).at + SECRET.length)
    assert.ok(text.slice(s, e).replace(/\r?\n/g, '').length >= Math.floor(SECRET.length * 4 / 3) - 1)
  }
})

test('bad padding and runs that do not decode to text are left alone', () => {
  assert.equal(find(`x=${b64(SECRET)}=====`, SECRET) === undefined, false, 'extra padding still decodes')
  const noise = Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 37 + 200) & 255))
  const { layers } = decodeLayers(`data ${noise.toString('base64')}`, { deadline: FAR })
  assert.equal(layers.length, 0, 'binary noise under 256 bytes is not decoded')
  // Words of 16 or more letters are not base64.
  assert.equal(decodeLayers('internationalizationally supercalifragilistic', { deadline: FAR }).layers.length, 0)
})

test('invalid UTF-8 and binary filler decode byte for byte', () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe, 0x80]), Buffer.from(` ${SECRET} `), Buffer.from([0xc3, 0x28])])
  const long = Buffer.concat([Buffer.alloc(300, 0x01), bytes, Buffer.alloc(300, 0x02)])
  assert.ok(find(`blob=${long.toString('base64')}`, SECRET), 'long runs have no printable gate')
})

test('a secret inside the 2 MB base64 block of the speed set is found', () => {
  const item = speedSet().find(i => i.id === 'base64-block-2m')!
  const text = item.text()
  const t0 = performance.now()
  const f = find(text, item.secret as string)
  const ms = performance.now() - t0
  assert.ok(f, 'found')
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms`)
})

test('100,000 small runs cost one buffer, not 100,000', () => {
  const runs: string[] = []
  for (let i = 0; i < 100_000; i++) runs.push(Buffer.from(`user-${i}-value`).toString('base64'))
  const text = runs.join(' ') + ` ${b64(`k=${SECRET}`)}`
  const t0 = performance.now()
  const { layers, complete } = decodeLayers(text, { maxLayers: 1, deadline: FAR })
  const ms = performance.now() - t0
  assert.equal(layers.length, 1)
  assert.equal(complete, true)
  assert.ok(layers[0]!.text.includes(SECRET))
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`)
})

test('past the deadline the layers so far come back with complete: false', () => {
  const text = (b64('some printable text here ') + ' ').repeat(200_000)
  const r = decodeLayers(text, { deadline: performance.now() - 1 })
  assert.equal(r.complete, false)
})

test('text with nothing encoded gives no layers, quickly', () => {
  const plain = 'The quick brown fox jumps over the lazy dog. '.repeat(50_000)
  const t0 = performance.now()
  const r = decodeLayers(plain, { deadline: FAR })
  assert.equal(r.layers.length, 0)
  assert.equal(r.complete, true)
  assert.ok(performance.now() - t0 < 500)
})

test('the decoder scans by hand: no regular expression runs over the text', () => {
  const file = path.join(import.meta.dirname, '..', 'src', 'core', 'decoder.ts')
  const code = fs.readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.ok(!/\.(?:replace|replaceAll|match|matchAll|search|split|test|exec)\(\s*\//.test(code), 'a method called with a regex literal')
  assert.ok(!/new RegExp/.test(code))
})
