import type { BackendName } from '../contracts.js'

export interface BackendCall { tool: string; arguments: Record<string, unknown> }
export interface BackendAdapter {
  readonly name: BackendName
  readonly version: string
  readonly semantic: boolean
  readonly documents: boolean
  call(request: BackendCall, timeoutMs: number): Promise<unknown>
  close(): Promise<void>
}
