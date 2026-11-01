type Json = unknown

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isManagedMcp(name: string, value: Json): boolean {
  if (!isPlainObject(value)) return false
  const command = Array.isArray(value.command) ? value.command : [value.command, ...(Array.isArray(value.args) ? value.args : [])]
  if (name === 'graphify') return stableStringify(command) === stableStringify(['graphify', 'serve'])
  if (name === 'serena') return stableStringify(command) === stableStringify(['serena', 'start-mcp-server', '--open-web-dashboard', 'false'])
  if (name === 'code-intelligence') return command[0] === 'yoke' && command[1] === 'code-intelligence-server'
  if (name === 'playwright') {
    const args = command.slice(1).filter(arg => arg !== '-y' && arg !== '--yes')
    return command[0] === 'npx' && args.length === 1 && typeof args[0] === 'string' && /^@playwright\/mcp@[^\s]+$/u.test(args[0])
  }
  return false
}

/** Replace selected launch arguments atomically; remove only recognized Yoke
 * launch commands that are no longer selected, preserving unrelated servers. */
function mergeMcp(base: Record<string, Json>, incoming: Record<string, Json>): Record<string, Json> {
  const result: Record<string, Json> = Object.create(null)
  for (const [name, config] of Object.entries(base)) {
    if (Object.hasOwn(incoming, name) || !isManagedMcp(name, config)) result[name] = config
  }
  for (const [name, config] of Object.entries(incoming)) {
    result[name] = isPlainObject(result[name]) && isPlainObject(config)
      ? { ...result[name], ...config } : config
  }
  return result
}

// Order-independent serialization: object keys are sorted recursively so two
// structurally-equal values compare equal regardless of key order. Used to
// de-dupe array items (e.g. a hand-edited hook block with reordered keys must
// not duplicate our entry).
function stableStringify(v: Json): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (isPlainObject(v)) {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

// Deep-merge two parsed JSON values. Objects merge by key (recursing on shared
// keys). Arrays concatenate with structural de-duplication. For any other type
// mismatch or primitive collision, the incoming value wins.
export function mergeJson(base: Json, incoming: Json): Json {
  if (isPlainObject(base) && isPlainObject(incoming)) {
    // null prototype: incoming __proto__ becomes a plain own key, never pollutes.
    const out: Record<string, Json> = Object.assign(Object.create(null), base)
    for (const [key, value] of Object.entries(incoming)) {
      out[key] = (key === 'mcpServers' || key === 'mcp_servers' || key === 'mcp') && isPlainObject(base[key]) && isPlainObject(value)
        ? mergeMcp(base[key], value) : Object.hasOwn(base, key) ? mergeJson(base[key], value) : value
    }
    return out
  }
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const out = [...base]
    for (const item of incoming) {
      if (!out.some(existing => stableStringify(existing) === stableStringify(item))) {
        out.push(item)
      }
    }
    return out
  }
  return incoming
}
