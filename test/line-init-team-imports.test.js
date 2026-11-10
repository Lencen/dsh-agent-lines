import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
test('index.js imports initTeamWorkspace/basename/join (line_init_team runtime guard)', () => {
  const s = read('lib/index.js')
  assert.match(s, /import \{[^}]*initTeamWorkspace[^}]*\} from '.\/team-init.js'/)
  assert.match(s, /import \{[^}]*basename[^}]*join[^}]*\} from 'node:path'/)
})
test('line_status exposes teamWorkspace/teamGoal/decisions', () => {
  const s = read('lib/tools.js')
  for (const key of ['teamWorkspace:', 'teamGoal', 'decisions']) assert.ok(s.includes(key), key)
})
test('board html has no UIUX static title', () => {
  const s = read('web/board.html')
  assert.ok(!s.includes('UIUX 稿（静态示例）'))
})
