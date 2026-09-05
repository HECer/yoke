import { expect, it } from 'vitest'
import { contextPacket } from '../../src/context/packet.js'
it('keeps a stable project prefix and selects relevant source-referenced context within budget', () => {
  const ctx = { project: 'Build reliable checkout.', glossary: 'Order = purchase.', knowledge: '## Images\nResize photos.\n\n## Payments\nNever retry a charged payment.', decisions: '', contextMap: '' }
  const a = contextPacket(ctx, 'payment checkout', 1000)
  const b = contextPacket(ctx, 'images photos', 1000)
  expect(a.length).toBeLessThanOrEqual(1000)
  expect(a.split('Task references')[0]).toBe(b.split('Task references')[0])
  expect(a).toContain('KNOWLEDGE.md'); expect(a).toContain('sha256:')
  expect(a.indexOf('Payments')).toBeLessThan(a.indexOf('Images'))
})
