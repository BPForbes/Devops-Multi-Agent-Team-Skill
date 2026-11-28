import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addVisionNote, answerDeadlock, forwardDeadlock, openDeadlocks, raiseDeadlock, resolveDeadlock,
  stalledGoals,
} from './devops-vision.mjs'
import { renderDashboard } from './devops-dashboard.mjs'
import { batchItems, messagePolicy } from './devops-messages.mjs'

const BA = 'agent-0b0b0b'
const LEAD = 'agent-0c0c0c'
const TEAM = 'team-1a2b3c'
const GOAL = 'goal-3c9e41'
const SPRINT = 'sprint-000001'
const AT = '2026-11-27T10:00:00Z'
const LATER = '2026-11-27T11:00:00Z'
const NOTE = { text: 'Keep unicode', source: 'client', by: 'client', at: AT }
let n = 0
const mint = () => (++n).toString(16).padStart(6, '0')

/** A board with GOAL built by TEAM, with `standups` held standups after its last change. */
function boardWith({ standups = 0, returns = 0, vision } = {}) {
  const history = [{ at: AT, event: 'added' }]
  for (let i = 0; i < returns; i += 1) {
    history.push({ at: LATER, event: 'returned', from: SPRINT })
  }
  const meetings = {}
  for (let i = 0; i < standups; i += 1) {
    meetings[`meeting-00000${i}`] = {
      team: TEAM, kind: 'daily', state: 'held', held_at: `2026-11-28T0${i + 1}:00:00Z`,
    }
  }
  const team = { team: TEAM, lead: LEAD, goals: [GOAL], judged_goals: [] }
  return {
    goals: {
      [GOAL]: {
        title: 'Slugs', state: 'in_progress', history, ...(vision ? { vision: [vision] } : {}),
      },
    },
    allocations: { [SPRINT]: { teams: [team] } },
    meetings,
    assignments: {},
    sprints: { [SPRINT]: { name: 'S1', status: 'active', weeks: 2, goals: [GOAL] } },
  }
}

const raise = (board, extra = {}) => raiseDeadlock(board, {
  goal: GOAL, team: TEAM, lead: LEAD, reason: 'stuck', at: AT, mint, ...extra,
})

test('a vision note keeps the client\'s words with their source', () => {
  const note = { goal: GOAL, text: 'Slugs keep unicode', source: 'client', by: 'client', at: AT }
  const board = addVisionNote(boardWith(), note)
  assert.equal(board.goals[GOAL].vision[0].source, 'client')
  assert.equal(board.goals[GOAL].history.at(-1).event, 'vision')
  assert.throws(() => addVisionNote(board, { ...note, source: 'nobody' }), /vision source/)
  assert.throws(() => addVisionNote(board, { ...note, text: '  ' }), /needs its text/)
})

test('a goal stalls after two unchanged standups, or two send-backs; not before', () => {
  assert.deepEqual(stalledGoals(boardWith({ standups: 1 })), [])
  const stalled = stalledGoals(boardWith({ standups: 2 }))
  assert.deepEqual(stalled.map(s => s.reasons), [['unchanged across 2 standups']])
  const returned = stalledGoals(boardWith({ returns: 2 }))
  assert.deepEqual(returned.map(s => s.reasons), [['sent back 2 times']])
})

test('the lead raises; the BA gives the vision; feedback goes to the lead', () => {
  const vision = { text: 'Keep unicode', source: 'client', by: 'client', at: AT }
  let board = boardWith({ standups: 2, vision })
  const raised = raise(board, { reason: 'stuck on tests' })
  board = raised.board
  assert.equal(board.deadlocks[raised.id].vision_found, true)
  assert.throws(() => raise(board, { reason: 'again' }), /already has an open deadlock/)
  const notBa = { id: raised.id, ba: 'agent-0d0d0d', analyst: BA, vision: 'x', at: AT }
  assert.throws(() => resolveDeadlock(board, notBa), /only the Business Analyst/)
  const given = { id: raised.id, ba: BA, analyst: BA, vision: 'Unicode and ASCII', at: AT }
  board = resolveDeadlock(board, given)
  assert.equal(board.deadlocks[raised.id].state, 'feedback')
  assert.equal(board.goals[GOAL].vision.at(-1).source, 'ba')
  const forward = {
    id: raised.id, lead: LEAD, teamLead: LEAD, members: ['agent-0a0a0a'],
    meeting: 'meeting-000009', at: AT,
  }
  board = forwardDeadlock(board, forward)
  assert.equal(board.deadlocks[raised.id].state, 'forwarded')
  assert.deepEqual(board.deadlocks[raised.id].forwarded_to, ['agent-0a0a0a'])
  assert.deepEqual(openDeadlocks(board), [])
})

test('when the BA asks the client, the answer becomes the client\'s vision', () => {
  let board = raise(boardWith({ standups: 2 }), { reason: 'unclear' }).board
  const id = Object.keys(board.deadlocks)[0]
  const asked = { id, ba: BA, analyst: BA, question: 'Keep the old API?', at: AT }
  board = resolveDeadlock(board, asked)
  assert.equal(board.deadlocks[id].state, 'with_client')
  board = answerDeadlock(board, { id, answer: 'Yes, keep it', at: AT })
  assert.equal(board.goals[GOAL].vision.at(-1).source, 'client')
  assert.equal(board.deadlocks[id].state, 'feedback')
  const again = { id, answer: 'again', at: AT }
  const answered = () => answerDeadlock(board, again)
  assert.throws(answered, /is feedback, not with_client/)
})

test('batches split a long list into messages with their place', () => {
  const items = Array.from({ length: 45 }, (_, i) => i)
  assert.equal(batchItems(items, {}).length, 1)
  const batched = batchItems(items, { batching: 'batches', batchSize: 20 })
  const places = batched.map(b => b.batch)
  assert.deepEqual(places, [{ index: 0, of: 3 }, { index: 1, of: 3 }, { index: 2, of: 3 }])
  assert.equal(batched[2].items.length, 5)
  const small = batchItems(items.slice(0, 5), { batching: 'batches', batchSize: 20 })
  assert.equal(small[0].batch, undefined)
  assert.throws(() => messagePolicy({ batching: 'sometimes' }), /batching is one of/)
  assert.throws(() => messagePolicy({ batchSize: 0 }), /batchSize/)
})

test('the dashboard shows the vision and the files with hashes, deadlocks first', () => {
  let board = boardWith({ standups: 2, vision: NOTE })
  board.assignments['work-000001'] = {
    goal: GOAL, job: 'coder', agent: 'agent-0a0a0a', team: TEAM,
    state: 'assigned', description: 'Make slugs safe',
  }
  const hash = 'abcdef123456789'
  const ledger = { works: { 'work-000001': { files: [{ path: 'core/util.ts', hash }] } } }
  board = raise(board).board
  const text = renderDashboard({ board, ledger, project: 'demo' })
  assert.match(text, /# Dashboard: demo/)
  const deadlocks = text.indexOf('## Deadlocks and questions')
  assert.ok(deadlocks < text.indexOf('## Goals'), 'deadlocks come first')
  assert.match(text, /Keep unicode/)
  assert.match(text, /\| core\/util\.ts \| abcdef123456 \|/)
  const row = /\| deadlock-[0-9a-f]{6} \| goal-3c9e41 \|/
  assert.match(text, row)
})
