// The release archive tool (plan step 6, spec §19): `git archive` of the committed tree as .tar.gz and .zip, with
// SHA256SUMS. It refuses a dirty tree, a tag that does not match the version, and an existing output. Tested on
// throw-away git repositories, so a path with spaces and a CRLF-converting checkout are covered.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkTag, packRelease, parseSums, sha256Of, verifySums } from '../tools/release/pack.ts'

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

function repo(version = '0.1.0'): { dir: string; out: string; done: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'release pack-'))
  const dir = path.join(base, 'the repo')
  fs.mkdirSync(dir)
  git(dir, 'init', '-q')
  git(dir, 'config', 'core.autocrlf', 'true')
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* text=auto eol=lf\n')
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }))
  fs.writeFileSync(path.join(dir, 'a file with spaces.md'), 'line one\nline two\n')
  fs.mkdirSync(path.join(dir, 'sub dir'))
  fs.writeFileSync(path.join(dir, 'sub dir', 'code.ts'), 'export const x = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'one')
  return { dir, out: path.join(base, 'out dir'), done: () => fs.rmSync(base, { recursive: true, force: true }) }
}

test('a tag must be v<version>, optionally -rc.N, and match the package version', () => {
  assert.equal(checkTag('v0.1.0', '0.1.0'), undefined)
  assert.equal(checkTag('v0.1.0-rc.1', '0.1.0'), undefined)
  assert.match(checkTag('v0.1.1', '0.1.0') ?? '', /does not match/)
  assert.match(checkTag('0.1.0', '0.1.0') ?? '', /form/)
  assert.match(checkTag('v0.1.0-beta', '0.1.0') ?? '', /form/)
  assert.match(checkTag('v0.1.0; rm -rf', '0.1.0') ?? '', /form/)
})

test('it makes both archives and the checksums, which verify', () => {
  const r = repo()
  try {
    const made = packRelease({ root: r.dir, tag: 'v0.1.0-rc.1', out: r.out })
    assert.deepEqual(made.files.sort(), ['SHA256SUMS', 'aegiscontext-v0.1.0-rc.1.tar.gz', 'aegiscontext-v0.1.0-rc.1.zip'])
    assert.equal(verifySums(r.out), undefined)
    const zip = fs.readFileSync(path.join(r.out, 'aegiscontext-v0.1.0-rc.1.zip'))
    assert.equal(zip.subarray(0, 2).toString(), 'PK')
    const gz = fs.readFileSync(path.join(r.out, 'aegiscontext-v0.1.0-rc.1.tar.gz'))
    assert.deepEqual([...gz.subarray(0, 2)], [0x1f, 0x8b])
  } finally {
    r.done()
  }
})

test('the checksum file is LF text of "<hash>  <name>" lines, and a changed archive fails the check', () => {
  const r = repo()
  try {
    packRelease({ root: r.dir, tag: 'v0.1.0', out: r.out })
    const raw = fs.readFileSync(path.join(r.out, 'SHA256SUMS'), 'utf8')
    assert.ok(!raw.includes('\r'))
    const sums = parseSums(raw)
    assert.equal(sums.length, 2)
    for (const s of sums) assert.match(s.hash, /^[0-9a-f]{64}$/)
    assert.equal(sums[0]?.hash, sha256Of(path.join(r.out, sums[0]?.name ?? '')))
    fs.appendFileSync(path.join(r.out, 'aegiscontext-v0.1.0.zip'), 'x')
    assert.match(verifySums(r.out) ?? '', /aegiscontext-v0\.1\.0\.zip/)
  } finally {
    r.done()
  }
})

test('the archive holds the committed files, text with LF even when the checkout converts to CRLF, and a path with spaces', () => {
  const r = repo()
  try {
    packRelease({ root: r.dir, tag: 'v0.1.0', out: r.out })
    const into = path.join(r.out, 'unpacked')
    fs.mkdirSync(into)
    // Relative paths from the output folder: GNU tar reads "C:" in an absolute Windows path as a remote host.
    const t = spawnSync('tar', ['-xzf', 'aegiscontext-v0.1.0.tar.gz', '-C', 'unpacked'], { cwd: r.out, encoding: 'utf8' })
    assert.equal(t.status, 0, t.stderr)
    const top = path.join(into, 'aegiscontext-v0.1.0')
    assert.equal(fs.readFileSync(path.join(top, 'a file with spaces.md'), 'utf8'), 'line one\nline two\n')
    assert.equal(fs.readFileSync(path.join(top, 'sub dir', 'code.ts'), 'utf8'), 'export const x = 1\n')
  } finally {
    r.done()
  }
})

test('it refuses a dirty tree: a changed file, a new file, and a staged one', () => {
  const r = repo()
  try {
    fs.appendFileSync(path.join(r.dir, 'package.json'), ' ')
    assert.throws(() => packRelease({ root: r.dir, tag: 'v0.1.0', out: r.out }), /not clean|dirty/i)
    git(r.dir, 'checkout', '--', 'package.json')
    fs.writeFileSync(path.join(r.dir, 'new.txt'), 'x')
    assert.throws(() => packRelease({ root: r.dir, tag: 'v0.1.0', out: r.out }), /not clean|dirty/i)
    git(r.dir, 'add', 'new.txt')
    assert.throws(() => packRelease({ root: r.dir, tag: 'v0.1.0', out: r.out }), /not clean|dirty/i)
    assert.ok(!fs.existsSync(r.out), 'nothing is written when it refuses')
  } finally {
    r.done()
  }
})

test('it refuses a tag that does not match the version, and an output that already holds archives', () => {
  const r = repo('0.2.0')
  try {
    assert.throws(() => packRelease({ root: r.dir, tag: 'v0.1.0', out: r.out }), /does not match/)
    assert.ok(!fs.existsSync(r.out))
    packRelease({ root: r.dir, tag: 'v0.2.0', out: r.out })
    assert.throws(() => packRelease({ root: r.dir, tag: 'v0.2.0', out: r.out }), /already/)
  } finally {
    r.done()
  }
})

test('verifySums says so when there is no checksum file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sums-'))
  try {
    assert.match(verifySums(dir) ?? '', /SHA256SUMS/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
