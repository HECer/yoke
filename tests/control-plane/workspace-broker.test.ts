import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureWorkspaceSnapshot, createWorkspaceSnapshot, contentDigest, snapshotEntries, workspacePath, SNAPSHOT_LIMITS } from '../../src/control-plane/workspace-snapshot.js'
import { createWorkspaceBroker, parseWorkspaceEdits } from '../../src/control-plane/workspace-broker.js'

const roots: string[] = []
function temporary() { const root = mkdtempSync(join(tmpdir(), 'yoke-snapshot-')); roots.push(root); return root }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
const entry = (path = 'src/a.txt', content: string | null = 'old') => ({ path, content, executable: false })
const base = () => createWorkspaceSnapshot([entry(), entry('src/b.txt'), entry('tests/gate.cjs'), entry('src/new.txt', null)])
const edit = (path = 'src/a.txt', content: string | null = 'new') => ({ path, content, expectedSha256: contentDigest('old') })

it('snapshots detach source values and expose frozen metadata, not buffers or maps', () => {
  const original = [entry()]; const snapshot = createWorkspaceSnapshot(original)
  original[0].content = 'mutated'; original.push(entry('other'))
  expect(snapshot.read('src/a.txt')).toBe('old')
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(snapshot.files)).toBe(true)
  expect(Object.isFrozen(snapshot.files[0])).toBe(true)
  expect(() => { (snapshot.files[0] as any).sha256 = 'forged' }).toThrow()
  expect(Object.isFrozen(snapshotEntries(snapshot)[0])).toBe(true)
})
it('file order does not change the content identity', () => {
  const a = entry(), b = entry('src/b.txt', '')
  expect(createWorkspaceSnapshot([a, b]).id).toBe(createWorkspaceSnapshot([b, a]).id)
})
it('missing and empty files have distinct identities and lookup semantics', () => {
  const missing = createWorkspaceSnapshot([entry('src/a.txt', null)])
  const empty = createWorkspaceSnapshot([entry('src/a.txt', '')])
  expect(missing.id).not.toBe(empty.id); expect(missing.read('src/a.txt')).toBeNull()
  expect(empty.read('src/a.txt')).toBe(''); expect(empty.files[0].sha256).toBe(contentDigest(''))
  expect(() => missing.read('outside')).toThrow(/outside/)
})
it('executable intent participates in snapshot identity', () => {
  expect(createWorkspaceSnapshot([{ ...entry(), executable: true }]).id).not.toBe(createWorkspaceSnapshot([entry()]).id)
})
it('disk capture remains immutable when the file later changes', () => {
  const root = temporary(); writeFileSync(join(root, 'a'), 'one\n')
  const snapshot = captureWorkspaceSnapshot(root, ['a', 'new'])
  writeFileSync(join(root, 'a'), 'two\n'); writeFileSync(join(root, 'new'), 'new')
  expect(snapshot.read('a')).toBe('one\n'); expect(snapshot.read('new')).toBeNull()
  expect(captureWorkspaceSnapshot(root, ['a', 'new']).id).not.toBe(snapshot.id)
})
it('capture rejects non-UTF8 bytes rather than lossy decoding', () => {
  const root = temporary(); writeFileSync(join(root, 'a'), Buffer.from([0xff, 0xfe]))
  expect(() => captureWorkspaceSnapshot(root, ['a'])).toThrow(/UTF-8/)
})
it('capture refuses directory links before following their descendants', () => {
  const root = temporary(), outside = temporary(); writeFileSync(join(outside, 'secret'), 'not a workspace file')
  symlinkSync(outside, join(root, 'linked'), 'junction')
  expect(() => captureWorkspaceSnapshot(root, ['linked/secret'])).toThrow(/links/)
})
it('capture refuses directories and multiply-linked files', () => {
  const root = temporary(); mkdirSync(join(root, 'dir')); writeFileSync(join(root, 'a'), 'old'); linkSync(join(root, 'a'), join(root, 'b'))
  expect(() => captureWorkspaceSnapshot(root, ['dir'])).toThrow(/regular/)
  expect(() => captureWorkspaceSnapshot(root, ['b'])).toThrow(/regular/)
})
it.runIf(process.platform !== 'win32' || process.env.YOKE_INCLUDE_PLATFORM_TESTS === '1')('captures executable source mode', () => {
  const root = temporary(); writeFileSync(join(root, 'a'), 'old'); chmodSync(join(root, 'a'), 0o755)
  expect(captureWorkspaceSnapshot(root, ['a']).files[0].executable).toBe(true)
})
for (const path of ['', '../x', '/abs', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'C:/x', 'a:*', '.git/config', 'src/.GIT/index', 'a\n', 'NUL.txt', 'src/COM1', 'a./b', 'a /b', ' a/b']) {
  it(`rejects unsafe workspace path ${JSON.stringify(path)}`, () => expect(() => workspacePath(path)).toThrow())
}
it('rejects aliased and ancestor-overlapping file entries', () => {
  expect(() => createWorkspaceSnapshot([entry(), entry('SRC/A.TXT')])).toThrow(/alias/)
  expect(() => createWorkspaceSnapshot([entry('a', null), entry('a/b', null)])).toThrow(/Overlapping/)
})
it('enforces file count, byte quotas and lossless string encoding', () => {
  expect(() => createWorkspaceSnapshot([])).toThrow()
  expect(() => createWorkspaceSnapshot(Array.from({ length: 201 }, (_, i) => entry(`a${i}`)))).toThrow()
  expect(() => createWorkspaceSnapshot([entry('a', 'a'.repeat(SNAPSHOT_LIMITS.fileBytes + 1))])).toThrow(/quota/)
  expect(() => createWorkspaceSnapshot(Array.from({ length: 9 }, (_, i) => entry(`a${i}`, 'a'.repeat(SNAPSHOT_LIMITS.fileBytes))))).toThrow(/quota/)
  expect(() => createWorkspaceSnapshot([entry('a', '\ud800')])).toThrow(/UTF-8/)
  expect(() => createWorkspaceSnapshot([{ ...entry('a', null), executable: true }])).toThrow()
})
it('checks disk file quota before reading the file', () => {
  const root = temporary(); writeFileSync(join(root, 'large'), 'x'.repeat(SNAPSHOT_LIMITS.fileBytes + 1))
  expect(() => captureWorkspaceSnapshot(root, ['large'])).toThrow(/quota/)
})
it('a caller-fabricated snapshot never supplies broker authority', () => {
  const snapshot = base()
  expect(() => createWorkspaceBroker({ ...snapshot }, ['src'])).toThrow(/native snapshot/)
})
it('many readers reuse one immutable snapshot while a single writer publishes a new revision', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src'])
  const readers = Array.from({ length: 20 }, () => broker.reader.snapshot())
  const writer = broker.acquireWriter(); const next = writer.apply(snapshot.id, [edit()])
  expect(readers.every(reader => reader === snapshot)).toBe(true)
  expect(readers.every(reader => reader.read('src/a.txt') === 'old')).toBe(true)
  expect(broker.reader.snapshot()).toBe(next); expect(next.read('src/a.txt')).toBe('new')
  expect((broker.reader as any).apply).toBeUndefined()
})
it('rejects a second writer and cannot seal an active writer', () => {
  const broker = createWorkspaceBroker(base(), ['src']); broker.acquireWriter()
  expect(() => broker.acquireWriter()).toThrow(/already has a writer/)
  expect(() => broker.seal()).toThrow(/Release/)
})
it('revokes old handles without letting an old release revoke its successor', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src'])
  const old = broker.acquireWriter(); old.release(); const successor = broker.acquireWriter(); old.release()
  expect(() => old.apply(snapshot.id, [edit()])).toThrow(/authority/)
  expect(() => broker.acquireWriter()).toThrow()
  expect(successor.apply(snapshot.id, [edit()]).read('src/a.txt')).toBe('new')
  successor.release(); expect(broker.seal().read('src/a.txt')).toBe('new')
  expect(() => broker.acquireWriter()).toThrow(/sealed/)
})
it('enforces whole-revision and per-file compare-and-swap', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src']), writer = broker.acquireWriter()
  expect(() => writer.apply(snapshot.id, [{ ...edit(), expectedSha256: contentDigest('wrong') }])).toThrow(/precondition/)
  const next = writer.apply(snapshot.id, [edit()])
  expect(() => writer.apply(snapshot.id, [edit('src/b.txt')])).toThrow(/older/)
  expect(next.read('src/b.txt')).toBe('old')
})
it('failed batches are not partially visible to readers', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src']), writer = broker.acquireWriter()
  expect(() => writer.apply(snapshot.id, [edit(), edit('tests/gate.cjs')])).toThrow(/scope/)
  expect(broker.reader.snapshot()).toBe(snapshot)
})
it('uses path-boundary grants and protects acceptance even under broad scopes', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src', 'tests'], ['tests/gate.cjs']), writer = broker.acquireWriter()
  expect(() => writer.apply(snapshot.id, [edit('tests/gate.cjs')])).toThrow(/Protected/)
  expect(() => createWorkspaceBroker(snapshot, ['src/a']).acquireWriter().apply(snapshot.id, [edit()])).toThrow(/outside/)
})
it('never grants writes to Yoke state even when explicitly requested', () => {
  const snapshot = createWorkspaceSnapshot([entry('.yoke/config.yaml')])
  expect(() => createWorkspaceBroker(snapshot, ['.yoke']).acquireWriter().apply(snapshot.id, [edit('.yoke/config.yaml')])).toThrow(/Protected/)
})
it('requires explicit missing-file preconditions for creation and supports deletion', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src']), writer = broker.acquireWriter()
  const next = writer.apply(snapshot.id, [{ path: 'src/new.txt', expectedSha256: null, content: '' }, edit('src/a.txt', null)])
  expect(next.read('src/new.txt')).toBe(''); expect(next.read('src/a.txt')).toBeNull()
  expect(() => writer.apply(next.id, [edit('src/unknown.txt')])).toThrow(/outside the pinned/)
})
it('validates complete edits and duplicate paths instead of guessing defaults', () => {
  for (const value of [[], [null], [{ path: 'a', content: 'x' }], [{ ...edit(), command: 'echo x' }], [edit(), edit()], [{ ...edit(), content: 2 }]]) {
    expect(() => parseWorkspaceEdits(value)).toThrow()
  }
})
it('invalid replacement encoding cannot mutate a published revision', () => {
  const snapshot = base(), broker = createWorkspaceBroker(snapshot, ['src'])
  expect(() => broker.acquireWriter().apply(snapshot.id, [edit('src/a.txt', '\ud800')])).toThrow(/UTF-8/)
  expect(broker.reader.snapshot()).toBe(snapshot)
})
