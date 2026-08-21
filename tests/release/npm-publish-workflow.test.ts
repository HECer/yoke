import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const workflowPath = join(root, '.github', 'workflows', 'publish-npm.yml')

describe('npm trusted publishing workflow', () => {
  it('publishes released versions through token-free GitHub OIDC', () => {
    expect(existsSync(workflowPath)).toBe(true)
    if (!existsSync(workflowPath)) return

    const workflow = readFileSync(workflowPath, 'utf8')
    expect(workflow).toMatch(/release:\s*\n\s+types: \[published\]/u)
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('contents: read')
    expect(workflow).toMatch(/node-version: ['"]24['"]/u)
    expect(workflow).toContain("registry-url: 'https://registry.npmjs.org'")
    expect(workflow).toContain('package-manager-cache: false')
    expect(workflow).toContain('gh release view "$RELEASE_TAG"')
    expect(workflow).toContain('"v$PACKAGE_VERSION"')
    expect(workflow).toContain('npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version')
    expect(workflow).toContain('npm publish --access public')
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./u)
  })
})
