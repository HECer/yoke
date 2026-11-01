import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { killProcessTreeForCleanup } from '../loop/watchdog.js'

export type McpFraming = 'line' | 'content-length'
export interface McpCallResult { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean }
interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface Generation {
  child: ChildProcessWithoutNullStreams; buffer: Buffer; pending: Map<number, Pending>; stderrBytes: number
  ready: Promise<void>; closed: Promise<void>; closing?: Promise<void>; ended: boolean; version?: string
}

/** Bounded MCP transport. State and initialization belong to one process generation. */
export class McpStdioClient {
  private generation?: Generation
  private nextId = 1
  constructor(private readonly command: string, private readonly args: string[], private readonly cwd: string, private readonly framing: McpFraming = 'content-length', private readonly maxBytes = 2_000_000) {}
  get serverVersion(): string | undefined { return this.generation?.version }

  async call(tool: string, arguments_: Record<string, unknown>, timeoutMs: number): Promise<McpCallResult> {
    const deadline = Date.now() + timeoutMs, generation = await this.start(timeoutMs)
    return this.request(generation, 'tools/call', { name: tool, arguments: arguments_ }, deadline - Date.now()) as Promise<McpCallResult>
  }
  async listTools(timeoutMs: number): Promise<string[]> {
    const deadline = Date.now() + timeoutMs, generation = await this.start(timeoutMs)
    const result = await this.request(generation, 'tools/list', {}, deadline - Date.now()) as { tools?: Array<{ name?: unknown }> }
    if (!Array.isArray(result.tools)) throw new Error('MCP backend did not advertise tools')
    return result.tools.map(tool => tool.name).filter((name): name is string => typeof name === 'string')
  }
  async close(): Promise<void> { if (this.generation) await this.stop(this.generation) }

