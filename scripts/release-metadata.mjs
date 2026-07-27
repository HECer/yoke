#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const MARKERS = {
  version: 'version',
  tests: 'testCount',
  skills: 'skillCount',
  agents: 'agents',
}

function countTests(dir) {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) count += countTests(path)
    else if (/\.test\.(?:ts|js|mjs)$/.test(entry.name)) {
      const source = readFileSync(path, 'utf8')
      count += [...source.matchAll(/\b(?:it|test)\s*\(/g)].length
    }
  }
  return count
}

export function collectMetadata(root, testSummary) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const manifest = parse(readFileSync(join(root, 'canon', 'manifest.yaml'), 'utf8'))
  const match = testSummary?.match(/Tests?\s+(\d+)\s+passed/i)
  return {
    version: String(pkg.version),
    agents: [...manifest.agents],
    skillCount: manifest.skills.length,
    testCount: match ? Number(match[1]) : countTests(join(root, 'tests')),
  }
}

export function updateReadme(readme, metadata) {
  const values = {
    version: metadata.version,
    tests: String(metadata.testCount),
    skills: String(metadata.skillCount),
    agents: metadata.agents.map(a => a[0].toUpperCase() + a.slice(1)).join(' | '),
  }
  let next = readme
  for (const [marker, key] of Object.entries(MARKERS)) {
    const start = `<!-- yoke:${marker}:start -->`
    const end = `<!-- yoke:${marker}:end -->`
    const pattern = new RegExp(`${start}[\\s\\S]*?${end}`)
    if (!pattern.test(next)) throw new Error(`README is missing ${marker} metadata markers`)
    next = next.replace(pattern, `${start}${values[marker]}${end}`)
  }
  return next
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const readmePath = join(root, 'README.md')
  const before = readFileSync(readmePath, 'utf8')
  const after = updateReadme(before, collectMetadata(root))
  if (process.argv.includes('--check')) {
    if (after !== before) {
      console.error('README release metadata is stale. Run: npm run docs:update')
      process.exitCode = 1
    }
    return
  }
  writeFileSync(readmePath, after)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
