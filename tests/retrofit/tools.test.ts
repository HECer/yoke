import { describe, it, expect } from 'vitest'
import { mcpServers, rtkInstruction } from '../../src/retrofit/tools.js'

describe('tools', () => {
  it('mcpServers defaults to no external tools', () => {
    const servers = mcpServers()
    expect(servers).toEqual({})
  })

  it('mcpServers("serena") wires serena instead of graphify', () => {
    const servers = mcpServers('serena')
    expect(Object.keys(servers)).toEqual(['serena'])
    expect(servers).not.toHaveProperty('graphify')
    expect(servers.serena.command).toBeTypeOf('string')
    expect(servers.serena.args).toEqual([
      'start-mcp-server',
      '--open-web-dashboard',
      'false',
    ])
  })

  it('publishes one Yoke facade in federated mode without duplicate backend tools', () => {
    const servers = mcpServers('serena', 'active', '/workspace/project')
    expect(Object.keys(servers)).toEqual(['code-intelligence'])
    expect(servers['code-intelligence']).toEqual({ command: 'yoke', args: ['code-intelligence-server', '--workspace=/workspace/project', '--mode=active'] })
    expect(servers).not.toHaveProperty('serena')
    expect(servers).not.toHaveProperty('graphify')
  })

  it('only wires pinned browser tools when explicitly selected', () => {
    const servers = mcpServers('none', 'off', '.', true)
    expect(Object.keys(servers)).toEqual(['playwright'])
    expect(servers.playwright).toEqual({ command: 'npx', args: ['--yes', '@playwright/mcp@0.0.84'] })
  })

  it('rtkInstruction mentions prefixing commands with rtk', () => {
    expect(rtkInstruction()).toMatch(/rtk/i)
  })
})
