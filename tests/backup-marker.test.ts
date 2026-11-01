// The marker the backup lock reads (spec §5.2, R-04, plan step 5 "Marker freshness").
// The main lock writes it; the backup lock stands down only for a fresh `running: true`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BEAT_MS, FRESH_MS, isMainLockAlive, markerPath, parseMarker, readMarker, type Marker } from '../src/backup/marker.ts'

const NOW = 1_800_000_000_000
const alive = (over: Partial<Marker> = {}): Marker => ({ running: true, started: NOW - 10_000, beat: NOW - 1000, version: '0.1.0', ...over })

test('a running marker with a fresh beat means the main lock is alive', () => {
  assert.equal(isMainLockAlive(alive(), NOW), true)
  assert.equal(isMainLockAlive(alive({ beat: NOW - FRESH_MS }), NOW), true)
})

test('the beat interval is well inside the freshness window', () => {
  assert.ok(BEAT_MS * 4 <= FRESH_MS)
})

test('ended, missing and not-running markers do not count', () => {
  assert.equal(isMainLockAlive(alive({ running: false, ended: NOW - 5 }), NOW), false)
  assert.equal(isMainLockAlive(undefined, NOW), false)
  assert.equal(isMainLockAlive(null, NOW), false)
})

test('a crash leaves running: true, and a stale beat stops counting', () => {
  assert.equal(isMainLockAlive(alive({ beat: NOW - FRESH_MS - 1 }), NOW), false)
  assert.equal(isMainLockAlive(alive({ beat: NOW - 24 * 3600_000 }), NOW), false)
})

test('a marker with no beat is not alive (an old marker, or one made by hand)', () => {
  const { beat: _beat, ...noBeat } = alive()
  assert.equal(isMainLockAlive(noBeat, NOW), false)
})

test('a beat in the future is not alive, apart from a few seconds of clock difference', () => {
  assert.equal(isMainLockAlive(alive({ beat: NOW + 3000 }), NOW), true)
  assert.equal(isMainLockAlive(alive({ beat: NOW + 60_000 }), NOW), false)
  assert.equal(isMainLockAlive(alive({ beat: NOW + 10 * 365 * 24 * 3600_000 }), NOW), false)
})

test('odd values never count as alive', () => {
  for (const beat of [Number.NaN, Number.POSITIVE_INFINITY, -1, '1800000000000', null, {}, [], true]) {
    assert.equal(isMainLockAlive({ running: true, beat, version: 'x' } as unknown as Marker, NOW), false, String(beat))
  }
  for (const running of ['true', 1, null, undefined]) {
    assert.equal(isMainLockAlive({ running, beat: NOW, version: 'x' } as unknown as Marker, NOW), false, String(running))
  }
})

test('parseMarker takes JSON objects only', () => {
  assert.deepEqual(parseMarker(JSON.stringify(alive())), alive())
  for (const bad of ['', 'not json', '[]', '"x"', 'null', '123', '{"running":']) assert.equal(parseMarker(bad), undefined, bad)
})

test('markerPath refuses a session id that could leave the folder', () => {
  const dir = path.join(os.tmpdir(), 'cfg')
  assert.equal(markerPath(dir, 'abc-123_X'), path.join(dir, 'aegiscontext', 'markers', 'abc-123_X.json'))
  for (const bad of ['../x', '..\\x', 'a/b', '', 'x'.repeat(129), 'a b', undefined, 42, null]) assert.equal(markerPath(dir, bad as never), undefined, String(bad))
})

test('readMarker reads a file, and anything wrong with it reads as no marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-'))
  try {
    const file = markerPath(dir, 'sess1') as string
    assert.equal(readMarker(dir, 'sess1'), undefined, 'missing')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(alive()))
    assert.deepEqual(readMarker(dir, 'sess1'), alive())
    fs.writeFileSync(file, '{ broken')
    assert.equal(readMarker(dir, 'sess1'), undefined, 'bad JSON')
    fs.writeFileSync(file, '')
    assert.equal(readMarker(dir, 'sess1'), undefined, 'empty')
    assert.equal(readMarker(dir, '../sess1'), undefined, 'odd id')
    fs.rmSync(file)
    fs.mkdirSync(file)
    assert.equal(readMarker(dir, 'sess1'), undefined, 'a folder where the file should be')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a huge marker file is not read whole', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-'))
  try {
    const file = markerPath(dir, 'big') as string
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...alive(), pad: 'x'.repeat(200_000) }))
    assert.equal(readMarker(dir, 'big'), undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
