import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { RUNTIME_EXCLUDES } from '../loop/git.js'
import { storyPathSegment, type Story } from '../loop/prd.js'
import { statePath } from '../workspace/state.js'

const PREVIEW_BYTES = 8192
const ARTIFACT_BYTES = 64 * 1024 * 1024
type NewFile = { path: string; bytes: number; digest: string; artifact?: string; symlink?: string }

/** Retain complete bounded evidence; only a small write-scoped preview enters the prompt. */
export function captureRepairDiff(cwd: string, story: Story, round: number) {
  const git = (args: string[], maxBuffer = 1024 * 1024): Buffer => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer, timeout: 10_000 })
  try { git(['rev-parse', '--is-inside-work-tree'], 4096) }
  catch { return { currentDiff: 'Git diff unavailable for this project; inspect the declared write paths and acceptance evidence.', diffEvidence: { available: false as const, reason: 'not-a-readable-git-worktree' } } }
  let head: string | undefined
  try { head = git(['rev-parse', '--verify', 'HEAD'], 4096).toString('utf8').trim() } catch { /* unborn repository */ }
  const bases = head ? [[head]] : [['--cached'], []]
  const excludes = [...RUNTIME_EXCLUDES, ':(exclude,glob).yoke/proof/**/quality/repair-*/**']
  const directory = statePath(cwd, 'proof', storyPathSegment(story.id), 'quality', `repair-${round}-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  const patch = join(directory, 'full.patch'), descriptor = openSync(patch, 'wx', 0o600)
  try {
    for (const base of bases) execFileSync('git', ['diff', '--no-ext-diff', '--binary', ...base, '--', '.', ...excludes], { cwd, stdio: ['ignore', descriptor, 'pipe'], timeout: 10_000 })
  } finally { closeSync(descriptor) }
  let bytes = lstatSync(patch).size
  if (bytes > ARTIFACT_BYTES) throw Error('Repair diff exceeds the 64 MiB retained evidence limit; narrow the change before retrying')
  const sourcePaths = git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...excludes]).toString('utf8').split('\0').filter(Boolean).sort()
  const writes = story.writes?.length ? [...story.writes] : ['.']
  const relevantNew = new Set(git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...writes, ...excludes]).toString('utf8').split('\0').filter(Boolean))
  const chunks: Buffer[] = [], files: NewFile[] = []
  let previewBytes = 0, truncated = false
  const append = (value: Buffer | string): void => {
    const data = typeof value === 'string' ? Buffer.from(value) : value
    const room = PREVIEW_BYTES - previewBytes
    if (data.length > room) truncated = true
    if (room > 0) { const part = data.subarray(0, room); chunks.push(part); previewBytes += part.length }
  }
  for (const base of bases) {
    try { append(git(['diff', '--no-ext-diff', '--unified=3', ...base, '--', ...writes, ...excludes], PREVIEW_BYTES)) }
    catch (error) {
      const partial = (error as { stdout?: Buffer }).stdout
      if (partial?.length) { append(partial); truncated = true }
      else throw Error('Could not capture the write-scoped repair diff')
    }
  }
  for (const [index, path] of sourcePaths.entries()) {
    const source = join(cwd, path), before = lstatSync(source)
    if (before.isSymbolicLink()) {
      const target = readlinkSync(source), value = Buffer.from(target)
      bytes += value.length
      if (bytes > ARTIFACT_BYTES) throw Error('Repair evidence exceeds the 64 MiB limit')
      files.push({ path, bytes: value.length, digest: hash(value), symlink: target })
      if (relevantNew.has(path)) append(`\nNew symlink ${path} -> ${target}\n`)
      continue
    }
    if (!before.isFile() || before.size + bytes > ARTIFACT_BYTES) throw Error(`Cannot retain complete repair evidence for ${path}`)
    const fd = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    let value: Buffer
    try {
      const opened = fstatSync(fd)
      if (!opened.isFile() || opened.size + bytes > ARTIFACT_BYTES || opened.ino !== before.ino || opened.dev !== before.dev) throw Error(`Repair source changed while opening ${path}`)
      value = readFileSync(fd)
      const after = fstatSync(fd)
      if (value.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw Error(`Repair source changed while reading ${path}`)
    } finally { closeSync(fd) }
    bytes += value.length
    const artifact = `new-${index + 1}.bin`
    writeFileSync(join(directory, artifact), value, { flag: 'wx', mode: 0o600 })
    files.push({ path, bytes: value.length, digest: hash(value), artifact })
    if (relevantNew.has(path)) {
      append(`\nNew file ${path}\n`)
      append(value.includes(0) ? '[binary contents retained in evidence]\n' : value)
    }
  }
  const manifest = { version: 1, base: head ?? 'unborn-index-and-worktree', writes: story.writes ?? [], patch: { path: 'full.patch', bytes: lstatSync(patch).size, digest: hash(readFileSync(patch)) }, untracked: files, bytes }
  const encoded = JSON.stringify(manifest)
  writeFileSync(join(directory, 'manifest.json'), encoded, { flag: 'wx', mode: 0o600 })
  // Decoding invalid bytes can expand replacement characters; clip the valid
  // UTF-8 representation and leave a partial trailing code point out entirely.
  const decoded = Buffer.from(Buffer.concat(chunks).toString('utf8'))
  if (decoded.length > PREVIEW_BYTES) truncated = true
  const currentDiff = new StringDecoder('utf8').write(decoded.subarray(0, PREVIEW_BYTES))
  previewBytes = Buffer.byteLength(currentDiff)
  return { currentDiff, diffEvidence: { available: true as const, artifact: relative(cwd, join(directory, 'manifest.json')).replaceAll('\\', '/'), digest: hash(Buffer.from(encoded)), bytes, previewBytes, truncated } }
}

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
