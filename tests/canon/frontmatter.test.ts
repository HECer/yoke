import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../../src/canon/frontmatter.js'

describe('parseFrontmatter', () => {
  it('parses name and description from a --- block', () => {
    const md = '---\nname: tdd\ndescription: Test-driven development\n---\n# Body\n'
    expect(parseFrontmatter(md)).toMatchObject({ name: 'tdd', description: 'Test-driven development' })
  })

  it('tolerates CRLF line endings', () => {
    const md = '---\r\nname: x\r\ndescription: y\r\n---\r\nbody'
    expect(parseFrontmatter(md)).toMatchObject({ name: 'x', description: 'y' })
  })

  it('returns null when there is no frontmatter', () => {
    expect(parseFrontmatter('# just a heading\n')).toBeNull()
  })
})
