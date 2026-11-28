import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runWord, wordInput } from './devops-orchestrate.mjs'
import { startLoop } from './devops-loop.mjs'

const GOAL = 'goal-3c9e41'
const AT = '2026-11-27T10:00:00Z'
const THOUGHTS = path.join('devops-skill', 'thoughts', 'non-final')

function projectWith(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-orch-')))
  for (const [rel, value] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(value))
  }
  return dir
}

const board = () => ({
  goals: { [GOAL]: { title: 'Slugs', state: 'in_progress', history: [] } },
  meetings: {}, assignments: {}, sprints: {}, allocations: {},
})
const readJsonFile = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'))

test('a client vision word notes the client\'s words and rewrites the dashboard', () => {
  const dir = projectWith({ [path.join(THOUGHTS, 'board.json')]: board() })
  runWord(dir, 'vision', { goal: GOAL, text: 'Slugs keep unicode' })
  const saved = readJsonFile(dir, path.join(THOUGHTS, 'board.json'))
  assert.equal(saved.goals[GOAL].vision[0].source, 'client')
  assert.ok(fs.existsSync(path.join(dir, THOUGHTS, 'DASHBOARD.md')))
})

test('the loop\'s sign-off words: satisfied ends it, continue keeps it going', () => {
  const dir = projectWith({ '.devops/loop.json': startLoop({ ba: 'agent-0b0b0b', at: AT }) })
  runWord(dir, 'continue', { note: 'keep going' })
  assert.equal(readJsonFile(dir, '.devops/loop.json').state, 'running')
  runWord(dir, 'satisfied', { note: 'ship it' })
  assert.equal(readJsonFile(dir, '.devops/loop.json').state, 'satisfied')
})

test('messages shows the setting, and sets batches with a size', () => {
  const dir = projectWith()
  const show = () => runWord(dir, 'messages', { action: 'show' })
  assert.deepEqual(show(), { batching: 'default', batchSize: 20 })
  runWord(dir, 'messages', { action: 'batches', size: 5 })
  assert.deepEqual(show(), { batching: 'batches', batchSize: 5 })
  assert.throws(() => runWord(dir, 'messages', { action: 'batches', size: 0 }), /batchSize/)
})

test('the typed words map onto each word\'s input', () => {
  const vision = wordInput('vision', ['goal-3c9e41', 'keep', 'it'])
  assert.deepEqual(vision, { goal: 'goal-3c9e41', text: 'keep it' })
  assert.deepEqual(wordInput('continue', ['ok', '--more', '3']), { note: 'ok', more: 3 })
  assert.deepEqual(wordInput('resolve', ['deadlock-000001', '--question', 'Keep', 'API?']),
    { id: 'deadlock-000001', question: 'Keep API?' })
  assert.deepEqual(wordInput('messages', ['batches', '7']), { action: 'batches', size: 7 })
})

test('an unknown word is refused', () => {
  const dir = projectWith()
  assert.throws(() => runWord(dir, 'nosuch', {}), /unknown \/devops word/)
})
