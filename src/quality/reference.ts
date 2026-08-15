import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { StoryQualityDeclaration } from './types.js'
import { hasShellControlOperator as containsShellControlOperator, parseQualityCommand } from './process-command.js'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3

export type ReferenceHttpResponse = {
  readonly status: number
  readonly body: ReferenceContentResponse
  readonly location?: string
}

export type ReferenceParameters = Readonly<Record<string, string | number | boolean>>

export type ReferenceContent = {
  readonly bytes: Uint8Array
  readonly contentType?: string
  readonly parameters?: ReferenceParameters
}

export type ReferenceContentResponse = Uint8Array | ReferenceContent

export type ReferenceAcquisitionAdapters = {
  readonly version?: string
  readonly readFile: (path: string) => ReferenceContentResponse | null
  readonly requestUrl: (url: string, approvedAddresses: readonly string[]) => ReferenceHttpResponse
  readonly resolveHostname: (hostname: string) => readonly string[]
  readonly runCommand: (command: string) => ReferenceContentResponse
  readonly mkdir: (path: string) => void
  readonly writeFile: (path: string, bytes: Uint8Array) => void
  readonly realpath?: (path: string) => string | null
}

export type ReferenceProvenance = {
  readonly kind: StoryQualityDeclaration['reference']['kind']
  readonly source: string
  readonly acquiredAt: string
  readonly contentType?: string
  readonly byteSize: number
  readonly sha256: string
  readonly adapterVersion: string
  readonly parameters?: ReferenceParameters
}

export type ReferenceArtifact = {
  readonly name: string
  readonly digest: string
  readonly bytes: number
  readonly storagePath: string
  readonly provenance: ReferenceProvenance
}

export type ReferenceRejectionReason =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'private-address'
  | 'unresolved-address'
  | 'redirect-overflow'
  | 'invalid-redirect'
  | 'http-status'
  | 'unsupported-content-type'
  | 'path-traversal'
  | 'outside-project'
  | 'missing'
  | 'oversize'
  | 'shell-control'
  | 'invalid-command'
  | 'digest-mismatch'

export type ReferenceAcquisitionResult =
  | { readonly kind: 'acquired'; readonly artifact: ReferenceArtifact }
  | { readonly kind: 'rejected'; readonly reason: ReferenceRejectionReason }

type ReferenceInput = {
  readonly projectDir: string
  readonly reference: StoryQualityDeclaration['reference']
  readonly allowLocal?: boolean
  readonly maxBytes?: number
  readonly maxRedirects?: number
  readonly now?: () => string
}

type BytesResult =
  | { readonly kind: 'bytes'; readonly content: ReferenceContent }
  | { readonly kind: 'rejected'; readonly reason: ReferenceRejectionReason }

export function hasShellControlOperator(command: string): boolean {
  return containsShellControlOperator(command)
}

export function acquireReference(
  input: ReferenceInput,
  adapters: ReferenceAcquisitionAdapters,
): ReferenceAcquisitionResult {
  const bytesResult = acquireBytes(input, adapters)
  if (bytesResult.kind === 'rejected') return bytesResult

  if (bytesResult.content.bytes.byteLength > (input.maxBytes ?? DEFAULT_MAX_BYTES)) {
    return { kind: 'rejected', reason: 'oversize' }
  }

  const digest = createHash('sha256').update(bytesResult.content.bytes).digest('hex')
  if (input.reference.digest && normalizeDigest(input.reference.digest) !== digest) {
    return { kind: 'rejected', reason: 'digest-mismatch' }
  }
  const referencesDir = join(resolve(input.projectDir), '.yoke', 'references')
  const storagePath = join(referencesDir, digest)
  const provenance: ReferenceProvenance = {
    kind: input.reference.kind,
    source: input.reference.source,
    acquiredAt: (input.now ?? (() => new Date().toISOString()))(),
    ...(bytesResult.content.contentType ? { contentType: bytesResult.content.contentType } : {}),
    byteSize: bytesResult.content.bytes.byteLength,
    sha256: digest,
    adapterVersion: adapters.version ?? 'unknown',
    ...(bytesResult.content.parameters ? { parameters: bytesResult.content.parameters } : {}),
  }
  adapters.mkdir(storagePath)
  adapters.writeFile(join(storagePath, 'content'), bytesResult.content.bytes)
  adapters.writeFile(join(storagePath, 'provenance.json'), new TextEncoder().encode(JSON.stringify(provenance)))

  return {
    kind: 'acquired',
    artifact: {
      name: input.reference.name,
      digest,
      bytes: bytesResult.content.bytes.byteLength,
      storagePath,
      provenance,
    },
  }
}

function acquireBytes(input: ReferenceInput, adapters: ReferenceAcquisitionAdapters): BytesResult {
  if (input.reference.kind === 'file') return acquireFile(input, adapters)
  if (input.reference.kind === 'command') return acquireCommand(input, adapters)
  return acquireUrl(input, adapters)
}

