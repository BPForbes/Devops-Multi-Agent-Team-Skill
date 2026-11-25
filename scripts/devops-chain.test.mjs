import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { BOARD_FILE, emptyBoard } from './devops-board.mjs'
import { decide } from './devops-chain.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'devops-chain.mjs')
const run = (args, env = {}) => execFileSync('node', [CLI, ...args], {
  encoding: 'utf8', env: { ...process.env, DEVOPS_SEAT: '', DEVOPS_TEAM: '', ...env },
}).trim()
const AT = '2026-11-25T10:00:00Z'
const GOAL = 'goal-111111'
const OTHER = 'goal-222222'

/** A board whose goals wait for the client, the BA having signed twice. */
function waiting(goals = [GOAL]) {
  const board = emptyBoard()
  goals.forEach((goal, i) => {
    board.goals[goal] = {
      state: 'done', sprint: 'sprint-aaaaaa', history: [],
      signoffs: ['peer', 'lead', 'ba', 'ba_final'].map(step => ({ step })),
    }
    board.reports[`report-aaaaa${i}`] = {
      goal, sprint: 'sprint-aaaaaa', team: 'team-a1a1a1', state: 'to_person',
    }
  })
  return board
}

test('without a board the CLI changes nothing; an unknown command prints the usage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'))
  assert.equal(run(['approve', 'report-aaaaa0', '--dest', root]), 'There is no board yet.')
  assert.equal(fs.existsSync(path.join(root, 'devops-skill')), false)
  const usage = e => e.status === 2 && /merge-ok\|merge-deny\|done/.test(e.stdout)
  assert.throws(() => run(['maybe']), usage)
})

test('the client approves named reports, dependencies first, and records who pushed', () => {
  const board = waiting([GOAL, OTHER])
  board.goals[GOAL].depends_on = [OTHER]
  const approve = ids => decide(board, { command: 'approve', ids, at: AT })
  assert.throws(() => approve(['report-aaaaa0']), /waits on goal-222222/)
  const both = approve(['report-aaaaa0', 'report-aaaaa1'])
  assert.equal(both.board.reports['report-aaaaa0'].state, 'approved')
  const pushed = decide(both.board, {
    command: 'pushed', ids: ['report-aaaaa0'], tree: 'a'.repeat(40), who: 'agent-0a0a0a', at: AT,
  })
  assert.equal(pushed.board.reports['report-aaaaa0'].pushed_by, 'agent-0a0a0a')
  assert.match(pushed.text, /Push recorded on report-aaaaa0 by agent-0a0a0a/)
})

test('the client denies named reports, or every waiting one, with a reason', () => {
  const deny = (ids, reason) => decide(waiting([GOAL, OTHER]), {
    command: 'deny', ids, reason, at: AT,
  })
  assert.throws(() => deny([], undefined), /merge-deny says why/)
  const one = deny(['report-aaaaa1'], 'Warn instead').board
  assert.deepEqual([one.reports['report-aaaaa0'].state, one.reports['report-aaaaa1'].state],
    ['to_person', 'denied'])
  const all = deny([], 'Not now').board
  assert.equal(all.reports['report-aaaaa0'].decision_reason, 'Not now')
})

test('a seat word needs a bound seat, and runs only that seat\'s own step', () => {
  const seat = (command, who) => decide(waiting(), { command, goal: GOAL, who, at: AT })
  assert.throws(() => seat('merge-ok', {}), /only a seat bound with DEVOPS_SEAT/)
  assert.throws(() => seat('merge-ok', { seat: 'agent-0a0a0a' }), /only the client signs/)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'))
  const file = path.join(root, BOARD_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(waiting()))
  assert.throws(() => run(['done', GOAL, '--dest', root]), /only a seat bound with DEVOPS_SEAT/)
})
