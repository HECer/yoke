import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { Invocation } from '../../src/loop/runner.js'
import { isAcceptanceCriterion, type Story } from '../../src/loop/prd.js'

/** Fake the newly required planning output without changing provider call count. */
export function writeDraftCoverage(root: string, inv: Invocation, stories: Story[]): void {
  const source = inv.input ?? inv.args.join('\n')
  const binding = source.match(/Copy this exact objective object without summarizing or changing it: (\{[^\n]+\})/)
  if (!binding) throw Error('Missing original objective in planner packet')
  writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify({
    version: 1, objective: JSON.parse(binding[1]),
    requirements: stories.flatMap(story => story.acceptance.filter(isAcceptanceCriterion).map(criterion => ({ id: `${story.id}-${criterion.id}`, text: criterion.text, criteria: [{ story: story.id, criterion: criterion.id }] }))),
    invariants: [],
  }))
}
