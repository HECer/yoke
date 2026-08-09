import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { storyPathSegment, type AcceptanceCriterion, type Story } from './prd.js'
import type { VerifyResult } from './verify.js'

export interface CriterionEvidence {
  criterion: AcceptanceCriterion
  result: VerifyResult
}

export function writeCriterionEvidence(targetDir: string, story: Story, evidence: CriterionEvidence[]): string {
  const storySegment = storyPathSegment(story.id)
  const dir = join(targetDir, '.yoke', 'proof', storySegment)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'evidence.json')
  const temporary = `${path}.${process.pid}.tmp`
  const contents = JSON.stringify({
    version: 1,
    storyId: story.id,
    generatedAt: new Date().toISOString(),
    criteria: evidence.map(({ criterion, result }) => ({
      id: criterion.id,
      text: criterion.text,
      verify: criterion.verify,
      passed: result.passed,
      summary: result.summary,
    })),
  }, null, 2) + '\n'
  try {
    writeFileSync(temporary, contents, { flag: 'wx' })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  return path
}