  private async start(timeoutMs: number): Promise<Generation> {
    const deadline = Date.now() + timeoutMs
    if (this.generation?.closing) await this.untilDeadline(this.generation.closing, deadline)
    let generation = this.generation
    if (!generation || generation.ended) {
      // Backend processes are trusted local programs, not a network sandbox.
      // Do not implicitly pass API tokens or unrelated application credentials.
      const env: NodeJS.ProcessEnv = { NO_COLOR: '1' }
      for (const [key, value] of Object.entries(process.env)) if (/^(PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|SYSTEMROOT|COMSPEC|PATHEXT|LANG|LC_.+|XDG_.+|VIRTUAL_ENV|CONDA_PREFIX|PYTHONPATH)$/i.test(key)) env[key] = value
      const child = spawn(this.command, this.args, { cwd: this.cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env })
      let finish!: () => void
      generation = { child, buffer: Buffer.alloc(0), pending: new Map(), stderrBytes: 0, ready: Promise.resolve(), closed: new Promise(resolve => { finish = resolve }), ended: false }
      this.generation = generation
      const current = generation
      child.stdout.on('data', chunk => this.consume(current, Buffer.from(chunk)))
      child.stderr.on('data', chunk => { current.stderrBytes += Buffer.byteLength(chunk); if (current.stderrBytes > this.maxBytes) void this.stop(current).catch(() => {}) })
      child.on('error', error => { this.fail(current, new Error(`MCP backend failed to start: ${error.message}`)); current.ended = true; finish() })
      child.on('close', (code, signal) => {
        current.ended = true; finish()
        this.fail(current, new Error(`MCP backend exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`))
        // Retire the group even if the wrapper died before its language server.
        if (!current.closing) void this.stop(current).catch(() => {})
      })
      current.ready = (async () => {
        const result = await this.request(current, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'yoke-code-intelligence', version: '0.2.0' } }, timeoutMs) as { serverInfo?: { version?: unknown } }
        if (typeof result?.serverInfo?.version === 'string') current.version = result.serverInfo.version
        this.write(current, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
      })()
      // A caller always awaits ready; this also handles failures during shutdown.
      void current.ready.catch(() => { void this.stop(current).catch(() => {}) })
    }
    await this.untilDeadline(generation.ready, deadline)
    if (generation.ended || generation.closing) throw new Error('MCP process closed during initialization')
    return generation
  }
  private async untilDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('MCP initialization deadline exceeded')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('MCP initialization deadline exceeded')), remaining) })])
    } finally { if (timer) clearTimeout(timer) }
  }
  private stop(generation: Generation): Promise<void> {
    if (generation.closing) return generation.closing
    this.fail(generation, new Error('MCP process closed'))
    generation.closing = (async () => {
      const pid = generation.child.pid
      if (pid !== undefined && !killProcessTreeForCleanup(pid)) throw new Error('MCP process-tree termination is unconfirmed; restart blocked')
      if (!generation.ended) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([generation.closed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('MCP process-tree shutdown timed out; restart blocked')), 1500) })]) }
        finally { if (timer) clearTimeout(timer) }
      }
      generation.buffer = Buffer.alloc(0)
      if (this.generation === generation) this.generation = undefined
    })()
    return generation.closing
  }
  private request(generation: Generation, method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (timeoutMs <= 0) return Promise.reject(new Error(`MCP request deadline exceeded: ${method}`))
    if (generation.ended || generation.closing) return Promise.reject(new Error('MCP process is not running'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { generation.pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); void this.stop(generation).catch(() => {}) }, timeoutMs)
      generation.pending.set(id, { resolve, reject, timer })
      try { this.write(generation, { jsonrpc: '2.0', id, method, params }) }
      catch (error) { clearTimeout(timer); generation.pending.delete(id); reject(error) }
    })
  }
  private write(generation: Generation, message: unknown): void {
    if (!generation.child.stdin.writable || generation.ended) throw new Error('MCP stdin is closed')
    const payload = JSON.stringify(message)
    if (Buffer.byteLength(payload) > this.maxBytes) throw new Error('MCP request frame exceeds byte limit')
    generation.child.stdin.write(this.framing === 'line' ? `${payload}\n` : `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)
  }
  private consume(generation: Generation, chunk: Buffer): void {
    if (generation.closing || generation.ended) return
    generation.buffer = Buffer.concat([generation.buffer, chunk])
    if (generation.buffer.length > this.maxBytes) { this.fail(generation, new Error('MCP response frame exceeds byte limit')); void this.stop(generation).catch(() => {}); return }
    while (generation.buffer.length) {
      let raw: string
      if (this.framing === 'line') {
        const end = generation.buffer.indexOf(10); if (end < 0) return
        raw = generation.buffer.subarray(0, end).toString('utf8').trim(); generation.buffer = generation.buffer.subarray(end + 1)
      } else {
        const end = generation.buffer.indexOf('\r\n\r\n'); if (end < 0) return
        const match = /^Content-Length:\s*(\d+)\s*$/im.exec(generation.buffer.subarray(0, end).toString('ascii'))
        const size = Number(match?.[1])
        if (!match || !Number.isSafeInteger(size) || size > this.maxBytes) { this.fail(generation, new Error('Invalid or oversized MCP frame')); void this.stop(generation).catch(() => {}); return }
        if (generation.buffer.length < end + 4 + size) return
        raw = generation.buffer.subarray(end + 4, end + 4 + size).toString('utf8'); generation.buffer = generation.buffer.subarray(end + 4 + size)
      }
      if (!raw) continue
      try {
        const message = JSON.parse(raw), pending = generation.pending.get(message.id)
        if (!pending) continue
        generation.pending.delete(message.id); clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(String(message.error.message ?? 'MCP request failed')))
        else pending.resolve(message.result)
      } catch { /* A complete non-JSON log line is ignored; bytes remain bounded. */ }
    }
  }
  private fail(generation: Generation, error: Error): void {
    for (const pending of generation.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    generation.pending.clear()
  }
}
