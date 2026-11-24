#!/usr/bin/env node
/**
 * scripts/lib/args-guard.mjs — 门禁脚本命令行参数 fail-closed 守卫（0.14.2 / QA C7.1–C7.4）
 *
 * 背景：0.14.1 及以前，门禁脚本对所有参数一律忽略 —— `node scripts/check-x.mjs --bogus-arg`
 * 照常跑完检查、打印 `X: PASS (n checks)` 并 exit 0：参数打错反而拿到假绿（fail-open）。
 *
 * 契约：guardArgs({ script, known, usage, description, examples, argHelp })
 *   （usage 与 description 同义：脚本说明；保留 usage 别名以对齐派单签名）
 *   1) `--help` / `-h`      -> 只把用法打印到 stdout，exit 0，**不执行任何检查**（C7.2）；
 *   2) 未知参数 / 取值畸形     -> stderr「未知参数: <x>」+ 用法 +「使用 --help 查看用法」，exit 3，
 *                               且不打印任何 PASS/FAIL 判定行（C7.1、C7.4）；
 *   3) 合法参数              -> 返回原始 argv（未销毁），脚本按原语义继续（`--json` / `--file <path>` 不变）。
 *   4) 取值是路径的存在性      -> known 里声明为路径取值（占位符 `<path>/<file>/<dir>`）时，解析阶段就
 *                               `existsSync` 校验；指向不存在的文件 -> exit 3（C7.4 的隐蔽假绿：
 *                               0.14.1 的 `--file web/nope.html` 会静默回落默认 web/board.html 并打印 PASS）。
 *                               存在性只在这一处实现，脚本不得各自再写一份。
 *   5) guardArgs 入参自校验     -> 调用方（各门禁脚本）的声明本身也必须可校验，否则「脚本都调 guard、guard 自己不校验」
 *                               会开出一个新的假绿入口：script 必须是非空字符串，known 每个条目必须匹配
 *                               `/^(\S+)(\s+<[^>]+>)?$/`（`--flag` 或 `--flag <value>`）。不合法 -> 抛 TypeError
 *                               （编程契约错误，进程以非 0 退出），不做「猜默认值」的兜底。
 *
 * 退出码约定：0 通过 / 1 判据失败 / 2 读取被检文件失败（保留旧语义，专指「默认被检文件读不到」） /
 *             3 参数错误（本文件新增；含未知参数、缺值、`--file`/`--package` 指向不存在文件）。
 *               `--flag=value` 形式按 QA v0.7 规则**解析**（不是一律拒）：取值存在则正常执行，
 *               不存在/缺值才 exit 3 —— 「拒 = 形式」会把合法文件误拒，属过度收紧。
 * 硬要求：解析必须发生在脚本读取任何被检文件之前，否则 --help 会顺带把检查跑完。
 */
import { existsSync } from 'node:fs'

const EXIT_USAGE = 3
/** known 条目合法形态：`--flag` 或 `--flag <value>`（占位符不允许含 `>`） */
const KNOWN_ENTRY_RE = /^(\S+)(\s+<[^>]+>)?$/

/**
 * guardArgs 自身的入参自校验（C17 子断言直接调它）：
 * 调用声明不合法时抛 TypeError —— 不允许把 undefined 兜底成 'script.mjs' 静默放行。
 */
function assertGuardOptions(options, { script, known }) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('guardArgs: 入参必须是选项对象（收到 ' + JSON.stringify(options) + '）')
  }
  if (typeof script !== 'string' || script.trim() === '') {
    throw new TypeError('guardArgs: script 必须是非空字符串（收到 ' + JSON.stringify(script) + '）')
  }
  if (!Array.isArray(known)) {
    throw new TypeError('guardArgs: known 必须是字符串数组（收到 ' + JSON.stringify(known) + '）')
  }
  for (const entry of known) {
    if (typeof entry !== 'string' || !KNOWN_ENTRY_RE.test(entry.trim())) {
      throw new TypeError('guardArgs: known 条目必须形如 "--flag" 或 "--flag <value>"（收到 ' + JSON.stringify(entry) + '）')
    }
  }
}

/** known 里 `--file <path>` 这类占位符声明的取值即「路径取值」：解析时按文件存在性 fail-closed */
export function isPathValue(placeholder) {
  if (typeof placeholder !== 'string') return false
  return /^<?(?:path|file|dir|directory)>?$/i.test(placeholder.trim())
}

