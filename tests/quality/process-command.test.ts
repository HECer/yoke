import { describe, expect, it } from 'vitest'
import { parseQualityCommand } from '../../src/quality/process-command.js'

describe('quality command parsing', () => {
  it('parses quoted arguments into an executable and argv without a shell', () => {
    expect(parseQualityCommand('node -e "process.stdout.write(\'quality output\')" --flag=value')).toEqual({
      command: 'node',
      args: ['-e', "process.stdout.write('quality output')", '--flag=value'],
    })
  })

  it('rejects shell operators and unterminated quotes', () => {
    expect(parseQualityCommand('node capture.js && remove-files')).toBeNull()
    expect(parseQualityCommand('node -e "unterminated')).toBeNull()
  })

  it('preserves Windows separators in quoted executables and path arguments', () => {
    expect(parseQualityCommand('"C:\\Program Files\\capture.exe" C:\\tmp\\out.png')).toEqual({
      command: 'C:\\Program Files\\capture.exe',
      args: ['C:\\tmp\\out.png'],
    })
  })
})
