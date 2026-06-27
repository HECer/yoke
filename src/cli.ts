#!/usr/bin/env node
import { validateCanon } from './canon/validate.js'

export function runValidate(canonDir: string): number {
  const issues = validateCanon(canonDir)
  for (const i of issues) {
    console.log(`${i.level === 'error' ? 'ERROR' : 'warn '} ${i.message}`)
  }
  const errors = issues.filter(i => i.level === 'error')
  if (errors.length === 0) {
    console.log(`✓ canon valid (${canonDir})`)
    return 0
  }
  console.log(`✗ ${errors.length} error(s)`)
  return 1
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'validate':
      return runValidate(rest[0] ?? 'canon')
    default:
      console.log('usage: forge validate [canonDir]')
      return cmd ? 1 : 0
  }
}

process.exit(main(process.argv.slice(2)))
