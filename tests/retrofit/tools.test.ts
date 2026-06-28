import { describe, it, expect } from 'vitest'
import { mcpServers, rtkInstruction } from '../../src/retrofit/tools.js'

describe('tools', () => {
  it('mcpServers defaults to graphify + playwright', () => {
    const servers = mcpServers()
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['graphify', 'playwright']))
    expect(servers).not.toHaveProperty('serena')
    expect(servers.playwright.command).toBe('npx')
    expect(servers.playwright.args).toContain('@playwright/mcp@latest')
  })

  it('mcpServers("serena") wires serena instead of graphify', () => {
    const servers = mcpServers('serena')
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['serena', 'playwright']))
    expect(servers).not.toHaveProperty('graphify')
    expect(servers.serena.command).toBeTypeOf('string')
  })

  it('rtkInstruction mentions prefixing commands with rtk', () => {
    expect(rtkInstruction()).toMatch(/rtk/i)
  })
})
