/**
 * Minimal JSON Schema validator for the in-repo conformance/schema-live tests
 * (0.9.0 S2). Supports the subset used by schema/*.json: type (string or array),
 * required, properties, additionalProperties (boolean), pattern, enum, minimum,
 * items, and in-file $ref (#/... JSON Pointer). No external dependency.
 */

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function acceptsType(value, type) {
  const actual = typeOf(value)
  return type === actual || (type === 'number' && actual === 'integer')
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error('Only in-file $ref is supported: ' + ref)
  return ref.slice(2).split('/').reduce((node, key) => {
    const next = node === null || node === undefined ? undefined : node[key]
    if (next === undefined) throw new Error('Unresolvable $ref: ' + ref)
    return next
  }, root)
}

/** Validate value against schema; returns array of human-readable errors (empty = valid). */
export function validateSchema(schema, value, root = schema, path = '') {
  const errors = []
  if (schema === null || typeof schema !== 'object') return errors
  if (schema.$ref !== undefined) {
    return validateSchema(resolveRef(root, schema.$ref), value, root, path)
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(type => acceptsType(value, type))) {
      errors.push(path + ': expected ' + types.join('|') + ', got ' + typeOf(value))
      return errors
    }
  }
  if (schema.enum !== undefined) {
    const ok = schema.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))
    if (!ok) errors.push(path + ': not in enum ' + JSON.stringify(schema.enum))
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(path + ': ' + value + ' < minimum ' + schema.minimum)
  }
  if (typeof value === 'string' && schema.pattern !== undefined) {
    if (!new RegExp(schema.pattern).test(value)) errors.push(path + ': does not match ' + schema.pattern)
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validateSchema(schema.items, item, root, path + '[' + index + ']')))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(path + ': missing required ' + key)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validateSchema(sub, value[key], root, path + (path ? '.' : '') + key))
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}))
      for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(path + ': unexpected property ' + key)
    }
  }
  return errors
}
