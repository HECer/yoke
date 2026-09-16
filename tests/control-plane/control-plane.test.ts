import { test } from 'vitest'
import { contractCases } from './contracts.js'

for (const { name, run } of contractCases) test(name, run)
