#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { validateCanon } from './canon/validate.js'

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

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  process.exit(main(process.argv.slice(2)))
}
