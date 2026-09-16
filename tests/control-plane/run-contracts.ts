import { contractCases } from './contracts.js'

let failures = 0
for (const { name, run } of contractCases) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}`, error) }
}
console.log(JSON.stringify({ total: contractCases.length, passed: contractCases.length - failures, failed: failures }))
process.exitCode = failures ? 1 : 0
