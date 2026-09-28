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

function assertNoSettingsSymlinks(paths: readonly string[]): void {
  for (const path of paths) {
    if (lstatIfPresent(path)?.isSymbolicLink()) throw new Error('SoL-Pi refuses symbolic-link settings paths: ' + path)
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
  const agentDirectory = join(piDirectory, 'agent')
  const settingsPath = join(agentDirectory, 'settings.json')
  const settingsPaths = [piDirectory, agentDirectory, settingsPath]
  assertNoSettingsSymlinks(settingsPaths)

  const existingSettings = lstatIfPresent(settingsPath) ? readFileSync(settingsPath) : undefined
  const createdDirectories: string[] = []
  const restore = (): void => {
    assertNoSettingsSymlinks(settingsPaths)
    if (existingSettings === undefined) rmSync(settingsPath, { force: true })
    else writeFileSync(settingsPath, existingSettings)
    removeCreatedDirectories(createdDirectories)
  }

  try {
    for (const directory of [piDirectory, agentDirectory]) {
      if (!lstatIfPresent(directory)) {
        mkdirSync(directory)
        createdDirectories.push(directory)
      }
    }
    writeFileSync(settingsPath, JSON.stringify(toSolPiNativeConfig(config)), { flag: existingSettings === undefined ? 'wx' : 'w' })
  } catch (error) {
    restore()
    throw error
  }

  return restore
}
