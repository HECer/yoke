import { writeFileSync } from 'node:fs'
import { stringify } from 'yaml'
import type { Invocation } from '../../src/loop/runner.js'
import { isAcceptanceCriterion, type Story } from '../../src/loop/prd.js'

export function draftFile(inv: Invocation, kind: 'prd' | 'requirements' = 'prd'): string {
  const match = inv.input.match(kind === 'prd' ? /^Write (.+) as a YAML array/mu : /^Also write (.+) as a version: 1/mu)
  if (!match) throw Error(`Missing staged ${kind} path`)
  return match[1]
}

/** Fake the newly required planning output without changing provider call count. */
export function writeDraftCoverage(root: string, inv: Invocation, stories: Story[]): void {
  const source = inv.input ?? inv.args.join('\n')
  const binding = source.match(/Copy this exact objective object without summarizing or changing it: (\{[^\n]+\})/)
  if (!binding) throw Error('Missing original objective in planner packet')
  writeFileSync(draftFile(inv, 'requirements'), stringify({
    version: 1, objective: JSON.parse(binding[1]),
    requirements: stories.flatMap(story => story.acceptance.filter(isAcceptanceCriterion).map(criterion => ({ id: `${story.id}-${criterion.id}`, text: criterion.text, criteria: [{ story: story.id, criterion: criterion.id }] }))),
    invariants: [],
  }))
}
