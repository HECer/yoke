import { execFileSync } from 'node:child_process'

export interface CommitIdentityConfig {
  authorName?: string
  authorEmail?: string
  allowCoAuthors?: boolean
}

export interface CommitIdentity {
  authorName: string
  authorEmail: string
  allowCoAuthors: boolean
}

type GitConfigReader = (key: 'user.name' | 'user.email', targetDir: string) => string

const readGitConfig: GitConfigReader = (key, targetDir) => {
  try {
    return execFileSync('git', ['config', '--get', key], { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

export function resolveCommitIdentity(
  targetDir: string,
  config?: CommitIdentityConfig,
  gitConfig: GitConfigReader = readGitConfig,
): CommitIdentity {
  const authorName = config?.authorName?.trim() || gitConfig('user.name', targetDir).trim()
  const authorEmail = config?.authorEmail?.trim() || gitConfig('user.email', targetDir).trim()
  if (!authorName) throw new Error('Commit author name is missing. Set commit.authorName in .yoke/config.yaml or git config user.name.')
  if (!authorEmail) throw new Error('Commit author email is missing. Set commit.authorEmail in .yoke/config.yaml or git config user.email.')
  return { authorName, authorEmail, allowCoAuthors: config?.allowCoAuthors ?? false }
}

export function sanitizeCommitMessage(message: string, allowCoAuthors: boolean): string {
  if (allowCoAuthors) return message
  return message
    .split(/\r?\n/)
    .filter(line => !/^Co-Authored-By:/i.test(line.trim()))
    .join('\n')
    .trim()
}
