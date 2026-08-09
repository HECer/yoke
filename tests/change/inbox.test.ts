import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { loadPrd, savePrd } from '../../src/loop/prd.js'
import { pendingChanges, proposalFile, queueChange, reviewFile, runChangeApply } from '../../src/change/inbox.js'
import type { Invocation } from '../../src/loop/runner.js'

let dir: string
let linkedDirs: string[]
beforeEach(() => {
  linkedDirs = []
  dir = mkdtempSync(join(tmpdir(), 'yoke-change-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  savePrd(join(dir, '.yoke', 'prd.yaml'), [{
    id: 'S1', title: 'Existing story', priority: 1, acceptance: ['existing'], passes: true,
  }])
})
afterEach(() => {
  for (const linked of linkedDirs) rmSync(linked, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

function writeValidProposal(changeId: string): void {
  writeFileSync(proposalFile(dir, changeId), `
- id: S2
  title: Add billing portal
  priority: 2
  acceptance:
    - { id: portal-opens, text: The portal opens, verify: [npm run test:portal-opens] }
    - { id: portal-recovers, text: The portal recovers, verify: [npm run test:portal-recovers] }
  passes: false
`)
}

function writeApprovedReview(changeId: string): void {
  writeFileSync(reviewFile(dir, changeId), JSON.stringify({
    version: 1, changeId, approved: true, summary: 'Complete coverage', uncovered: [],
  }))
}

describe('change inbox', () => {
  it('uses an absolute proposal path so provider cwd cannot change its meaning', () => {
    expect(isAbsolute(proposalFile('.', 'change-relative'))).toBe(true)
  })

  it('queues changes from a linked git worktree without treating .git as a directory', () => {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Yoke Test'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'yoke@example.invalid'], { cwd: dir })
    execFileSync('git', ['add', '.yoke/prd.yaml'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' })
    const linked = `${dir}-linked`
    linkedDirs.push(linked)
    execFileSync('git', ['worktree', 'add', '-b', 'linked-test', linked], { cwd: dir, stdio: 'pipe' })

    const request = queueChange(linked, 'Add passkeys', { id: 'change-linked' })

    expect(pendingChanges(linked)).toEqual([request])
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: linked }).toString().trim()).toBe('')
  })

  it('queues an immutable request without modifying the PRD', () => {
    const before = readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8')
    const request = queueChange(dir, 'Add team invitations', {
      id: 'change-1', now: () => new Date('2026-08-09T10:00:00.000Z'),
    })
    expect(request).toMatchObject({ id: 'change-1', request: 'Add team invitations' })
    expect(pendingChanges(dir)).toEqual([request])
    expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
  })

  it.each(['claude', 'codex', 'gemini'] as const)('uses the generic %s provider to append only new strict stories', agent => {
    const request = queueChange(dir, 'Add team invitations', { id: `change-${agent}` })
    let invocation: Invocation | undefined
    const result = runChangeApply(dir, {
      runner: agent,
      isAvailable: () => true,
      run: inv => {
        invocation = inv
        writeFileSync(proposalFile(dir, request.id), `
- id: S2
  title: Add team invitations
  priority: 2
  acceptance:
    - id: invite-delivered
      text: An invited teammate receives a usable invitation
      verify: [npm run test:invite-delivered]
    - id: invite-accepted
      text: The invited teammate can accept the invitation
      verify: [npm run test:invite-accepted]
  passes: false
`)
        return { success: true, summary: 'planned' }
      },
      reviewer: agent,
      review: inv => {
        expect(inv.input).toMatch(/every distinct requested outcome/i)
        writeFileSync(reviewFile(dir, request.id), JSON.stringify({
          version: 1,
          changeId: request.id,
          approved: true,
          summary: 'Every requested outcome is covered',
          uncovered: [],
        }))
        return { success: true, summary: 'reviewed' }
      },
      commit: () => {},
    })

    expect(result).toMatchObject({ ok: true, added: 1, changeId: request.id })
    expect(invocation?.command).toBe(agent)
    expect(invocation?.cwd).toBe(join(dir, '.yoke', 'changes'))
    expect(invocation?.input).toContain('append-only')
    expect(invocation?.input).toMatch(/criterion id.*verify command/i)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))).toMatchObject([
      { id: 'S1', passes: true },
      { id: 'S2', passes: false, sourceChange: request.id },
    ])
    expect(pendingChanges(dir)).toEqual([])
  })

  it('rejects proposals without executable criterion evidence and leaves the request pending', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-invalid' })
    const result = runChangeApply(dir, {
      runner: 'codex', isAvailable: () => true, commit: () => {},
      run: () => {
        writeFileSync(proposalFile(dir, request.id), `- { id: S2, title: Add billing portal, priority: 2, acceptance: ["looks good", "opens"], passes: false }`)
        return { success: true, summary: 'planned' }
      },
    })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/executable criterion/i)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))).toHaveLength(1)
    expect(pendingChanges(dir)).toHaveLength(1)
    expect(existsSync(proposalFile(dir, request.id))).toBe(true)
  })

  it('never overwrites a PRD that changed while the planner was running', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-concurrent' })
    const prdPath = join(dir, '.yoke', 'prd.yaml')
    const result = runChangeApply(dir, {
      runner: 'gemini', isAvailable: () => true, commit: () => {},
      run: () => {
        writeFileSync(prdPath, `${readFileSync(prdPath, 'utf8')}# concurrent edit\n`)
        writeFileSync(proposalFile(dir, request.id), `
- id: S2
  title: Add billing portal
  priority: 2
  acceptance:
    - { id: portal-opens, text: The portal opens, verify: [npm test] }
  passes: false
`)
        return { success: true, summary: 'planned' }
      },
    })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/PRD changed/i)
    expect(readFileSync(prdPath, 'utf8')).toContain('# concurrent edit')
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it.each([1, 6])('rejects proposals with %i criteria outside the planner contract', count => {
    const request = queueChange(dir, 'Add billing portal', { id: `change-count-${count}` })
    const criteria = Array.from({ length: count }, (_, index) => [
      `    - id: criterion-${index + 1}`,
      `      text: Criterion ${index + 1} works`,
      `      verify: [npm run test:criterion-${index + 1}]`,
    ].join('\n')).join('\n')
    const result = runChangeApply(dir, {
      runner: 'codex', isAvailable: () => true, commit: () => {},
      run: () => {
        writeFileSync(proposalFile(dir, request.id), [
          '- id: S2', '  title: Add billing portal', '  priority: 2', '  acceptance:',
          criteria, '  passes: false', '',
        ].join('\n'))
        return { success: true, summary: 'planned' }
      },
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/2-5 structured acceptance criteria/i)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('keeps a request pending when sourceChange exists only in an uncommitted PRD', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-uncommitted' })
    savePrd(join(dir, '.yoke', 'prd.yaml'), [...loadPrd(join(dir, '.yoke', 'prd.yaml')), {
      id: 'S2', title: 'Add billing portal', priority: 2,
      acceptance: [
        { id: 'portal-opens', text: 'The portal opens', verify: ['npm test'] },
        { id: 'portal-recovers', text: 'The portal recovers', verify: ['npm test'] },
      ],
      passes: false, sourceChange: request.id,
    }])

    const result = runChangeApply(dir, { runner: 'codex', isAvailable: () => true, commit: () => {} })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/uncommitted/i)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('does not mistake an untracked PRD in a fresh git repository for committed recovery', () => {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
    const request = queueChange(dir, 'Add billing portal', { id: 'change-untracked' })
    savePrd(join(dir, '.yoke', 'prd.yaml'), [...loadPrd(join(dir, '.yoke', 'prd.yaml')), {
      id: 'S2', title: 'Add billing portal', priority: 2,
      acceptance: [
        { id: 'portal-opens', text: 'The portal opens', verify: ['npm test'] },
        { id: 'portal-recovers', text: 'The portal recovers', verify: ['npm test'] },
      ],
      passes: false, sourceChange: request.id,
    }])

    const result = runChangeApply(dir, { runner: 'codex', isAvailable: () => true, commit: () => {} })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/uncommitted/i)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('archives a request after its sourceChange story is committed', () => {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Yoke Test'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'yoke@example.invalid'], { cwd: dir })
    const request = queueChange(dir, 'Add billing portal', { id: 'change-committed' })
    savePrd(join(dir, '.yoke', 'prd.yaml'), [...loadPrd(join(dir, '.yoke', 'prd.yaml')), {
      id: 'S2', title: 'Add billing portal', priority: 2,
      acceptance: [
        { id: 'portal-opens', text: 'The portal opens', verify: ['npm test'] },
        { id: 'portal-recovers', text: 'The portal recovers', verify: ['npm test'] },
      ],
      passes: false, sourceChange: request.id,
    }])
    execFileSync('git', ['add', '.yoke/prd.yaml'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'plan change'], { cwd: dir, stdio: 'pipe' })

    const result = runChangeApply(dir, { runner: 'codex', isAvailable: () => true, commit: () => {} })

    expect(result).toMatchObject({ ok: true, added: 0, changeId: request.id })
    expect(result.summary).toMatch(/recovered applied change/i)
    expect(pendingChanges(dir)).toHaveLength(0)
  })

  it('accepts a proposed story that depends on an existing story', () => {
    const request = queueChange(dir, 'Add follow-up billing portal', { id: 'change-dependency' })
    const result = runChangeApply(dir, {
      runner: 'codex', isAvailable: () => true, commit: () => {},
      run: () => {
        writeFileSync(proposalFile(dir, request.id), `
- id: S2
  title: Add follow-up billing portal
  priority: 2
  needs: [S1]
  acceptance:
    - { id: portal-opens, text: The portal opens, verify: [npm run test:portal-opens] }
    - { id: portal-recovers, text: The portal recovers, verify: [npm run test:portal-recovers] }
  passes: false
`)
        return { success: true, summary: 'planned' }
      },
      reviewer: 'gemini',
      review: () => {
        writeFileSync(reviewFile(dir, request.id), JSON.stringify({
          version: 1, changeId: request.id, approved: true,
          summary: 'Complete coverage', uncovered: [],
        }))
        return { success: true, summary: 'reviewed' }
      },
    })

    expect(result.ok).toBe(true)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[1].needs).toEqual(['S1'])
  })

  it('keeps a multi-outcome request pending when independent review finds an omission', () => {
    const request = queueChange(dir, 'Add team invitations and audit logging', { id: 'change-partial' })
    const before = readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8')
    const result = runChangeApply(dir, {
      runner: 'codex', reviewer: 'gemini', isAvailable: () => true, commit: () => {},
      run: () => {
        writeFileSync(proposalFile(dir, request.id), `
- id: S2
  title: Add team invitations
  priority: 2
  acceptance:
    - { id: invite-delivered, text: Invitation is delivered, verify: [npm run test:invite-delivered] }
    - { id: invite-accepted, text: Invitation can be accepted, verify: [npm run test:invite-accepted] }
  passes: false
`)
        return { success: true, summary: 'planned' }
      },
      review: () => {
        writeFileSync(reviewFile(dir, request.id), JSON.stringify({
          version: 1,
          changeId: request.id,
          approved: false,
          summary: 'Audit logging is missing',
          uncovered: ['audit logging'],
        }))
        return { success: true, summary: 'reviewed' }
      },
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/audit logging is missing/i)
    expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('rejects unsafe new story ids while preserving legacy PRD compatibility', () => {
    const request = queueChange(dir, 'Add export', { id: 'change-unsafe-id' })
    const result = runChangeApply(dir, {
      runner: 'codex', isAvailable: () => true, commit: () => {},
      run: () => {
        writeFileSync(proposalFile(dir, request.id), `
- id: ../../outside
  title: Add export
  priority: 2
  acceptance:
    - { id: export-downloads, text: Export downloads, verify: [npm run test:export-downloads] }
    - { id: export-opens, text: Export opens, verify: [npm run test:export-opens] }
  passes: false
`)
        return { success: true, summary: 'planned' }
      },
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/story id/i)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('fails closed before planning when the configured coverage reviewer is unavailable', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-no-reviewer' })
    let plannerCalls = 0
    const result = runChangeApply(dir, {
      runner: 'codex', reviewer: 'gemini',
      isAvailable: agent => agent === 'codex',
      run: () => { plannerCalls += 1; return { success: true, summary: 'unexpected' } },
      commit: () => {},
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/reviewer.*unavailable/i)
    expect(plannerCalls).toBe(0)
    expect(pendingChanges(dir)).toEqual([request])
  })

  it.each(['provider-failure', 'missing-file', 'invalid-json', 'wrong-change'] as const)(
    'fails closed on coverage review result: %s', mode => {
      const request = queueChange(dir, 'Add billing portal', { id: `change-review-${mode}` })
      const before = readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8')
      const result = runChangeApply(dir, {
        runner: 'codex', reviewer: 'gemini', isAvailable: () => true, commit: () => {},
        run: () => { writeValidProposal(request.id); return { success: true, summary: 'planned' } },
        review: () => {
          if (mode === 'provider-failure') return { success: false, summary: 'review CLI crashed' }
          if (mode === 'invalid-json') writeFileSync(reviewFile(dir, request.id), '{broken')
          if (mode === 'wrong-change') writeFileSync(reviewFile(dir, request.id), JSON.stringify({
            version: 1, changeId: 'another-change', approved: true, summary: 'wrong request', uncovered: [],
          }))
          return { success: true, summary: 'reviewed' }
        },
      })

      expect(result.ok).toBe(false)
      expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
      expect(pendingChanges(dir)).toHaveLength(1)
    },
  )

  it('rejects PRD edits made while the coverage reviewer is running', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-review-concurrent' })
    const prdPath = join(dir, '.yoke', 'prd.yaml')
    const result = runChangeApply(dir, {
      runner: 'codex', reviewer: 'gemini', isAvailable: () => true, commit: () => {},
      run: () => { writeValidProposal(request.id); return { success: true, summary: 'planned' } },
      review: () => {
        writeFileSync(prdPath, `${readFileSync(prdPath, 'utf8')}# reviewer edit\n`)
        writeApprovedReview(request.id)
        return { success: true, summary: 'reviewed' }
      },
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/reviewer.*PRD changed|PRD changed.*reviewer/i)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('rolls the PRD back and keeps the request pending when commit fails', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-commit-fails' })
    const prdPath = join(dir, '.yoke', 'prd.yaml')
    const before = readFileSync(prdPath, 'utf8')
    const result = runChangeApply(dir, {
      runner: 'codex', isAvailable: () => true,
      run: () => { writeValidProposal(request.id); return { success: true, summary: 'planned' } },
      review: () => { writeApprovedReview(request.id); return { success: true, summary: 'reviewed' } },
      commit: () => { throw new Error('git commit failed') },
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/could not persist.*git commit failed/i)
    expect(readFileSync(prdPath, 'utf8')).toBe(before)
    expect(pendingChanges(dir)).toHaveLength(1)
  })

  it('keeps a committed request pending for recovery when archival fails', () => {
    const request = queueChange(dir, 'Add billing portal', { id: 'change-archive-fails' })
    const result = runChangeApply(dir, {
      runner: 'codex', isAvailable: () => true,
      run: () => { writeValidProposal(request.id); return { success: true, summary: 'planned' } },
      review: () => { writeApprovedReview(request.id); return { success: true, summary: 'reviewed' } },
      commit: () => {},
      archive: () => { throw new Error('archive unavailable') },
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/committed.*could not be archived/i)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))).toHaveLength(2)
    expect(pendingChanges(dir)).toHaveLength(1)
  })
})
