import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { listProjects, type RegisteredProject } from './registry.js'
import { dashboardPage } from './page.js'
import { readEvents } from '../observability/events.js'
import { estimateSchedule } from '../estimation/schedule.js'
import { pauseProjectGoal } from '../goals/command.js'

const text = z.string().max(16000)
const number = z.number().finite().nonnegative()
const Goal = z.object({ objective: text, status: z.enum(['active', 'running', 'paused', 'blocked', 'complete']), reason: text.optional(), attempts: z.array(z.object({ durationMs: number.optional(), provider: text.optional(), success: z.boolean().optional(), summary: text.optional(), inputTokens: number.optional(), outputTokens: number.optional() })).max(200).default([]) })
const Status = z.object({ state: text, phase: text.optional(), reason: text.optional(), progress: z.object({ passed: number, total: number }).optional(), tokens: z.object({ inputTokens: number, outputTokens: number, totalCostUsd: number.optional(), measurementComplete: z.boolean().optional(), model: text.optional(), calls: z.array(z.object({ usageAvailable: z.boolean().optional() })).max(10000).optional() }).optional(), measurement: z.object({ costAvailable: z.enum(['unknown', 'partial', 'measured']), measuredCalls: number.optional(), unknownCalls: number.optional(), unmeasuredAttempts: number.optional() }).passthrough().optional(), parallel: z.object({ maxConcurrency: number }).passthrough().optional() }).passthrough()
const Stories = z.array(z.object({ id: text, title: text, passes: z.boolean(), priority: number.optional(), area: text.optional(), writes: z.array(text).optional(), needs: z.array(text).optional() })).max(2000)
const Check = z.object({ id: text, status: z.enum(['passed', 'failed', 'unverified']), generatedAt: text, summary: text, criteria: z.array(z.object({ id: text, text, status: z.enum(['passed', 'failed', 'unverified']), summary: text })).max(500) })
const Durations = z.array(z.object({ storyId: text, ms: number.positive() })).max(5000)
const MAX_FILE = 1_048_576

function safeFile(root: string, relative: string): string | undefined {
  let file = root
  try {
    for (const part of relative.split('/')) {
      file = join(file, part)
      if (lstatSync(file).isSymbolicLink()) throw new Error(`${relative}: linked state is unavailable`)
    }
    const stat = lstatSync(file)
    if (!stat.isFile()) throw new Error(`${relative}: not a file`)
    if (stat.size > MAX_FILE) throw new Error(`${relative}: file too large`)
    return readFileSync(file, 'utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function snapshot(project: RegisteredProject, detail: boolean) {
  const errors: string[] = project.error ? [project.error] : []
  const read = <T>(file: string, schema: z.ZodType<T>, yaml = false): T | null => {
    if (project.error) return null
    try { const value = safeFile(project.root, file); return value === undefined ? null : schema.parse(yaml ? parse(value, { maxAliasCount: 10 }) : JSON.parse(value)) }
    catch (error) { errors.push(`${file}: ${error instanceof z.ZodError ? 'Invalid data' : (error as Error).message}`); return null }
  }
  const goal = read('.yoke/goal.json', Goal)
  const status = read('.yoke/loop-status.json', Status)
  const stories = detail ? read('.yoke/prd.yaml', Stories, true) ?? [] : []
  const history = detail ? read('.yoke/story-durations.json', Durations) ?? [] : []
  let check = null
  if (detail && !project.error) {
    try {
      const dir = join(project.root, '.yoke/checks')
      if (lstatSync(join(project.root, '.yoke')).isSymbolicLink() || lstatSync(dir).isSymbolicLink()) throw new Error('Linked checks unavailable')
      const names = readdirSync(dir).filter(name => /^[a-f0-9-]{36}\.json$/u.test(name))
      if (names.length > 2000) errors.push('Check history exceeds dashboard scan limit')
      const latest = names.slice(-2000).map(name => ({ name, time: lstatSync(join(dir, name)).mtimeMs })).sort((a, b) => b.time - a.time)[0]
      if (latest) check = read(`.yoke/checks/${latest.name}`, Check)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push((error as Error).message) }
  }
  return { ...project, goal, status, errors, ...(detail ? { stories, check, events: project.error ? [] : readEvents(project.root, 100), estimate: estimateSchedule(stories, Math.max(1, status?.parallel?.maxConcurrency ?? 1), history) } : {}) }
}
export async function startDashboard(options: { port?: number } = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString('hex')
  const nonce = randomBytes(24).toString('base64')
  let origin = ''
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`)
    const send = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
    if (req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin)) { send(403, { error: 'Untrusted request origin' }); return }
    let path: string
    try { path = new URL(req.url ?? '/', origin).pathname } catch { send(400, { error: 'Invalid URL' }); return }
    if (req.method === 'POST') {
      const supplied = req.headers['x-yoke-token']
      if (req.headers.origin !== origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { send(403, { error: 'Missing dashboard session authorization' }); return }
    }
    try {
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); res.end(); return }
      if (req.method === 'GET' && path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(dashboardPage(token, nonce)); return }
      if (req.method === 'GET' && path === '/api/projects') { send(200, listProjects().map(project => snapshot(project, false))); return }
      const match = /^\/api\/projects\/([a-f0-9]{32})(\/pause)?$/u.exec(path)
      if (match) {
        const project = listProjects().find(project => project.id === match[1])
        if (!project) { send(404, { error: 'Unknown project' }); return }
        if (req.method === 'GET' && !match[2]) { send(200, snapshot(project, true)); return }
        if (req.method === 'POST' && match[2]) {
          if (project.error || !snapshot(project, false).goal) { send(409, { error: 'No readable project goal' }); return }
          safeFile(project.root, '.yoke/goal.pause')
          pauseProjectGoal(project.root)
          send(200, { status: 'pause-requested' }); return
        }
      }
      send(404, { error: 'Not found' })
    } catch (error) { send(500, { error: (error as Error).message }) }
  })
  server.maxHeadersCount = 40
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Dashboard address unavailable')
  origin = `http://127.0.0.1:${address.port}`
  return { url: `${origin}/`, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }) }
}