function acquireFile(input: ReferenceInput, adapters: ReferenceAcquisitionAdapters): BytesResult {
  const source = input.reference.source
  if (containsTraversal(source)) return { kind: 'rejected', reason: 'path-traversal' }
  if (isAbsolute(source)) return { kind: 'rejected', reason: 'outside-project' }

  const projectRoot = resolve(input.projectDir)
  const path = resolve(projectRoot, source)
  if (!isInside(projectRoot, path)) return { kind: 'rejected', reason: 'outside-project' }
  const canonicalRoot = adapters.realpath?.(projectRoot) ?? projectRoot
  const canonicalPath = adapters.realpath?.(path) ?? path
  if (!isInside(canonicalRoot, canonicalPath)) return { kind: 'rejected', reason: 'outside-project' }
  const bytes = adapters.readFile(canonicalPath)
  return bytes === null ? { kind: 'rejected', reason: 'missing' } : { kind: 'bytes', content: normalizeContent(bytes) }
}

function acquireCommand(input: ReferenceInput, adapters: ReferenceAcquisitionAdapters): BytesResult {
  if (hasShellControlOperator(input.reference.source)) return { kind: 'rejected', reason: 'shell-control' }
  if (!parseQualityCommand(input.reference.source)) return { kind: 'rejected', reason: 'invalid-command' }
  return { kind: 'bytes', content: normalizeContent(adapters.runCommand(input.reference.source)) }
}

function acquireUrl(input: ReferenceInput, adapters: ReferenceAcquisitionAdapters): BytesResult {
  let current = input.reference.source
  let redirects = 0
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  for (;;) {
    if (!URL.canParse(current)) return { kind: 'rejected', reason: 'invalid-url' }
    const url = new URL(current)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'rejected', reason: 'unsupported-protocol' }
    }

    const addressResult = validateAddress(url.hostname, input.allowLocal === true, adapters)
    if (addressResult.kind === 'rejected') return addressResult

    const response = adapters.requestUrl(url.toString(), addressResult.addresses)
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || !URL.canParse(response.location, url.toString())) {
        return { kind: 'rejected', reason: 'invalid-redirect' }
      }
      if (redirects >= maxRedirects) return { kind: 'rejected', reason: 'redirect-overflow' }
      current = new URL(response.location, url).toString()
      redirects += 1
      continue
    }
    if (response.status < 200 || response.status >= 300) return { kind: 'rejected', reason: 'http-status' }
    let content = normalizeContent(response.body)
    if (mediaType(content.contentType) === 'text/html') content = htmlAsInertText(content)
    if (content.contentType && !isAllowedUrlContentType(content.contentType)) {
      return { kind: 'rejected', reason: 'unsupported-content-type' }
    }
    return { kind: 'bytes', content }
  }
}

function validateAddress(
  hostname: string,
  allowLocal: boolean,
  adapters: ReferenceAcquisitionAdapters,
): Extract<BytesResult, { kind: 'rejected' }> | { readonly kind: 'validated'; readonly addresses: readonly string[] } {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, '')
  if (!allowLocal && isPrivateAddress(normalizedHostname)) {
    return { kind: 'rejected', reason: 'private-address' }
  }

  const addresses = adapters.resolveHostname(normalizedHostname)
  if (addresses.length === 0) return { kind: 'rejected', reason: 'unresolved-address' }
  if (!allowLocal && addresses.some(isPrivateAddress)) {
    return { kind: 'rejected', reason: 'private-address' }
  }
  return { kind: 'validated', addresses }
}

function isAllowedUrlContentType(value: string): boolean {
  const type = mediaType(value)
  return type?.startsWith('image/') === true
    || type === 'text/plain'
    || type === 'application/json'
    || type === 'application/pdf'
    || type === 'application/octet-stream'
}

function mediaType(value?: string): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase()
}

function htmlAsInertText(content: ReferenceContent): ReferenceContent {
  const html = new TextDecoder().decode(content.bytes)
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
  return { bytes: new TextEncoder().encode(text), contentType: 'text/plain', ...(content.parameters ? { parameters: content.parameters } : {}) }
}

function containsTraversal(path: string): boolean {
  return path.split(/[\\/]+/).includes('..')
}

function normalizeContent(content: ReferenceContentResponse): ReferenceContent {
  return content instanceof Uint8Array ? { bytes: content } : content
}

function normalizeDigest(value: string): string {
  return value.replace(/^sha256:/i, '').toLowerCase()
}

function isInside(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
}

function isPrivateAddress(value: string): boolean {
  const address = value.toLowerCase()
  if (address === 'localhost' || address.endsWith('.localhost') || address === '::1' || address === '::') return true
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true
  if (address.startsWith('::ffff:')) return isPrivateAddress(address.slice('::ffff:'.length))

  const octets = address.split('.')
  if (octets.length !== 4 || octets.some(octet => !/^\d+$/.test(octet))) return false
  const numbers = octets.map(Number)
  if (numbers.some(number => number < 0 || number > 255)) return false
  const [first, second] = numbers
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}
