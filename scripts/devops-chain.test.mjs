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

/** A board file under `root` holding `board`. */
function boardAt(root, board) {
  const file = path.join(root, BOARD_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(board))
}

test('waiting lists the merge reports a bare push-ok must name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'))
  boardAt(root, waiting([GOAL, OTHER]))
  assert.equal(run(['waiting', '--dest', root]), 'waiting: report-aaaaa0 report-aaaaa1')
  boardAt(root, emptyBoard())
  assert.equal(run(['waiting', '--dest', root]), 'No merge report waits for you.')
})

test('merged needs the pushed tree on the base, then deletes the side branches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git(['init', '-q', '-b', 'main'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'])
  const side = 'local/item-a1a1a1-agent-c0c0c0-1'
  git(['branch', side])
  const board = waiting()
  Object.assign(board.reports['report-aaaaa0'], {
    state: 'approved', pushed_at: AT, pushed_tree: 'b'.repeat(40), merge: { side: [side, '/x'] },
  })
  boardAt(root, board)
  const merged = () => run(['merged', '--base', 'main', 'report-aaaaa0', '--dest', root])
  assert.throws(merged, e => /the real PR is not merged/.test(e.stderr))
  board.reports['report-aaaaa0'].pushed_tree = git(['rev-parse', 'HEAD^{tree}'])
  boardAt(root, board)
  assert.equal(merged(), [
    'Merge recorded on report-aaaaa0', `deleted ${side}`,
    'left /x: not a local/ ref or a side worktree',
  ].join('\n'))
  assert.equal(git(['branch', '--list', side]), '')
})

test('the client answers a bug report: fine, a proposal, or its own alternative', () => {
  const board = waiting()
  board.reports['report-b00b00'] = {
    kind: 'bug', state: 'bug_to_person',
    envelope: { body: { proposals: ['guard in parse()', 'default object'] } },
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'))
  boardAt(root, board)
  const bug = (...args) => run(['bug', 'report-b00b00', ...args, '--dest', root])
  assert.throws(() => bug('maybe'), e => /fine or has it fixed/.test(e.stderr))
  assert.equal(bug('fix', '--proposal', '2'), 'Bug report report-b00b00: fix, default object')
  assert.throws(() => bug('fine'), e => /not a bug report waiting for the client/.test(e.stderr))
  const alt = decide(board, {
    command: 'bug', ids: ['report-b00b00'], words: ['fix'], extra: { alternative: 'Warn' }, at: AT,
  })
  assert.equal(alt.board.reports['report-b00b00'].fix, 'Warn')
  const load = structuredClone(board)
  load.assignments['work-aaaaaa'] = { state: 'held_for_client', held: { open: 3 } }
  load.reports['report-10ad00'] = { kind: 'load', work: 'work-aaaaaa', state: 'load_to_person' }
  const decided = decide(load, {
    command: 'load', ids: ['report-10ad00'], words: ['approve'], at: AT,
  })
  assert.equal(decided.text, 'Load report report-10ad00: held work approved')
  assert.equal(decided.board.assignments['work-aaaaaa'].state, 'assigned')
  const raise = who => decide(waiting(), { command: 'raise', goal: GOAL, reason: 'x', who, at: AT })
  assert.throws(() => raise({}), /types merge-ok, merge-deny, done or raise/)
  assert.throws(() => raise({ seat: 'agent-0a0a0a' }), /not waiting for the BA's first signature/)
})
