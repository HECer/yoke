import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function runtimeModules() {
  const builtCompact = new URL('../dist/output/compact.js', import.meta.url)
  const builtArtifact = new URL('../dist/output/artifact.js', import.meta.url)
  const useBuild = existsSync(fileURLToPath(builtCompact)) && existsSync(fileURLToPath(builtArtifact))
  return Promise.all([
    import(useBuild ? builtCompact.href : new URL('../src/output/compact.ts', import.meta.url).href),
    import(useBuild ? builtArtifact.href : new URL('../src/output/artifact.ts', import.meta.url).href),
  ])
}

function fixture() {
  return [
    '=== stdout ===',
    'compiling application',
    'src/core.ts:17: error TS2304: Cannot find name ImportantWidget',
    'the failing call is part of the checkout flow',
    ...Array.from({ length: 600 }, (_, index) => `progress shard=${index % 12} status=unchanged cache=hit`),
    '=== stderr ===',
    'Tests: 1 failed, 249 passed, 250 total',
  ].join('\n')
}

export async function runOutputCompactionBenchmark() {
  const [{ compactCommandOutput }, { writeOutputArtifact }] = await runtimeModules()
  const raw = fixture()
  const previewBudgetBytes = 512
  const compacted = compactCommandOutput(raw, { previewBytes: previewBudgetBytes })
  const dir = mkdtempSync(join(tmpdir(), 'yoke-output-bench-'))
  try {
    const artifact = writeOutputArtifact(dir, raw, { phase: 'verify', storyId: 'BENCH' })
    const stored = readFileSync(join(dir, ...artifact.relativePath.split('/')))
    const storedDigest = createHash('sha256').update(stored).digest('hex')
    const previewBytes = Buffer.byteLength(compacted.preview)
    const referencedBytes = previewBytes + Buffer.byteLength(artifact.marker)
    return {
      fixture: 'gate-output-v1',
      rawBytes: Buffer.byteLength(raw),
      rawApproxTokens: Math.ceil(Buffer.byteLength(raw) / 4),
      previewBudgetBytes,
      previewBytes,
      previewApproxTokens: Math.ceil(previewBytes / 4),
      referencedBytes,
      compressionRatio: Number((Buffer.byteLength(raw) / referencedBytes).toFixed(2)),
      earlyErrorRetained: compacted.preview.includes('error TS2304'),
      finalSummaryRetained: compacted.preview.includes('Tests: 1 failed, 249 passed'),
      digestRoundTrip: storedDigest === artifact.sha256,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runOutputCompactionBenchmark()
  console.log(JSON.stringify(result, null, 2))
  if (!result.earlyErrorRetained || !result.finalSummaryRetained || !result.digestRoundTrip || result.previewBytes > result.previewBudgetBytes) {
    process.exitCode = 1
  }
}
