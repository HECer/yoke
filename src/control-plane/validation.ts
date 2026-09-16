/** Dependency-free boundary helpers for the experimental control-plane protocol. */
export class ControlPlaneError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ControlPlaneError' }
}
export function fail(code: string, message: string): never { throw new ControlPlaneError(code, message) }
export function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_input', `${name} must be an object`)
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) if (!keys.includes(key)) fail('invalid_input', `${name}: unknown field ${key}`)
  return result
}
export function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) fail('invalid_input', `${name} must be a non-empty, bounded string without control characters`)
  return value
}
export function identifier(value: unknown, name: string): string {
  const result = text(value, name, 128)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(result)) fail('invalid_input', `${name} is not a valid identifier`)
  return result
}
export function integer(value: unknown, name: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail('invalid_input', `${name} must be a safe integer >= ${min}`)
  return value
}
export function list(value: unknown, name: string, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('invalid_input', `${name} must be an array of at most ${max} entries`)
  return value
}
export function strings(value: unknown, name: string, max = 1000): string[] {
  const result = list(value, name, max).map(item => text(item, name))
  if (new Set(result).size !== result.length) fail('invalid_input', `${name} contains duplicates`)
  return result
}
export function oneOf<const T extends string>(value: unknown, choices: readonly T[], name: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail('invalid_input', `${name} must be one of ${choices.join(', ')}`)
  return value as T
}
export function digest(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('invalid_input', `${name} must be a lowercase SHA-256 digest`)
  return value
}
