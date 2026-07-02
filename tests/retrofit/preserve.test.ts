import { describe, it, expect } from 'vitest'
import {
  PRESERVE_START,
  PRESERVE_END,
  PRESERVE_SCAFFOLD,
  extractPreserveBlocks,
  carryPreserved,
} from '../../src/retrofit/preserve.js'

const block = (inner: string) => `${PRESERVE_START}\n${inner}\n${PRESERVE_END}`

describe('extractPreserveBlocks', () => {
  it('returns [] when there are no markers', () => {
    expect(extractPreserveBlocks('# Hello\n\nno markers here\n')).toEqual([])
  })

  it('extracts the inner content of a single block', () => {
    const content = `# Doc\n\n${block('## My rules\n\n- rule one')}\n\ntail`
    expect(extractPreserveBlocks(content)).toEqual(['## My rules\n\n- rule one'])
  })

  it('extracts multiple blocks in order', () => {
    const content = `${block('first')}\nmiddle\n${block('second')}`
    expect(extractPreserveBlocks(content)).toEqual(['first', 'second'])
  })

  it('ignores an unbalanced start marker without an end marker', () => {
    const content = `${block('ok')}\n${PRESERVE_START}\ndangling`
    expect(extractPreserveBlocks(content)).toEqual(['ok'])
  })

  it('extracts an empty block as an empty string', () => {
    expect(extractPreserveBlocks(`${PRESERVE_START}\n${PRESERVE_END}`)).toEqual([''])
  })
})

describe('carryPreserved', () => {
  it('returns incoming unchanged when current has no preserve blocks', () => {
    const incoming = `template\n\n${PRESERVE_SCAFFOLD}\n`
    expect(carryPreserved('old content, no markers', incoming)).toBe(incoming)
  })

  it('replaces the incoming scaffold inner with the preserved content', () => {
    const current = `old template\n\n${block('## Project context\n\n@docs/PRD.md')}\n`
    const incoming = `new template\n\n${PRESERVE_SCAFFOLD}\n`
    const out = carryPreserved(current, incoming)
    expect(out).toContain('new template')
    expect(out).toContain(`${PRESERVE_START}\n## Project context\n\n@docs/PRD.md\n${PRESERVE_END}`)
    expect(out).not.toContain('Yoke keeps this block') // scaffold hint replaced
  })

  it('appends the preserved block when incoming has no markers', () => {
    const current = `old\n\n${block('keep me')}\n`
    const out = carryPreserved(current, 'new template\n')
    expect(out.startsWith('new template\n')).toBe(true)
    expect(out.endsWith(`${block('keep me')}\n`)).toBe(true)
  })

  it('joins multiple preserved blocks into the single incoming block', () => {
    const current = `${block('one')}\nx\n${block('two')}`
    const incoming = `t\n${PRESERVE_SCAFFOLD}\n`
    const out = carryPreserved(current, incoming)
    expect(out).toContain(`${PRESERVE_START}\none\n\ntwo\n${PRESERVE_END}`)
  })

  it('is idempotent: carrying a scaffold onto itself changes nothing', () => {
    const incoming = `template\n\n${PRESERVE_SCAFFOLD}\n`
    expect(carryPreserved(incoming, incoming)).toBe(incoming)
  })

  it('keeps a deliberately emptied block empty (does not resurrect the hint)', () => {
    const current = `t\n${PRESERVE_START}\n${PRESERVE_END}\n`
    const incoming = `t2\n${PRESERVE_SCAFFOLD}\n`
    const out = carryPreserved(current, incoming)
    expect(out).toContain(`${PRESERVE_START}\n\n${PRESERVE_END}`)
    expect(out).not.toContain('Yoke keeps this block')
  })
})
