type Json = unknown

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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
      out[key] = key in base ? mergeJson(base[key], value) : value
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
