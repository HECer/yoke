import { relative } from 'node:path'
import type { Verifier } from '../loop/verify.js'
import { compactCommandOutput } from '../output/compact.js'
import { writeOutputArtifact } from '../output/artifact.js'
import { DEFAULT_OUTPUT_POLICY, type OutputPolicy } from '../output/types.js'
import { scanDir } from './design.js'

export interface DesignVerifierOptions {
  readonly policy?: OutputPolicy
  readonly artifactWriter?: typeof writeOutputArtifact
}

export function designVerifier(max: number, options: DesignVerifierOptions = {}): Verifier {
  return (targetDir) => {
    const { findings, score } = scanDir(targetDir)
    const label = `design ${score <= max ? 'passed' : 'failed'}: score ${score} (${findings.length} tell${findings.length === 1 ? '' : 's'}), budget ${max}`
    if (score <= max) return { passed: true, summary: label }

    const raw = findings.map(finding => {
      const file = relative(targetDir, finding.file).replaceAll('\\', '/')
      return `${file}:${finding.line}  ${finding.tell} — ${finding.hint}\n  ${finding.text}`
    }).join('\n')
    const policy = options.policy ?? DEFAULT_OUTPUT_POLICY
    const compacted = compactCommandOutput(raw, { previewBytes: policy.previewBytes })
    const parts = [label]
    if (compacted.preview) parts.push(compacted.preview)
    if (compacted.originalBytes > policy.artifactThresholdBytes) {
      try {
        const artifact = (options.artifactWriter ?? writeOutputArtifact)(targetDir, raw, {
          phase: 'design',
          storyId: process.env.YOKE_STORY,
        })
        parts.push(artifact.marker)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        parts.push(`[artifact unavailable: ${message.replace(/[\u0000-\u001F\u007F]/gu, ' ').slice(0, 240)}]`)
      }
    }
    return { passed: false, summary: parts.join('\n') }
  }
}
