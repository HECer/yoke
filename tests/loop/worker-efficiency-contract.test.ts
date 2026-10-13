import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildClaudePrompt } from '../../src/loop/runner.js'

const story = { id: 'STORY-1', title: 'Fix a bounded parser', priority: 1, acceptance: ['Preserve all required behavior'], passes: false }

describe('worker and controller execution ownership', () => {
  it('uses focused worker checks without removing required host or broad checks', () => {
    const prompt = buildClaudePrompt(story, '')
    assert.ok(prompt.includes('Use focused tests during TDD'))
    assert.ok(prompt.includes('Yoke independently runs the configured independent verification and required gates'))
    assert.ok(prompt.includes('cross-cutting change'))
    assert.ok(prompt.includes('Never skip or weaken required checks'))
    assert.ok(!prompt.includes("When done, ensure the project's full test suite passes."))
  })
  it('prevents nested orchestration while preserving critical-decision and performance contracts', () => {
    const prompt = buildClaudePrompt(story, '', 'critical', 'npm run perf')
    assert.ok(prompt.includes('Do not start nested Yoke loops or additional agents'))
    assert.ok(prompt.includes('.yoke/decision-request.yaml'))
    assert.ok(prompt.includes('`npm run perf` must exit 0'))
    assert.ok(prompt.includes('Do NOT commit'))
    assert.ok(prompt.includes('Preserve all required behavior'))
  })
  it('uses a single scoped loop and model-free waiting rather than fixed five-iteration restarts', () => {
    const workflow = readFileSync('canon/skills/yoke-workflow/SKILL.md', 'utf8')
    assert.ok(workflow.includes('yoke loop run . --isolate'))
    assert.ok(!workflow.includes('--max=5'))
    assert.ok(workflow.includes('do not repeatedly restart capped or blocked runs'))
    assert.ok(workflow.includes('repeat timeout waits in host code'))
    assert.ok(workflow.includes('Do not add `--explore` unless the user explicitly requests'))
  })
})
