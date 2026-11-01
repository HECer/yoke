import type { ChildProcess } from 'node:child_process'
import { processIncarnation } from './process-incarnation.js'

type GroupChild = Pick<ChildProcess, 'exitCode' | 'signalCode'>
type Signal = (pid: number, signal: NodeJS.Signals | 0) => void

/** A successful signal is a request, not proof that an owned group has exited. */
export function ownedPosixGroupTerminator(
  pid: number,
  child: GroupChild,
  incarnation: string | undefined,
  identity: (pid: number) => string | undefined = processIncarnation,
  signal: Signal = (target, value) => { process.kill(target, value) },
): () => boolean {
  let absent = false
  const groupExited = (): boolean => {
    if (absent) return true
    try { signal(-pid, 0) }
    catch (error) { absent = (error as NodeJS.ErrnoException).code === 'ESRCH' }
    return absent
  }
  return () => {
    if (groupExited()) return true
    // The live child handle owns the detached group even when ps is unavailable.
    // After exit, do not signal a numeric group ID that could have been reused.
    // child.killed only means a signal was sent, so it is not an exit condition.
    if (child.exitCode !== null || child.signalCode !== null) return false
    if (incarnation !== undefined && identity(pid) !== incarnation) return false
    try { signal(-pid, 'SIGKILL') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false }
    return groupExited()
  }
}
