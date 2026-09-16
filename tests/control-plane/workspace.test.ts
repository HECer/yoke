import { it } from 'vitest'
import { registerWorkspaceCases } from './workspace-cases.js'

registerWorkspaceCases((name, run) => it(name, run))
