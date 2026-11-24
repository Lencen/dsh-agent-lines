#!/usr/bin/env node
/**
 * Fail closed when the unit-test directory is not present.
 *
 * The npm package intentionally does not ship test/ (it is maintainer-only),
 * so npm test inside an installed package used to run 0 tests and exit 0.
 * This guard makes that case an explicit failure instead of a fake green.
 *
 * 用法：node scripts/check-test-set.mjs [-h|--help]（本脚本无参数）
 * 退出码：0 通过 / 1 未找到单测文件 / 3 参数错误
 */
import { existsSync, readdirSync } from 'node:fs'
import { guardArgs } from './lib/args-guard.mjs'

// 参数 fail-closed 守卫必须早于任何读目录/检查（0.14.2 QA C7.1/C7.2）
guardArgs({
  script: 'check-test-set.mjs',
  known: [],
  description: '单元测试集守卫：test/ 不存在或没有 *.test.js 时 fail-closed（防发布包内 0 tests 假绿）',
  examples: ['node scripts/check-test-set.mjs'],
})

const dir = 'test'
const files = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.test.js')) : []
if (files.length === 0) {
  console.error('[agent-lines] no unit tests found: the npm package does not ship test/; run npm test from the source repository')
  process.exit(1)
}
console.log('[agent-lines] unit test set: ' + files.length + ' file(s)')
