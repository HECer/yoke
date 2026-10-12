import { it } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextBlockFor, buildClaudePrompt, buildReviewPrompt } from '../../src/loop/runner.js'
import { stringify } from 'yaml'
import { requirementObjective } from '../../src/prd/requirements.js'

it('preserves unmatched and late global constraints in actual legacy worker and review prompts', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-binding-context-'))
  const dir = join(root, '.yoke', 'context')
  mkdirSync(dir, { recursive: true })
  const story = { id: 'S1', title: 'Improve onboarding', priority: 1, acceptance: ['Keep signup usable'], passes: false, writes: ['src'] }
  const invariant = 'Never log bearer tokens.'
  const lateConstraint = 'Preserve offline encrypted edits.'
  try {
    writeFileSync(join(dir, 'PROJECT.md'), '## Goal\n' + 'Product context. '.repeat(200) + '\n## Constraints\n' + lateConstraint)
    writeFileSync(join(dir, 'KNOWLEDGE.md'), '## Security invariant\n' + invariant)
    writeFileSync(join(dir, 'CONTEXT-MAP.md'), '## Global contract\nAll records belong to their tenant.')
    const context = contextBlockFor(root, story)
    for (const prompt of [buildClaudePrompt(story, context), buildReviewPrompt(story, context)]) {
      assert.ok(prompt.includes(invariant))
      assert.ok(prompt.includes(lateConstraint))
      assert.ok(prompt.includes('All records belong to their tenant.'))
      assert.ok(prompt.includes('Keep signup usable'))
      assert.ok(prompt.includes('src'))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('keeps the original objective, unrelated global invariant and executable evidence from the ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-binding-ledger-'))
  const dir = join(root, '.yoke')
  mkdirSync(dir)
  const story = { id: 'S1', title: 'Improve onboarding', priority: 1, passes: false, writes: ['src'],
    acceptance: [{ id: 'signup', text: 'Keep signup usable', verify: ['npm run test:signup'] },
      { id: 'offline', text: 'Keep offline edits', verify: ['npm run test:offline'] }] }
  const invariant = 'Preserve encrypted offline edits without storing authentication secrets.'
  try {
    writeFileSync(join(dir, 'prd.yaml'), stringify([story]))
    writeFileSync(join(dir, 'requirements.yaml'), stringify({ version: 1, objective: requirementObjective('Build onboarding without removing established features'),
      requirements: [{ id: 'R1', text: 'Signup succeeds', criteria: [{ story: 'S1', criterion: 'signup' }] }],
      invariants: [{ id: 'I1', text: invariant, criteria: [{ story: 'S1', criterion: 'offline' }] }],
    }))
    const context = contextBlockFor(root, story)
    for (const prompt of [buildClaudePrompt(story, context), buildReviewPrompt(story, context)]) {
      assert.ok(prompt.includes(invariant))
      assert.ok(prompt.includes('Build onboarding without removing established features'))
      assert.ok(prompt.includes('npm run test:signup'))
      assert.ok(prompt.includes('src'))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
