type Json = unknown

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Deep-merge two parsed JSON values. Objects merge by key (recursing on shared
// keys). Arrays concatenate with structural de-duplication. For any other type
// mismatch or primitive collision, the incoming value wins.
export function mergeJson(base: Json, incoming: Json): Json {
  if (isPlainObject(base) && isPlainObject(incoming)) {
    const out: Record<string, Json> = { ...base }
    for (const [key, value] of Object.entries(incoming)) {
      out[key] = key in base ? mergeJson(base[key], value) : value
    }
    return out
  }
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const out = [...base]
    for (const item of incoming) {
      if (!out.some(existing => JSON.stringify(existing) === JSON.stringify(item))) {
        out.push(item)
      }
    }
    return out
  }
  return incoming
}
