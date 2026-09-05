import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { registerProject, listProjects, unregisterProject } from '../../src/dashboard/registry.js'
import { startDashboard } from '../../src/dashboard/server.js'
import { createProjectGoal } from '../../src/goals/command.js'
let root: string
let oldState: string | undefined
let server: Awaited<ReturnType<typeof startDashboard>> | undefined
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-dash-')); oldState = process.env.YOKE_STATE_DIR; process.env.YOKE_STATE_DIR = join(root, 'state') })
afterEach(async () => { await server?.close(); server = undefined; if (oldState === undefined) delete process.env.YOKE_STATE_DIR; else process.env.YOKE_STATE_DIR = oldState; rmSync(root, { recursive: true, force: true }) })
it('registers canonical roots once and surfaces missing projects', () => {
  const project = join(root, 'project'); mkdirSync(project)
  const first = registerProject(project)
  expect(registerProject(join(project, '.')).id).toBe(first.id)
  rmSync(project, { recursive: true })
  expect(listProjects()[0].error).toBeTruthy()
})
it('unregisters only opaque registry references', () => {
  const entry = registerProject(root)
  expect(() => unregisterProject('../goal')).toThrow()
  expect(unregisterProject(entry.id)).toBe(true)
  expect(unregisterProject(entry.id)).toBe(false)
  expect(existsSync(root)).toBe(true)
})
it('serves only loopback Host and rejects missing Origin or session token for writes', async () => {
  registerProject(root)
  server = await startDashboard({ port: 0 })
  const status = await new Promise<number>(resolve => { request(server!.url, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!) }).end() })
  expect(status).toBe(403)
  const project = listProjects()[0]
  expect((await fetch(`${server.url}api/projects/${project.id}/pause`, { method: 'POST' })).status).toBe(403)
  expect((await fetch(`${server.url}api/projects/${project.id}/pause`, { method: 'POST', headers: { Origin: 'https://evil.example', 'x-yoke-token': 'bad' } })).status).toBe(403)
  expect((await fetch(`${server.url}api/files?path=/etc/passwd`)).status).toBe(404)
})
it('keeps malicious project text out of HTML and bounds project reads', async () => {
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/goal.json'), JSON.stringify({ objective: '</script><script>alert(1)</script>', status: 'active', attempts: [] }))
  const project = registerProject(root)
  server = await startDashboard({ port: 0 })
  const page = await fetch(server.url)
  const html = await page.text()
  expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(html).not.toContain('alert(1)')
  expect(html).not.toContain('innerHTML')
  const data = await (await fetch(`${server.url}api/projects/${project.id}`)).json()
  expect(data.goal.objective).toContain('<script>')
  writeFileSync(join(root, '.yoke/goal.json'), 'x'.repeat(1_048_577))
  const oversized = await (await fetch(`${server.url}api/projects/${project.id}`)).json()
  expect(oversized.errors.join(' ')).toContain('too large')
})
it('uses the shared pause service only with same-origin session authorization', async () => {
  createProjectGoal(root, 'Test goal')
  const project = registerProject(root)
  server = await startDashboard({ port: 0 })
  const html = await (await fetch(server.url)).text()
  const token = /const sessionToken = "([a-f0-9]+)"/u.exec(html)![1]
  const origin = server.url.slice(0, -1)
  expect((await fetch(`${server.url}api/projects/${project.id}/pause`, { method: 'POST', headers: { Origin: origin, 'x-yoke-token': 'é'.repeat(64) } })).status).toBe(403)
  expect((await fetch(`${server.url}api/projects/${project.id}/pause`, { method: 'POST', headers: { Origin: origin, 'x-yoke-token': token } })).status).toBe(200)
  expect(existsSync(join(root, '.yoke/goal.pause'))).toBe(true)
})
it('retains per-attempt tokens and partial call measurement for project details', async () => {
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/goal.json'), JSON.stringify({ objective: 'Tokens', status: 'blocked', attempts: [{ provider: 'gemini', success: false, inputTokens: 20, outputTokens: 5 }] }))
  writeFileSync(join(root, '.yoke/loop-status.json'), JSON.stringify({ state: 'blocked', tokens: { inputTokens: 100, outputTokens: 30, measurementComplete: false }, measurement: { measuredCalls: 2, unknownCalls: 1, unmeasuredAttempts: 0, costAvailable: 'unknown' } }))
  const project = registerProject(root)
  server = await startDashboard({ port: 0 })
  const data = await (await fetch(`${server.url}api/projects/${project.id}`)).json()
  expect(data.goal.attempts[0]).toMatchObject({ inputTokens: 20, outputTokens: 5 })
  expect(data.status.measurement).toMatchObject({ measuredCalls: 2, unknownCalls: 1 })
})
