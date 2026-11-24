import assert from 'node:assert/strict'
import test from 'node:test'

import {
  planCommitments, planningSummary, retroActionItems, reviewSprint, startSprint,
} from './devops-sprint.mjs'
import { initialTicks } from './devops-ticks.mjs'

const seats = [
  { agent: 'agent-a', jobs: ['coder'], capacity_points: 5 },
  { agent: 'agent-b', jobs: ['coder'], capacity_points: 3 },
]

test('commitments stay within each seat capacity and refuse the rest', () => {
  const items = [
    { id: 'item-1', owner: 'agent-a', points: 3 },
    { id: 'item-2', owner: 'agent-a', points: 3 },
    { id: 'item-3', owner: 'agent-b', points: 3 },
    { id: 'item-4', owner: 'agent-z', points: 1 },
  ]
  const plan = planCommitments({ items, seats })
  assert.deepEqual(plan.committed, ['item-1', 'item-3'])
  assert.equal(plan.refused.length, 2)
  assert.match(plan.refused[0].reason, /over capacity/)
  assert.match(plan.refused[1].reason, /not a seat/)
  assert.deepEqual(plan.load, { 'agent-a': 3, 'agent-b': 3 })
})

test('a sprint opens with its commitments and a second open sprint is refused', () => {
  const plan = planCommitments({ items: [], seats })
  const started = startSprint({ state: initialTicks(0), sprintId: 'sprint-1', plan })
  assert.equal(started.state.sprint_status, 'open')
  assert.throws(() => startSprint({ state: started.state, sprintId: 'sprint-2', plan }))
})

test('the planning summary records each commitment and each refusal', () => {
  const plan = planCommitments({
    items: [{ id: 'item-1', owner: 'agent-a', points: 9 }],
    seats,
  })
  const summary = planningSummary({ sprintId: 'sprint-1', plan, nextMeetingTick: 5 })
  assert.equal(summary.decisions[0], 'sprint sprint-1: 0 items committed')
  assert.equal(summary.decisions.length, 2)
})

test('the review splits committed work into finished and slipped, per seat', () => {
  const items = [
    { id: 'item-1', state: 'done' },
    { id: 'item-2', state: 'in_progress' },
    { id: 'item-3', state: 'done' },
  ]
  const owners = { 'item-1': 'agent-a', 'item-2': 'agent-a', 'item-3': 'agent-b' }
  const review = reviewSprint({
    committed: ['item-1', 'item-2', 'item-3'], items, owners,
  })
  assert.deepEqual(review.finished, ['item-1', 'item-3'])
  assert.deepEqual(review.slipped, ['item-2'])
  assert.deepEqual(review.perSeat['agent-a'], { committed: 2, done: 1 })
})

test('a retro item gets a routable job and a valid id, minted when the action has none', () => {
  const result = retroActionItems({
    actions: [{ text: 'add lint to CI', owner: 'agent-a' }],
    goal: 'goal-7f0a12',
    seats,
  })
  assert.equal(result.items.length, 1)
  assert.match(result.items[0].id, /^item-[0-9a-f]{6}$/)
  assert.equal(result.items[0].job, 'coder')
})

test('a retro action whose owner has no job is refused', () => {
  const noJob = [{ agent: 'agent-c', jobs: [], capacity_points: 3 }]
  const result = retroActionItems({
    actions: [{ text: 'x', owner: 'agent-c' }], goal: 'goal-7f0a12', seats: noJob,
  })
  assert.equal(result.items.length, 0)
  assert.match(result.refused[0].reason, /no job/)
})

test('a retro action without an owner is refused, an owned one is queued', () => {
  const actions = [
    { id: 'item-a1', text: 'add lint to CI', owner: 'agent-a' },
    { id: 'item-a2', text: 'write a runbook', owner: '' },
    { id: 'item-a3', text: '  ', owner: 'agent-b' },
  ]
  const result = retroActionItems({ actions, goal: 'goal-7f0a12', seats })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].state, 'queued')
  assert.equal(result.items[0].owner, 'agent-a')
  assert.equal(result.refused.length, 2)
})
