/**
 * conformance.test.js — 0.4 协议一致性用例 runner
 *
 * 读取 conformance/cases/*.json，按用例的 check 类型逐条断言：
 *   schema          -> 用下面 ~70 行最小校验器按 schema/<name>.json 校验 input
 *   address         -> lib/protocol.js validateAgentId / validateLineLabel
 *   protocolVersion -> lib/protocol.js assertProtocolCompatible / parseProtocolVersion
 *
 * 最小校验器只支持本仓库 schema 用到（另加文件内 $ref）的子集：
 *   type（含 type 数组）/ required / properties / additionalProperties /
 *   pattern / enum / minimum / items / $ref（仅本文件内 #/... JSON Pointer）。
 * 不是通用 JSON Schema 实现；注释性关键字（description/default/$id…）一律忽略。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROTOCOL_VERSION,
  assertProtocolCompatible,
  isProtocolCompatible,
  parseProtocolVersion,
  validateAgentId,
  validateLineLabel,
  LineError,
} from '../lib/protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_DIR = join(ROOT, 'schema')
const CASES_DIR = join(ROOT, 'conformance', 'cases')
const CHECKS = new Set(['schema', 'address', 'protocolVersion'])
const SCHEMA_CODES = new Set(['SCHEMA_INVALID'])

// ---------- 最小 JSON Schema 校验器（无依赖） ----------

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
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error('只支持本文件内 $ref: ' + ref)
  return ref.slice(2).split('/').reduce((node, key) => {
    const next = node === null || node === undefined ? undefined : node[key]
    if (next === undefined) throw new Error('无法解析 $ref: ' + ref)
    return next
  }, root)
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validateNode(root, schema, value, path, errors) {
  if (schema === undefined || schema === true) return
  if (schema.$ref !== undefined) return validateNode(root, resolveRef(root, schema.$ref), value, path, errors)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => acceptsType(value, type))) {
      errors.push(path + ': 期望类型 ' + types.join('|') + '，实际 ' + typeOf(value))
      return
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((candidate) => sameJson(candidate, value))) {
    errors.push(path + ': 不在 enum ' + JSON.stringify(schema.enum))
  }
  if (typeof value === 'string' && schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
    errors.push(path + ': 不匹配 pattern ' + schema.pattern)
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(path + ': 小于 minimum ' + schema.minimum)
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => validateNode(root, schema.items, item, path + '[' + index + ']', errors))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {}
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(path + '.' + key + ': 缺少必填字段')
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateNode(root, sub, value[key], path + '.' + key, errors)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) errors.push(path + '.' + key + ': 不允许的额外字段')
    } else if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) validateNode(root, schema.additionalProperties, value[key], path + '.' + key, errors)
      }
    }
  }
}

function validateSchema(schema, value) {
  const errors = []
  validateNode(schema, schema, value, '$', errors)
  return errors
}

function collectRefs(node, refs = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs)
    return refs
  }
  if (node === null || typeof node !== 'object') return refs
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') refs.push(value)
    else collectRefs(value, refs)
  }
  return refs
}

// ---------- 加载 schema 与用例 ----------

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const schemas = Object.fromEntries(
  readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => [basename(file, '.json'), readJson(join(SCHEMA_DIR, file))]),
)

const caseFiles = readdirSync(CASES_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort()

const cases = []
for (const file of caseFiles) {
  const doc = readJson(join(CASES_DIR, file))
  const list = Array.isArray(doc) ? doc : doc?.cases
  assert.ok(Array.isArray(list), file + ': 用例文件必须是数组或 { cases: [...] }')
  for (const item of list) cases.push({ file, ...item })
}

const ADDRESS_FIELDS = [
  ['from.agentId', (input) => input.from.agentId, validateAgentId],
  ['from.line', (input) => input.from.line, validateLineLabel],
  ['to.agentId', (input) => input.to.agentId, validateAgentId],
  ['to.line', (input) => input.to.line, validateLineLabel],
]

function resolvedVersion(input) {
  // 存储侧以 protocol_version 列为准；wire 信封只有 protocolVersion。都没有 = 旧消息 -> ''（按 0.3 处理）。
  const raw = input.protocol_version ?? input.protocolVersion
  return raw === undefined ? '' : raw
}

function assertVersionExpectation(c, expect) {
  if (expect.protocolVersion === undefined) return
  const parsed = parseProtocolVersion(resolvedVersion(c.input))
  assert.equal(parsed.raw, expect.protocolVersion, c.name + ': 版本解析结果应为 ' + expect.protocolVersion)
  assert.equal(parsed.major + '.' + parsed.minor, expect.protocolVersion, c.name + ': 解析出的 major.minor 不匹配')
  if (expect.ok === true) assert.equal(isProtocolCompatible(parsed.raw), true, c.name + ': 解析出的版本必须与本实现兼容')
}

function runCase(c) {
  const expect = c.expect
  const check = c.check ?? 'schema'

  if (check === 'schema') {
    const schemaName = c.schema ?? 'envelope.v0_4'
    const schema = schemas[schemaName]
    assert.ok(schema, c.name + ': 未知 schema ' + schemaName)
    const errors = validateSchema(schema, c.input)
    if (expect.ok === true) {
      assert.deepEqual(errors, [], c.name + ': 期望通过但校验失败:\n  ' + errors.join('\n  '))
    } else {
      assert.ok(SCHEMA_CODES.has(expect.errorCode), c.name + ': check=schema 的 errorCode 只能是 SCHEMA_INVALID')
      assert.ok(errors.length > 0, c.name + ': 期望被拒但 schema 校验通过了')
    }
  } else if (check === 'address') {
    const codes = []
    for (const [field, read, validate] of ADDRESS_FIELDS) {
      try {
        validate(read(c.input))
      } catch (error) {
        assert.ok(error instanceof LineError, c.name + ': ' + field + ' 被拒时应抛 LineError')
        codes.push(error.code)
      }
    }
    if (expect.ok === true) assert.deepEqual(codes, [], c.name + ': 期望地址合法，实际被拒 ' + codes.join(','))
    else assert.ok(codes.includes(expect.errorCode), c.name + ': 期望 ' + expect.errorCode + '，实际 ' + JSON.stringify(codes))
  } else if (check === 'protocolVersion') {
    const raw = resolvedVersion(c.input)
    if (expect.ok === true) {
      assertProtocolCompatible(raw)
      assert.equal(isProtocolCompatible(raw), true, c.name + ': 同 major 必须兼容')
    } else {
      assert.equal(expect.errorCode, 'LINE_PROTOCOL_MISMATCH', c.name + ': 版本检查用例的 errorCode 只能是 LINE_PROTOCOL_MISMATCH')
      assert.throws(() => assertProtocolCompatible(raw), (error) => error instanceof LineError && error.code === 'LINE_PROTOCOL_MISMATCH', c.name + ': 期望 LINE_PROTOCOL_MISMATCH')
      assert.equal(isProtocolCompatible(raw), false, c.name + ': major 不同时 isProtocolCompatible 必须为 false')
    }
  } else {
    assert.fail(c.name + ': 未知 check ' + check)
  }

  assertVersionExpectation(c, expect)
}

// ---------- 元测试 ----------

test('conformance: 用例文件与目录结构合法', () => {
  assert.equal(PROTOCOL_VERSION, '0.4', '本实现协议版本为 0.4')
  assert.ok(caseFiles.length >= 6, '至少 6 个类别文件，实际 ' + caseFiles.length)
  assert.ok(cases.length >= 20, '用例总数应 >= 20，实际 ' + cases.length)
  const names = new Set()
  for (const c of cases) {
    const where = c.file + ' / ' + String(c.name)
    assert.equal(typeof c.name, 'string', where + ': name 必须是字符串')
    assert.ok(c.name.trim().length > 0, where + ': name 不能为空')
    assert.ok(!names.has(c.name), where + ': 用例名重复')
    names.add(c.name)
    assert.ok(c.input !== null && typeof c.input === 'object' && !Array.isArray(c.input), where + ': input 必须是对象')
    assert.ok(c.expect !== null && typeof c.expect === 'object', where + ': expect 必须是对象')
    assert.equal(typeof c.expect.ok, 'boolean', where + ': expect.ok 必须是布尔')
    if (c.expect.ok) assert.equal(c.expect.errorCode, undefined, where + ': ok:true 不应带 errorCode')
    else assert.equal(typeof c.expect.errorCode, 'string', where + ': ok:false 必须带 errorCode')
    const check = c.check ?? 'schema'
    assert.ok(CHECKS.has(check), where + ': 未知 check ' + check)
    if (check === 'schema') assert.ok(schemas[c.schema ?? 'envelope.v0_4'], where + ': 未知 schema ' + c.schema)
  }
  for (const prefix of ['a/', 'b/', 'c/', 'd/', 'e/', 'f/']) {
    assert.ok([...names].some((name) => name.startsWith(prefix)), '缺少 ' + prefix + ' 类用例')
  }
})

test('conformance: schema 文件自约束（0.4 约定）', () => {
  const envelope = schemas['envelope.v0_4']
  const message = schemas['message.v0_4']
  assert.ok(envelope && message, 'schema/envelope.v0_4.json 与 schema/message.v0_4.json 必须存在且为合法 JSON')
  assert.equal(envelope.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(envelope.additionalProperties, true, 'envelope 根必须 additionalProperties:true（minor 兼容）')
  assert.equal(message.additionalProperties, true, 'message 根必须 additionalProperties:true（新增列兼容）')

  // 必填字段严格，但 protocolVersion 必须可选：旧信封没有该字段。
  for (const key of ['id', 'idempotencyKey', 'from', 'to', 'body', 'createdAt']) {
    assert.ok(envelope.required.includes(key), 'envelope.required 缺少 ' + key)
  }
  assert.ok(!envelope.required.includes('protocolVersion'), 'protocolVersion 不能进 required（旧信封兼容）')
  assert.equal(envelope.properties.protocolVersion.pattern, '^\\d{1,3}\\.\\d{1,3}$')
  assert.equal(envelope.properties.protocolVersion.default, '0.3')

  // 地址正则与 lib/protocol.js 的 AGENT_RE / LINE_RE 一致（from/to/body 以 $ref 引用 $defs）。
  const fromDef = resolveRef(envelope, envelope.properties.from.$ref)
  const toDef = resolveRef(envelope, envelope.properties.to.$ref)
  const bodyDef = resolveRef(envelope, envelope.properties.body.$ref)
  const agentIdDef = resolveRef(envelope, fromDef.properties.agentId.$ref)
  const lineDef = resolveRef(envelope, fromDef.properties.line.$ref)
  assert.equal(agentIdDef.pattern, '^[a-z0-9][a-z0-9._-]{0,95}$')
  assert.equal(lineDef.pattern, '^[a-z0-9][a-z0-9._-]{0,63}$')
  assert.equal(toDef.properties.agentId.$ref, '#/$defs/agentId')
  assert.equal(toDef.properties.line.$ref, '#/$defs/line')
  assert.deepEqual(fromDef.required, ['agentId', 'line', 'sessionId'])
  assert.deepEqual(toDef.required, ['agentId', 'line'])
  assert.equal(envelope.properties.hop.type, 'integer')
  assert.equal(envelope.properties.hop.minimum, 0)
  assert.deepEqual(envelope.properties.kind.enum, ['info', 'request', 'task', 'alert'])
  assert.equal(envelope.properties.noReply.type, 'boolean')
  assert.equal(envelope.properties.ccManager.type, 'boolean')
  assert.deepEqual(bodyDef.required, ['text'])

  // 存储侧字段
  assert.deepEqual(message.properties.state.enum, ['queued', 'claimed', 'delivered', 'acked', 'failed', 'expired', 'pending_approval'])
  assert.equal(message.properties.attempts.type, 'integer')
  assert.equal(message.properties.attempts.minimum, 0)
  assert.equal(message.properties.protocol_version.default, '0.3')
  assert.equal(message.properties.protocol_version.type, 'string')
  for (const key of ['state', 'attempts']) assert.ok(message.required.includes(key), 'message.required 缺少 ' + key)
})

test('conformance: 所有 $ref 可解析，message schema 自包含', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    for (const ref of collectRefs(schema)) {
      assert.doesNotThrow(() => resolveRef(schema, ref), name + ': 无法解析 ' + ref)
    }
  }
  for (const ref of collectRefs(schemas['message.v0_4'])) {
    assert.ok(ref.startsWith('#/'), 'message.v0_4.json 必须自包含，不允许外部 $ref: ' + ref)
  }
})

// ---------- 逐用例执行 ----------

for (const c of cases) {
  test('conformance: ' + c.name, () => runCase(c))
}