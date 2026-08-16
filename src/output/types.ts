export type OutputPhase = 'criterion' | 'verify' | 'perf' | 'audit' | 'completion'

export interface OutputPolicy {
  readonly previewBytes: number
  readonly artifactThresholdBytes: number
}

export interface CompactedOutput {
  readonly preview: string
  readonly originalBytes: number
  readonly originalLines: number
  readonly omitted: boolean
}

export interface OutputArtifact {
  readonly relativePath: string
  readonly bytes: number
  readonly sha256: string
  readonly marker: string
}

export const DEFAULT_OUTPUT_POLICY: OutputPolicy = {
  previewBytes: 2_048,
  artifactThresholdBytes: 8_192,
}
