import { registerWorkspaceCases } from './workspace-cases.js'

let passed = 0, failed = 0
registerWorkspaceCases((name, run) => {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}`, error) }
})
console.log(JSON.stringify({ passed, failed, note: 'Focused workspace contracts, not the full repository suite' }))
process.exitCode = failed ? 1 : 0
