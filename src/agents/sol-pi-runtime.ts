import { lstatSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadConfig, toSolPiNativeConfig, type YokeConfig } from '../retrofit/config.js'

export function loadSolPiProjectConfig(directory: string): YokeConfig | null {
  let current = resolve(directory)
  while (true) {
    const config = loadConfig(current)
    if (config) return config
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function assertNoConfigSymlinks(paths: readonly string[]): void {
  for (const path of paths) {
    if (lstatIfPresent(path)?.isSymbolicLink()) throw new Error('SoL-Pi refuses symbolic-link config paths: ' + path)
  }
}

function removeCreatedDirectories(directories: readonly string[]): void {
  for (const directory of [...directories].reverse()) {
    try { rmdirSync(directory) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error
    }
  }
}

export function prepareSolPiTemporaryConfig(workspace: string): () => void {
  const config = loadSolPiProjectConfig(workspace)
  if (!config?.solpi?.enabled) return () => {}

  const piDirectory = resolve(workspace, '.pi')
  const solPiConfigPath = join(piDirectory, 'sol-pi.json')
  const configPaths = [piDirectory, solPiConfigPath]
  assertNoConfigSymlinks(configPaths)

  const existingConfig = lstatIfPresent(solPiConfigPath) ? readFileSync(solPiConfigPath) : undefined
  const createdDirectories: string[] = []
  const restore = (): void => {
    assertNoConfigSymlinks(configPaths)
    if (existingConfig === undefined) rmSync(solPiConfigPath, { force: true })
    else writeFileSync(solPiConfigPath, existingConfig)
    removeCreatedDirectories(createdDirectories)
  }

  try {
    for (const directory of [piDirectory]) {
      if (!lstatIfPresent(directory)) {
        mkdirSync(directory)
        createdDirectories.push(directory)
      }
    }
    writeFileSync(solPiConfigPath, JSON.stringify(toSolPiNativeConfig(config)), { flag: existingConfig === undefined ? 'wx' : 'w' })
  } catch (error) {
    restore()
    throw error
  }

  return restore
}
