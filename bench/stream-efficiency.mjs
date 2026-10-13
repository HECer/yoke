/** Isolated local benchmark: no provider calls and no whole-product savings claim.
 * npm run build && node bench/stream-efficiency.mjs
 * An optional directory containing the exact baseline files supports offline runs.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { createBoundedOutput } from '../dist/agents/stream-buffer.js'
import { contextPacket, feedbackPacket } from '../dist/context/packet.js'

const baseline = '56691e694874dbf1166b461e1994172567bf9a17'
const blobs = {
  'src/agents/process-streams.ts': '2e314fd64a674f1e8ffc545f6f0fe5247832e494',
  'src/context/packet.ts': 'd6bad14d7b59ab6bbfda7fb5c02e6098d3ea7972',
}
function baselineSource(path) {
  let bytes
  try { bytes = process.argv[2] ? readFileSync(join(process.argv[2], path)) : execFileSync('git', ['show', `${baseline}:${path}`], { maxBuffer: 2_000_000 }) }
  catch { throw new Error(`Baseline unavailable: fetch commit ${baseline}, or supply a directory with its exact source files`) }
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  assert.equal(actual, blobs[path], `Baseline blob identity: ${path}`)
  return bytes.toString('utf8')
}
async function loadTypescript(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const original = baselineSource('src/agents/process-streams.ts')
const ast = ts.createSourceFile('baseline.ts', original, ts.ScriptTarget.ES2022, true)
const bufferFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createBoundedOutput')
assert.ok(bufferFunction, 'Original buffer function exists')
const oldBuffer = (await loadTypescript(original.slice(bufferFunction.pos, bufferFunction.end))).createBoundedOutput
const oldPackets = await loadTypescript(baselineSource('src/context/packet.ts'))
const chunk = '0123456789abcdef'.repeat(256), iterations = 1024, limit = 1_048_576
function measure(create) {
  const output = create(limit), started = performance.now()
  for (let i = 0; i < iterations; i++) output.append(chunk)
  assert.equal(output.text, chunk.repeat(limit / chunk.length))
  return performance.now() - started
}
measure(oldBuffer); measure(createBoundedOutput)
const timings = { before: [], after: [] }
for (let i = 0; i < 5; i++) {
  const order = i % 2 ? [['after', createBoundedOutput], ['before', oldBuffer]] : [['before', oldBuffer], ['after', createBoundedOutput]]
  for (const [name, create] of order) timings[name].push(measure(create))
}
function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { samplesMs: values, medianMs: sorted[2], minMs: sorted[0], maxMs: sorted.at(-1) }
}
const feedback = 'HEAD\n' + Array.from({ length: 20 }, (_, i) => `[full output: /logs/${i}.txt]\n`).join('') + 'x'.repeat(30_000) + '\nLATEST FAILURE'
const context = { project: 'Project baseline', glossary: '', decisions: '', contextMap: '',
  knowledge: Array.from({ length: 10 }, (_, i) => `## Archive ${i}\n` + 'unrelated archive '.repeat(150)).join('\n') }
const emptyBefore = oldBuffer(0), emptyAfter = createBoundedOutput(0)
emptyBefore.append('must not retain'); emptyAfter.append('must not retain')
assert.equal(feedbackPacket(feedback, 256).length, 256)
assert.equal(emptyAfter.text, '')
console.log(JSON.stringify({ baselineCommit: baseline, baselineBlobs: blobs, node: process.version, platform: process.platform, arch: process.arch,
  scope: 'Synthetic function benchmark, not whole-project or live-provider savings',
  outputFixture: { totalBytes: chunk.length * iterations, chunkBytes: chunk.length, retainedLimitBytes: limit, samples: 5 },
  outputTimings: { before: statistics(timings.before), after: statistics(timings.after) },
  feedback: { sourceCharacters: feedback.length, budgetCharacters: 256, beforeCharacters: oldPackets.feedbackPacket(feedback, 256).length, afterCharacters: feedbackPacket(feedback, 256).length },
  unrelatedContext: { sourceCharacters: Object.values(context).join('').length, beforeCharacters: oldPackets.contextPacket(context, 'quaternion').length, afterCharacters: contextPacket(context, 'quaternion').length },
  zeroRetention: { beforeBytes: Buffer.byteLength(emptyBefore.text), afterBytes: Buffer.byteLength(emptyAfter.text) },
}, null, 2))
