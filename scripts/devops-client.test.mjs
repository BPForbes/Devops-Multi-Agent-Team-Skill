import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { emptyBoard } from './devops-board.mjs'
import { decide } from './devops-client.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'devops-client.mjs')
const run = (...args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8' }).trim()

test('with no merge report waiting, the client decides nothing and writes no board', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-'))
  assert.equal(run('approve', '--dest', root), 'No merge report waits for you.')
  assert.equal(fs.existsSync(path.join(root, 'devops-skill')), false)
  const at = '2026-11-25T10:00:00Z'
  assert.deepEqual(decide(emptyBoard(), { decision: 'approve', at }).approved, [])
  assert.deepEqual(decide(emptyBoard(), { decision: 'deny', reason: 'x', at }).denied, [])
})

test('the client CLI asks for approve or deny', () => {
  assert.throws(() => run('maybe'), e => e.status === 2 && /approve\|deny/.test(e.stdout))
})

/** A board whose one goal waits for the client, the BA having signed twice. */
function waiting() {
  const board = emptyBoard()
  board.goals['goal-111111'] = {
    state: 'done', sprint: 'sprint-aaaaaa', history: [],
    signoffs: ['peer', 'lead', 'ba', 'ba_final'].map(step => ({ step })),
  }
  board.reports['report-aaaaaa'] = {
    goal: 'goal-111111', sprint: 'sprint-aaaaaa', team: 'team-a1a1a1', state: 'to_person',
  }
  return board
}

test('the client approves or denies every merge report waiting for it', () => {
  const at = '2026-11-25T10:00:00Z'
  const approved = decide(waiting(), { decision: 'approve', at })
  assert.deepEqual(approved.approved, ['report-aaaaaa'])
  assert.equal(approved.board.goals['goal-111111'].signoffs.at(-1).step, 'client')
  assert.throws(() => decide(waiting(), { decision: 'deny', at }), /merge-deny says why/)
  const denied = decide(waiting(), { decision: 'deny', reason: 'Warn instead', at })
  assert.equal(denied.board.reports['report-aaaaaa'].state, 'denied')
  assert.equal(denied.board.reports['report-aaaaaa'].decision_reason, 'Warn instead')
})
