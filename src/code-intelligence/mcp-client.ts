import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export type McpFraming = 'line' | 'content-length'
export interface McpCallResult { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean }

interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

/** Small, bounded stdio MCP client. It supports Graft's newline JSON-RPC and the
 * Content-Length framing used by the Python MCP SDK (Graphify and Serena). */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private buffer = Buffer.alloc(0)
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private stderrBytes = 0

  constructor(private readonly command: string, private readonly args: string[], private readonly cwd: string, private readonly framing: McpFraming = 'content-length', private readonly maxBytes = 2_000_000) {}

  async call(tool: string, arguments_: Record<string, unknown>, timeoutMs: number): Promise<McpCallResult> {
    await this.start(timeoutMs)
    return this.request('tools/call', { name: tool, arguments: arguments_ }, timeoutMs) as Promise<McpCallResult>
  }

  async close(): Promise<void> {
    if (!this.child) return
    const child = this.child
    this.child = undefined
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('MCP process closed')) }
    this.pending.clear()
    child.kill('SIGTERM')
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); resolve() }, 500)
      child.once('close', () => { clearTimeout(timer); resolve() })
    })
  }

  private async start(timeoutMs: number): Promise<void> {
    if (this.child) return
    const child = spawn(this.command, this.args, { cwd: this.cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } })
    this.child = child
    child.stdout.on('data', chunk => this.consume(Buffer.from(chunk)))
    child.stderr.on('data', chunk => { this.stderrBytes += Buffer.byteLength(chunk); if (this.stderrBytes > this.maxBytes) void this.close() })
    child.on('error', error => this.fail(new Error(`MCP backend failed to start: ${error.message}`)))
    child.on('close', (code, signal) => { if (this.child === child) this.child = undefined; this.fail(new Error(`MCP backend exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`)) })
    await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'yoke-code-intelligence', version: '0.1.0' } }, timeoutMs)
    await this.notify('notifications/initialized', {})
  }

  private notify(method: string, params: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params })
    this.write(payload)
    return Promise.resolve()
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('MCP process is not running'))
    const id = this.nextId++
    this.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); void this.close() }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  private write(payload: string): void {
    if (!this.child?.stdin.writable) throw new Error('MCP stdin is closed')
    if (this.framing === 'line') this.child.stdin.write(`${payload}\n`)
    else this.child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`)
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.byteLength > this.maxBytes) { void this.close(); return }
    while (this.buffer.byteLength > 0) {
      if (this.framing === 'line') {
        const newline = this.buffer.indexOf(10)
        if (newline < 0) return
        const line = this.buffer.subarray(0, newline).toString('utf8').trim()
        this.buffer = this.buffer.subarray(newline + 1)
        if (line) this.accept(line)
        continue
      }
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) { this.buffer = this.buffer.subarray(headerEnd + 4); continue }
      const length = Number(match[1])
      const start = headerEnd + 4
      if (this.buffer.byteLength < start + length) return
      const body = this.buffer.subarray(start, start + length).toString('utf8')
      this.buffer = this.buffer.subarray(start + length)
      this.accept(body)
    }
  }

  private accept(raw: string): void {
    try {
      const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id); clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message ?? 'MCP request failed'))
      else pending.resolve(message.result)
    } catch { /* backend log/noise on stdout is ignored; protocol errors surface by timeout */ }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
  }
}
