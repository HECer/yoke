import { existsSync, mkdirSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Agent } from '../retrofit/config.js'
import { runRetrofit } from '../retrofit/command.js'
import { runContextInit } from '../context/command.js'
import { runPrdDraft, PRD_TEMPLATE, type PrdDraftOptions } from '../prd/command.js'

export interface RunNewOptions {
  idea?: string
  agents?: Agent[]
  runner?: Agent
  loop?: boolean
  timeoutMinutes?: number
  git?: (args: string[], cwd: string) => void
  isAvailable?: PrdDraftOptions['isAvailable']
  run?: PrdDraftOptions['run']
}

export function runNew(dir: string, opts: RunNewOptions = {}): number {
  const git = opts.git ?? ((args: string[], cwd: string) => { execFileSync('git', args, { cwd, stdio: 'pipe' }) })
  const target = resolve(dir)
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`${dir} already exists and is not empty — yoke new is greenfield-only (use yoke retrofit for existing projects).`)
    return 1
  }
  mkdirSync(target, { recursive: true })
  git(['init'], target)
  const name = basename(target)
  writeFileSync(join(target, 'README.md'), `# ${name}\n${opts.idea ? `\n${opts.idea}\n` : ''}`)
  writeFileSync(join(target, '.gitignore'), 'node_modules/\ndist/\n.env\n')
  runRetrofit(target, { loop: opts.loop ?? false, agents: opts.agents })
  runContextInit(target)
  if (opts.idea) {
    appendFileSync(join(target, '.yoke', 'context', 'PROJECT.md'), `\n## Idea\n\n${opts.idea}\n`)
  }
  writeFileSync(join(target, '.yoke', 'prd.yaml'), PRD_TEMPLATE)
  git(['add', '-A'], target)
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', `chore: bootstrap ${name} with yoke`], target)

  let code = 0
  if (opts.idea) {
    const draft = runPrdDraft(target, {
      idea: opts.idea,
      runner: opts.runner,
      timeoutMinutes: opts.timeoutMinutes,
      isAvailable: opts.isAvailable,
      run: opts.run,
    })
    if (draft === 0) {
      git(['add', '-A'], target)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: draft PRD from idea'], target)
    } else {
      console.error(`PRD draft did not succeed. The project is ready anyway; retry with: yoke prd draft ${dir} --idea="..."`)
      code = draft
    }
  }

  console.log([
    `✓ ${name} bootstrapped.`,
    'Next steps:',
    '  1. Review .yoke/prd.yaml (or draft it: yoke prd draft --idea="...")',
    '  2. Set verify.command in .yoke/config.yaml (e.g. "npm test")',
    `  3. yoke loop on ${dir} && yoke loop run ${dir} --isolate`,
  ].join('\n'))
  return code
}
