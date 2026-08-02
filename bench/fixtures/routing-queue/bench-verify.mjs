import { spawnSync } from 'node:child_process'

const total = 2
const story = process.env.YOKE_STORY
const requested = story ? Number(story.split('-')[1]) : total
const upTo = Number.isFinite(requested) && requested >= 1 && requested <= total ? requested : total
const files = Array.from({ length: upTo }, (_, index) => `tests/STORY-${index + 1}.test.mjs`)
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
