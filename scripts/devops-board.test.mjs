import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ackHandoff,
  addGoal,
  closeHandoff,
  createSprint,
  emptyBoard,
  inboxFor,
  moveGoal,
  routeHandoff,
  sendHandoff,
  sprintView,
} from './devops-board.mjs'
import { makeHandoff } from './devops-handoff.mjs'

const AT = '2026-11-23T10:00:00Z'
const GOAL = 'goal-3c9e41'
const QA = 'agent-0c0c0c'
const CODER = 'agent-0a0a0a'
const T_CODER = 'team-1a2b3c'
const T_QA = 'team-4d5e6f'

function triagePayload(overrides = {}) {
  return makeHandoff('triage', {
    item: 'item-3c9e41',
    goal: GOAL,
    signedBy: QA,
    fromAgent: QA,
    fromTeam: T_QA,
    toAgent: '',
    toTeam: T_CODER,
    reason: 'The lint gate still fails',
    created: AT,
    ...overrides,
  })
}

function withGoal() {
  const sprint = createSprint(emptyBoard(), { name: 'Sprint 1', at: AT, mint: () => '111111' })
  const board = addGoal(sprint.board, { goal: GOAL, title: 'Lint gate', sprint: sprint.id, at: AT })
  return { sprint: sprint.id, board }
}

test('a sprint opens active with no goals, and needs a name', () => {
  const { id, board } = createSprint(emptyBoard(), {
    name: ' Sprint 1 ', at: AT, mint: () => 'aaaaaa',
  })
  assert.equal(id, 'sprint-aaaaaa')
  assert.equal(board.sprints[id].name, 'Sprint 1')
  assert.equal(board.sprints[id].status, 'active')
  assert.throws(() => createSprint(emptyBoard(), { name: ' ', at: AT }), /needs a name/)
})

test('a goal goes into a sprint and can move to another one', () => {
  const { sprint, board } = withGoal()
  assert.deepEqual(sprintView(board, sprint), [
    { goal: GOAL, title: 'Lint gate', state: 'backlog' },
  ])
  const second = createSprint(board, { name: 'Sprint 2', at: AT, mint: () => 'bbbbbb' })
  const moved = addGoal(second.board, { goal: GOAL, sprint: second.id, at: AT })
  assert.deepEqual(moved.sprints[sprint].goals, [])
  assert.deepEqual(moved.sprints[second.id].goals, [GOAL])
  assert.equal(moved.goals[GOAL].history.at(-1).event, 'moved')
})

test('a goal must be a goal hash and its sprint must exist', () => {
  assert.throws(() => addGoal(emptyBoard(), { goal: 'item-3c9e41', at: AT }), /not a goal hash/)
  const unknown = () => addGoal(emptyBoard(), { goal: GOAL, sprint: 'sprint-000000', at: AT })
  assert.throws(unknown, /unknown sprint/)
})

test('a goal moves one step at a time, may block, and resumes', () => {
  const { board } = withGoal()
  const ready = moveGoal(board, { goal: GOAL, state: 'ready', at: AT })
  assert.equal(ready.goals[GOAL].state, 'ready')
  assert.throws(() => moveGoal(ready, { goal: GOAL, state: 'qa', at: AT }), /one step at a time/)
  const blocked = moveGoal(ready, { goal: GOAL, state: 'blocked', at: AT })
  const back = moveGoal(blocked, { goal: GOAL, state: 'in_progress', at: AT })
  assert.equal(back.goals[GOAL].state, 'in_progress')
  assert.equal(board.goals[GOAL].state, 'backlog', 'the input board is not changed')
})

test('a handoff is accepted only from the seat that signed it', () => {
  const { board } = withGoal()
  const payload = triagePayload()
  const wrong = () => sendHandoff(board, { payload, caller: CODER, at: AT })
  assert.throws(wrong, /only the sending seat/)
  const sent = sendHandoff(board, { payload, caller: QA, at: AT, mint: () => 'cccccc' })
  assert.equal(sent.id, 'handoff-cccccc')
  assert.equal(sent.board.handoffs[sent.id].state, 'unrouted')
})

test('a handoff must name a goal on the board and pass the validator', () => {
  const { board } = withGoal()
  const missing = triagePayload({ goal: 'goal-999999' })
  const absent = () => sendHandoff(board, { payload: missing, caller: QA, at: AT })
  assert.throws(absent, /not on the board/)
  const bad = triagePayload({ reason: '' })
  assert.throws(() => sendHandoff(board, { payload: bad, caller: QA, at: AT }), /handoff refused/)
})

test('an unrouted handoff is routed to a seat, then appears in its inbox', () => {
  const { board } = withGoal()
  const sent = sendHandoff(board, {
    payload: triagePayload(), caller: QA, at: AT, mint: () => 'eeeeee',
  })
  assert.deepEqual(inboxFor(sent.board, CODER), [])
  const routed = routeHandoff(sent.board, { id: sent.id, agent: CODER, at: AT })
  assert.equal(routed.handoffs[sent.id].state, 'sent')
  assert.equal(routed.handoffs[sent.id].payload.to.agent, CODER)
  assert.equal(inboxFor(routed, CODER)[0].id, sent.id)
  assert.throws(() => routeHandoff(routed, { id: sent.id, agent: QA, at: AT }), /already routed/)
})

test('only the addressee acknowledges, then closes, a handoff, in that order', () => {
  const { board } = withGoal()
  const sent = sendHandoff(board, {
    payload: triagePayload(), caller: QA, at: AT, mint: () => 'eeeeee',
  })
  const routed = routeHandoff(sent.board, { id: sent.id, agent: CODER, at: AT })
  assert.throws(() => ackHandoff(routed, { id: sent.id, agent: QA, at: AT }), /only the addressee/)
  const early = () => closeHandoff(routed, { id: sent.id, agent: CODER, at: AT })
  assert.throws(early, /acknowledged before/)
  const acked = ackHandoff(routed, { id: sent.id, agent: CODER, at: AT })
  assert.equal(acked.handoffs[sent.id].state, 'acked')
  const done = closeHandoff(acked, { id: sent.id, agent: CODER, at: AT })
  assert.equal(done.handoffs[sent.id].state, 'done')
  assert.deepEqual(inboxFor(done, CODER), [], 'a done handoff leaves the inbox')
})
