import { describe, it, expect } from 'vitest'
import { mcpServers, rtkInstruction } from '../../src/retrofit/tools.js'

describe('tools', () => {
  it('mcpServers includes graphify and playwright with command+args', () => {
    const servers = mcpServers()
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['graphify', 'playwright']))
    expect(servers.playwright.command).toBe('npx')
    expect(servers.playwright.args).toContain('@playwright/mcp@latest')
    expect(servers.graphify.command).toBeTypeOf('string')
  })

  it('rtkInstruction mentions prefixing commands with rtk', () => {
    expect(rtkInstruction()).toMatch(/rtk/i)
  })
})
