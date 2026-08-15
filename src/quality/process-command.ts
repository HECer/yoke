export type QualityCommand = {
  readonly command: string
  readonly args: readonly string[]
}

const SHELL_CONTROL_OPERATOR = /(?:[&;|<>`\r\n]|\$\()/u

export function hasShellControlOperator(command: string): boolean {
  return SHELL_CONTROL_OPERATOR.test(command)
}

export function parseQualityCommand(value: string): QualityCommand | null {
  if (hasShellControlOperator(value)) return null
  const args: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false
  let started = false

  const finish = (): void => {
    if (!started) return
    args.push(current)
    current = ''
    started = false
  }

  const trimmed = value.trim()
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? ''
    if (escaped) {
      current += character
      escaped = false
      started = true
      continue
    }
    const next = trimmed[index + 1]
    if (character === '\\' && quote !== 'single' && (next === '\\' || next === '"' || next === "'" || (quote === null && next !== undefined && /\s/u.test(next)))) {
      escaped = true
      started = true
      continue
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      started = true
      continue
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      started = true
      continue
    }
    if (/\s/u.test(character) && quote === null) {
      finish()
      continue
    }
    current += character
    started = true
  }
  if (escaped || quote !== null) return null
  finish()
  const [command, ...commandArgs] = args
  return command ? { command, args: commandArgs } : null
}
