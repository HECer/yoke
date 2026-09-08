import { describe, expect, it } from 'vitest'
import { ContextInputSchema, EditApplyInputSchema, EditPreviewInputSchema, TOOL_DEFINITIONS } from '../../src/code-intelligence/contracts.js'

describe('code intelligence contracts', () => {
  it('publishes exactly the six snapshot-bound facade tools', () => {
    expect(TOOL_DEFINITIONS.map(tool => tool.name)).toEqual(['code_context', 'code_symbol', 'code_trace', 'code_impact', 'code_edit_preview', 'code_edit_apply'])
    expect(TOOL_DEFINITIONS.every(tool => tool.annotations.openWorldHint === false)).toBe(true)
  })

  it('rejects ambiguous symbol and impact requests', () => {
    expect(() => ContextInputSchema.parse({ workspace_id: 'w', query: 'x', token_budget: 64 })).toThrow()
    expect(() => EditApplyInputSchema.parse({ workspace_id: 'w', plan_id: 'p', expected_snapshot_id: 's', idempotency_key: 'short' })).toThrow()
    expect(() => EditPreviewInputSchema.parse({ workspace_id: 'w', snapshot_id: 's', validation_profile: 'default', operations: [{ kind: 'rename', symbol_id: 's', new_name: 'valid' }] })).not.toThrow()
  })
})
