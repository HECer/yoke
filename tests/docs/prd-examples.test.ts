import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { criterionCommandProblem, isAcceptanceCriterion, loadPrd } from '../../src/loop/prd.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-doc-prd-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function yamlExample(file: string, marker: string): string {
  const text = readFileSync(resolve(file), 'utf8')
  const start = text.indexOf(marker)
  if (start < 0) throw new Error(`missing marker ${marker} in ${file}`)
  const match = /```yaml\r?\n([\s\S]*?)```/.exec(text.slice(start))
  if (!match) throw new Error(`missing YAML example after ${marker} in ${file}`)
  return match[1]
}

describe('published PRD examples', () => {
  it.each([
    ['README.md', '**PRD format**'],
    ['canon/loop/prd.schema.md', '# PRD Schema'],
    ['canon/skills/authoring-prd/SKILL.md', '## Format'],
  ])('%s satisfies the same strict criterion contract as the loop', (file, marker) => {
    const path = join(dir, 'prd.yaml')
    writeFileSync(path, yamlExample(file, marker))
    const stories = loadPrd(path)

    expect(stories.length).toBeGreaterThan(0)
    for (const story of stories) {
      expect(story.acceptance.length).toBeGreaterThanOrEqual(2)
      for (const criterion of story.acceptance.filter(isAcceptanceCriterion)) {
        expect(criterionCommandProblem(criterion)).toBeNull()
      }
    }
  })
})
