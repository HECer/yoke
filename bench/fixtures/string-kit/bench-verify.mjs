// Cumulative verify: the loop sets YOKE_STORY (e.g. STORY-2); we run the test
// files for that story AND all earlier ones, so later stories can't break
// earlier work. Without YOKE_STORY (final quality check), all tests run.
import { spawnSync } from 'node:child_process'

const TOTAL = 3
const story = process.env.YOKE_STORY
const n = story ? Number(story.split('-')[1]) : TOTAL
const upTo = Number.isFinite(n) && n >= 1 && n <= TOTAL ? n : TOTAL

const files = []
for (let i = 1; i <= upTo; i++) files.push(`tests/STORY-${i}.test.mjs`)

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(r.status ?? 1)
