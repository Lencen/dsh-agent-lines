#!/usr/bin/env node
/**
 * Fail closed when the unit-test directory is not present.
 *
 * The npm package intentionally does not ship test/ (it is maintainer-only),
 * so npm test inside an installed package used to run 0 tests and exit 0.
 * This guard makes that case an explicit failure instead of a fake green.
 */
import { existsSync, readdirSync } from 'node:fs'

const dir = 'test'
const files = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.test.js')) : []
if (files.length === 0) {
  console.error('[agent-lines] no unit tests found: the npm package does not ship test/; run npm test from the source repository')
  process.exit(1)
}
console.log('[agent-lines] unit test set: ' + files.length + ' file(s)')
