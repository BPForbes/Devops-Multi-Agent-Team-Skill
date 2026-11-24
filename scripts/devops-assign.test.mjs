import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assignPrimary, assignSecondary, pickSeat, releaseExpired, renewLease,
} from './devops-assign.mjs'

const seat = (agent, extra = {}) => ({
  agent, jobs: ['coder'], status: 'active', capacity_points: 12, ...extra,
})
const item = (id, extra = {}) => ({
  id, goal: 'goal-7f0a12', job: 'coder', state: 'queued', points: 3, ...extra,
})

test('the least-loaded seat with the job gets the item; ties go to the lower id', () => {
  const seats = [seat('agent-b'), seat('agent-a')]
  assert.equal(pickSeat(item('item-1'), seats, []).agent, 'agent-a')
  const busy = [{ item: 'item-0', seat: 'agent-a', points: 5, active: true, lease_id: 'l0' }]
  assert.equal(pickSeat(item('item-1'), seats, busy).agent, 'agent-b')
})

test('a seat is skipped when it is inactive, lacks the job, or is full', () => {
  const seats = [
    seat('agent-a', { status: 'paused' }),
    seat('agent-b', { jobs: ['reviewer'] }),
    seat('agent-c', { capacity_points: 2 }),
  ]
  assert.equal(pickSeat(item('item-1'), seats, []), null)
})

test('a seat at its task limit gets no more work', () => {
  const seats = [seat('agent-a', { capacity_points: 100 })]
  const held = ['item-8', 'item-9'].map((id, i) => (
    { item: id, seat: 'agent-a', points: 1, active: true, lease_id: `l${i}` }
  ))
  assert.equal(pickSeat(item('item-1'), seats, held), null)
})

test('a primary assignment moves the item to assigned with a lease', () => {
  const refusals = []
  const result = assignPrimary({
    item: item('item-1'),
    seats: [seat('agent-a')],
    assignments: [],
    tick: 4,
    lease: 'lease-1',
    onRefuse: r => refusals.push(r),
  })
  assert.equal(result.ok, true)
  assert.equal(result.item.state, 'assigned')
  assert.equal(result.assignment.role, 'primary')
  assert.equal(result.assignment.lease_expires_tick, 4 + 3)
  assert.equal(result.assignment.active, true)
  assert.deepEqual(refusals, [])
})

test('an item with no seat is not assigned and the reason says so', () => {
  const result = assignPrimary({
    item: item('item-1'), seats: [], assignments: [], tick: 4, lease: 'lease-1',
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /no seat can take item-1 at tick 4/)
})

test('a secondary seat is never the primary seat, and needs a primary first', () => {
  const seats = [seat('agent-a'), seat('agent-b')]
  const alone = assignSecondary({
    item: item('item-1'), seats, assignments: [], tick: 4, lease: 'lease-2',
  })
  assert.equal(alone.ok, false)
  const primary = { item: 'item-1', seat: 'agent-a', points: 3, active: true, lease_id: 'l1' }
  const second = assignSecondary({
    item: item('item-1'), seats, assignments: [primary], tick: 4, lease: 'lease-2',
  })
  assert.equal(second.ok, true)
  assert.equal(second.assignment.seat, 'agent-b')
  assert.equal(second.assignment.role, 'secondary')
})

test('a heartbeat extends a live lease and a lapsed lease cannot be renewed', () => {
  const live = { lease_id: 'l1', active: true, lease_expires_tick: 7 }
  assert.equal(renewLease(live, 6).assignment.lease_expires_tick, 6 + 3)
  assert.equal(renewLease({ ...live, lease_expires_tick: 5 }, 6).ok, false)
  assert.equal(renewLease({ ...live, active: false }, 6).ok, false)
})

test('a lapsed lease with no other holder returns the item to the queue', () => {
  const items = [item('item-1', { state: 'in_progress' })]
  const assignments = [{ item: 'item-1', seat: 'agent-a', points: 3, active: true,
    lease_id: 'l1', lease_expires_tick: 2 }]
  const out = releaseExpired(items, assignments, 5)
  assert.equal(out.items[0].state, 'queued')
  assert.equal(out.assignments[0].active, false)
})

test('an item with another live holder keeps its state when one lease lapses', () => {
  const items = [item('item-1', { state: 'in_progress' })]
  const assignments = [
    {
      item: 'item-1', seat: 'agent-a', points: 3, active: true,
      lease_id: 'l1', lease_expires_tick: 2,
    },
    {
      item: 'item-1', seat: 'agent-b', points: 3, active: true,
      lease_id: 'l2', lease_expires_tick: 9,
    },
  ]
  const out = releaseExpired(items, assignments, 5)
  assert.equal(out.items[0].state, 'in_progress')
})

test('a lapsed lease on an item past the assignee stage leaves it where it is', () => {
  const items = [item('item-1', { state: 'in_review' })]
  const assignments = [{ item: 'item-1', seat: 'agent-a', points: 3, active: true,
    lease_id: 'l1', lease_expires_tick: 2 }]
  const refusals = []
  const out = releaseExpired(items, assignments, 5, r => refusals.push(r))
  assert.equal(out.items[0].state, 'in_review')
  assert.deepEqual(refusals, [])
})
