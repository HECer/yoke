// Diagnostic using fake agents/Git adapters, exercising the real loop and dispatcher.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runLoopCommand } from '../dist/loop/run-command.js'
import { saveConfig } from '../dist/retrofit/config.js'
import { loadPrd, savePrd } from '../dist/loop/prd.js'
const base = resolve(process.argv[2] ?? `G:/NN-Developed/Yoke-Testground/p${Date.now().toString(36)}`)
process.env.LOCALAPPDATA = join(base, 'state')
const findings = []
for (const requiresStoryContext of [false, true]) {
  const root = join(base, requiresStoryContext ? 'scoped' : 'control'); mkdirSync(join(root, '.yoke'), { recursive: true })
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, verify: { command: 'node test.mjs' } })
  savePrd(join(root, '.yoke/prd.yaml'), ['A','B','C'].map((id, index) => ({ id, title: id, priority: index + 1, acceptance: ['Expected result'], writes: [`src/${id}`], passes: false })))
  const observedContexts = []
  const code = await runLoopCommand(root, { parallel: 3, maxIterations: 3, quiet: true,
    runner: () => ({ success: true, summary: 'Fake agent completed' }), isAvailable: () => true,
    verify: () => { const context = process.env.YOKE_STORY ?? null; observedContexts.push(context); return { passed: !requiresStoryContext || ['A','B','C'].includes(context), summary: context ? 'Story-scoped verification passed' : 'Missing YOKE_STORY context' } },
    git: { isClean: () => true, commitAll: () => undefined,
      addWorktree: (_target, worktree) => { mkdirSync(join(worktree, '.yoke'), { recursive: true }); cpSync(join(root, '.yoke/prd.yaml'), join(worktree, '.yoke/prd.yaml')) },
      // Retain disposable directories for inspection; no recursive deletion.
      removeWorktree: () => undefined,
      integrate: (_target, worktree) => savePrd(join(root, '.yoke/prd.yaml'), loadPrd(join(worktree, '.yoke/prd.yaml'))),
    },
  })
  findings.push({ fakeAgentsAndGit: true, requiresStoryContext, exitCode: code, observedContexts, acceptedStories: loadPrd(join(root, '.yoke/prd.yaml')).filter(s => s.passes).length })
}
writeFileSync(join(base, 'findings.json'), JSON.stringify(findings, null, 2))
console.log(JSON.stringify(findings, null, 2))
if (findings.some(row => row.exitCode !== 0 || row.acceptedStories !== 3 || row.observedContexts.includes(null))) process.exitCode = 1
