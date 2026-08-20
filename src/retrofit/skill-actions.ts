import { parse, stringify } from 'yaml'
import { enumerateSkillPackage, type SkillEntry, type SkillPackageFile } from '../canon/skill-package.js'
import type { Action } from './plan.js'

type SkillProvider = 'claude' | 'codex' | 'gemini'

const roots: Record<SkillProvider, string> = {
  claude: '.claude/skills',
  codex: '.agents/skills',
  gemini: '.gemini/skills',
}

function manualClaudeSkill(content: Buffer, skill: SkillEntry): string {
  const source = content.toString('utf8')
  const match = source.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/u)
  if (!match) throw new Error(`skill ${skill.id}: cannot adapt manual invocation without frontmatter`)
  const newline = match[1]!.includes('\r\n') ? '\r\n' : '\n'
  const frontmatter = match[2]!
  const adapted = /(?:^|\r?\n)disable-model-invocation:/u.test(frontmatter)
    ? frontmatter.replace(/(^|\r?\n)disable-model-invocation:\s*[^\r\n]*/u, `$1disable-model-invocation: true`)
    : `${frontmatter}${newline}disable-model-invocation: true`
  return `${match[1]}${adapted}${match[3]}${source.slice(match[0].length)}`
}

function codexPolicy(skill: SkillEntry, existing?: SkillPackageFile): string {
  const allow = skill.invocation === 'auto'
  const document = existing ? parse(existing.content.toString('utf8')) : {}
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`skill ${skill.id}: agents/openai.yaml must contain a YAML object`)
  }
  const record = document as Record<string, unknown>
  const policy = record.policy
  if (policy !== undefined && (typeof policy !== 'object' || policy === null || Array.isArray(policy))) {
    throw new Error(`skill ${skill.id}: agents/openai.yaml policy must be a YAML object`)
  }
  const policyRecord = (policy ?? {}) as Record<string, unknown>
  const declared = policyRecord.allow_implicit_invocation
  if (declared !== undefined && declared !== allow) {
    throw new Error(`skill ${skill.id}: agents/openai.yaml invocation policy conflicts with manifest`)
  }
  return stringify({ ...record, policy: { ...policyRecord, allow_implicit_invocation: allow } })
}

function portableContent(file: SkillPackageFile): string | Buffer {
  const text = file.content.toString('utf8')
  return !text.includes('\0') && Buffer.from(text, 'utf8').equals(file.content) ? text : file.content
}

export function skillPackageActions(canonDir: string, skill: SkillEntry, provider: SkillProvider): Action[] {
  const files = enumerateSkillPackage(canonDir, skill)
  const policyPath = 'agents/openai.yaml'
  const existingPolicy = provider === 'codex' ? files.find(file => file.relativePath === policyPath) : undefined
  const actions: Action[] = files
    .filter(file => provider !== 'codex' || file.relativePath !== policyPath)
    .map(file => ({
      kind: 'write' as const,
      target: `${roots[provider]}/${skill.id}/${file.relativePath}`,
      content: provider === 'claude' && skill.invocation === 'manual' && file.relativePath === 'SKILL.md'
        ? manualClaudeSkill(file.content, skill)
        : portableContent(file),
      executable: file.executable,
      reason: `skill: ${skill.id} (${file.relativePath})`,
    }))
  if (provider === 'codex') {
    actions.push({
      kind: 'write',
      target: `${roots.codex}/${skill.id}/${policyPath}`,
      content: codexPolicy(skill, existingPolicy),
      reason: `skill invocation policy: ${skill.id}`,
    })
  }
  return actions
}
