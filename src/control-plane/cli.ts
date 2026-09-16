#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseAdmissionInput, planAdmission } from './admission.js'
import { budgetSummary, parseLimits } from './budget.js'
import { previewOrcaWorkerStart, probeOrca } from './orca.js'
import { initializeLedger, readLedger } from './store.js'

function readJson(file: string): unknown {
  if (statSync(file).size > 4 * 1024 * 1024) throw new Error('Input exceeds 4 MiB')
  return JSON.parse(readFileSync(file, 'utf8'))
}
const HELP = `Yoke 2.0 control-plane preview (not a production 2.0 release)
  node dist/control-plane/cli.js plan <manifest.json>
  node dist/control-plane/cli.js orca-doctor
  node dist/control-plane/cli.js orca-preview <launch.json>
  node dist/control-plane/cli.js budget-show <project>
  node dist/control-plane/cli.js budget-init <project> <limits.json>

plan / orca-preview do not launch agents, execute commands, or persist reservations.
Only budget-init writes state, and it never resets an existing ledger.
Use the existing yoke goal / loop / check commands for real execution and acceptance.`
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))
  try {
    if (!command || command === '--help') { if (args.length) throw new Error('Unexpected arguments'); console.log(HELP); return 0 }
    if (command === 'plan' && args.length === 1) {
      const input = parseAdmissionInput(readJson(args[0]!)), plan = planAdmission(input)
      print({ preview: true, effects: 'none', ...plan, budget: budgetSummary(plan.ledger) })
      return plan.decisions.some(decision => decision.status === 'blocked') ? 1 : 0
    }
    if (command === 'orca-doctor' && args.length === 0) { const probe = await probeOrca(); print(probe); return 2 }
    if (command === 'orca-preview' && args.length === 1) { print(previewOrcaWorkerStart(readJson(args[0]!))); return 0 }
    if (command === 'budget-show' && args.length === 1) { const snapshot = readLedger(args[0]!); print(snapshot ? { ...snapshot, summary: budgetSummary(snapshot.ledger) } : { initialized: false }); return 0 }
    if (command === 'budget-init' && args.length === 2) { print(initializeLedger(args[0]!, parseLimits(readJson(args[1]!)))); return 0 }
    throw new Error('Unknown command or wrong argument count. Run with --help.')
  } catch (error) { console.error(error instanceof Error ? error.message : 'Control-plane command failed'); return 2 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2))