/** 把 ['--json', '--file <path>'] 解析成 Map(flag -> { flag, value }) */
function parseKnown(known) {
  const items = new Map()
  for (const entry of known || []) {
    if (typeof entry !== 'string') continue
    const m = entry.trim().match(/^(\S+)(?:\s+(<[^>]+>))?$/)
    if (!m) continue
    items.set(m[1], { flag: m[1], value: m[2] || null })
  }
  return items
}

function renderUsage({ script, items, description, examples, argHelp }) {
  const opts = [...items.values()]
  const flags = opts.map((it) => '[' + it.flag + (it.value ? ' ' + it.value : '') + ']')
  const usageLine = '用法: node scripts/' + script + (flags.length ? ' ' + flags.join(' ') : '') + ' [-h|--help]'
  const lines = [usageLine, '', '脚本: ' + script]
  if (description) lines.push('说明: ' + description)
  lines.push('', '已知参数:')
  for (const it of opts) {
    const left = (it.value ? it.flag + ' ' + it.value : it.flag).padEnd(18)
    lines.push('  ' + left + (argHelp[it.flag] || (it.value ? '指定取值' : '布尔开关')))
  }
  lines.push('  ' + '-h, --help'.padEnd(18) + '打印本用法并退出（不执行任何检查）')
  lines.push('', '示例:')
  for (const e of examples.length ? examples : ['node scripts/' + script]) lines.push('  ' + e)
  lines.push('', '退出码: 0 通过 / 1 判据失败 / 2 读取被检文件失败 / 3 参数错误')
  return lines.join('\n')
}

/**
 * @param {{ script: string, known?: string[], usage?: string, description?: string, examples?: string[], argHelp?: Record<string,string> }} options
 * @returns {string[]} 原始 argv（process.argv.slice(2)），合法时脚本继续使用
 * @throws {TypeError} script/known 声明不合法（入参自校验，见文件头第 5 条）
 */
export function guardArgs(options = {}) {
  const { script, known = [], usage = '', description = '', examples = [], argHelp = {} } = options
  assertGuardOptions(options, { script, known })
  const scriptName = script.trim()
  const items = parseKnown(known)
  // usage 与 description 同义（派单签名用 usage，脚本内用 description）：description 优先
  const usageBlock = renderUsage({ script: scriptName, items, description: description || usage, examples, argHelp })
  const argv = process.argv.slice(2)

  const showHelp = () => {
    process.stdout.write(usageBlock + '\n')
    process.exit(0)
  }
  const reject = (message) => {
    process.stderr.write(message + '\n\n' + usageBlock + '\n\n使用 --help 查看用法\n')
    process.exit(EXIT_USAGE)
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') showHelp()
    const item = items.get(token)
    if (item) {
      if (item.value === null) continue
      const next = argv[i + 1]
      if (next === undefined) reject('未知参数: ' + token + '（缺少取值 ' + item.value + '）')
      if (next.startsWith('-')) reject('未知参数: ' + token + '（取值疑似参数 ' + next + '，缺少取值 ' + item.value + '）')
      i += 1
      // 路径取值必须存在：否则脚本会拿一个不存在的路径去「读默认文件」并被误读为通过
      if (isPathValue(item.value) && !existsSync(next)) {
        reject(token + ' 指定的文件不存在: ' + next + '（拒绝回落默认被检文件）')
      }
      continue
    }
    // `--flag=value` 形式必须**解析**（QA v0.7 统一规则）：0.14.1 会整段忽略并静默回落默认文件 = 假绿；
    // 但「一律拒 = 形式」会把合法文件误拒（--file=web/board.html 应 rc=0）。
    // 规则：已知取值 flag 的 = 形式按取值处理，并同样做路径存在性校验；
    //       布尔 flag 带 = 或未知 flag 带 = 仍属参数错误（exit 3）。
    const eq = token.match(/^(--[\w.-]+)=(.*)$/)
    if (eq) {
      const eqItem = items.get(eq[1])
      if (!eqItem || eqItem.value === null) reject('未知参数: ' + token)
      const eqValue = eq[2]
      if (eqValue === '') reject('未知参数: ' + token + '（缺少取值 ' + eqItem.value + '）')
      if (isPathValue(eqItem.value) && !existsSync(eqValue)) {
        reject(eq[1] + ' 指定的文件不存在: ' + eqValue + '（拒绝回落默认被检文件）')
      }
      continue
    }
    if (token.startsWith('-')) reject('未知参数: ' + token)
    reject('未知参数: ' + token + '（不接受位置参数，请用 --file <path>）')
  }
  return argv
}

export { EXIT_USAGE }
