import { spawnSync } from 'node:child_process'
const ids = process.env.YOKE_STORY ? [process.env.YOKE_STORY] : ['STORY-1', 'STORY-2', 'STORY-3']
const r = spawnSync(process.execPath, ['--test', ...ids.map(id => `tests/${id}.test.mjs`)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
