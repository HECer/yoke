import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'yaml'

export interface UiDetection {
  readonly detected: boolean
  readonly signals: readonly string[]
}

const UI_DEPENDENCIES = new Set([
  '@angular/core', '@astrojs/react', '@astrojs/svelte', '@astrojs/vue',
  '@sveltejs/kit', '@vitejs/plugin-react', '@vitejs/plugin-react-swc',
  '@vitejs/plugin-vue', '@vitejs/plugin-vue-jsx', 'astro', 'next', 'nuxt',
  'react', 'react-dom', 'svelte', 'vue',
])
const UI_EXTENSIONS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.astro'])
const SOURCE_ROOTS = ['src', 'app', 'pages', 'components', 'web', 'frontend']
const IGNORED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.svelte-kit', '.yoke', '__fixtures__', 'build',
  'coverage', 'dist', 'fixtures', 'node_modules', 'test', 'tests',
])

function packageSignals(targetDir: string): string[] {
  const file = join(targetDir, 'package.json')
  if (!existsSync(file)) return []
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const names = new Set<string>()
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const section = pkg[key]
      if (section && typeof section === 'object' && !Array.isArray(section)) {
        for (const name of Object.keys(section)) if (UI_DEPENDENCIES.has(name)) names.add(name)
      }
    }
    return [...names].sort().map(name => `dependency: ${name}`)
  } catch {
    return []
  }
}

function sourceSignals(targetDir: string): string[] {
  const signals: string[] = []
  let visited = 0
  const visit = (directory: string): void => {
    if (visited >= 10_000) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (visited++ >= 10_000) return
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(join(directory, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
      if (UI_EXTENSIONS.has(extension)) {
        signals.push(`source: ${relative(targetDir, join(directory, entry.name)).replaceAll('\\', '/')}`)
      }
    }
  }
  for (const root of SOURCE_ROOTS) {
    const directory = join(targetDir, root)
    if (existsSync(directory)) visit(directory)
  }
  return signals.sort()
}

function hasSmokeFlows(targetDir: string): boolean {
  const file = join(targetDir, '.yoke', 'config.yaml')
  if (!existsSync(file)) return false
  try {
    const document = parse(readFileSync(file, 'utf8')) as { smoke?: { flows?: unknown[] } } | null
    return Array.isArray(document?.smoke?.flows) && document.smoke.flows.length > 0
  } catch {
    return false
  }
}

export function detectUiProject(targetDir: string): UiDetection {
  const signals = [...packageSignals(targetDir), ...sourceSignals(targetDir)]
  if (hasSmokeFlows(targetDir)) signals.push('config: smoke flows')
  return { detected: signals.length > 0, signals }
}
