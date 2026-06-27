#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { validateCanon } from './canon/validate.js'
import { resolveCanonDir } from './retrofit/canon-dir.js'
import { planClaudeRetrofit } from './retrofit/plan.js'
import { applyActions } from './retrofit/apply.js'
import { formatReport } from './retrofit/report.js'
import { loadConfig, saveConfig, defaultConfig, type ForgeConfig } from './retrofit/config.js'
import { loadManifest } from './canon/manifest.js'
import { join } from 'node:path'

export function runValidate(canonDir: string): number {
  const issues = validateCanon(canonDir)
  for (const i of issues) {
    const line = `${i.level === 'error' ? 'ERROR' : 'warn '} ${i.message}`
    if (i.level === 'error') console.error(line)
    else console.log(line)
  }
  const errors = issues.filter(i => i.level === 'error')
  if (errors.length === 0) {
    console.log(`✓ canon valid (${canonDir})`)
    return 0
  }
  console.log(`✗ ${errors.length} error(s)`)
  return 1
}

export function runRetrofit(targetDir: string, opts: { loop: boolean }): number {
  const canonDir = resolveCanonDir()
  const canonVersion = loadManifest(join(canonDir, 'manifest.yaml')).version

  const actions = planClaudeRetrofit(canonDir, targetDir)
  const backupDir = join(targetDir, '.forge', 'backup', String(Date.now()))
  const applied = applyActions(actions, targetDir, { backupDir })

  const existing = loadConfig(targetDir)
  const config: ForgeConfig = {
    ...(existing ?? defaultConfig(canonVersion)),
    canonVersion,
    agents: ['claude'],
    loop: { enabled: opts.loop },
  }
  saveConfig(targetDir, config)

  console.log(formatReport(applied, { loopEnabled: config.loop.enabled }))
  return 0
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'validate':
      return runValidate(rest[0] ?? 'canon')
    case 'retrofit': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const loop = rest.includes('--loop')
      return runRetrofit(targetDir, { loop })
    }
    default:
      console.log('usage: forge <validate [canonDir] | retrofit [targetDir] [--loop]>')
      return cmd ? 1 : 0
  }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  process.exit(main(process.argv.slice(2)))
}
