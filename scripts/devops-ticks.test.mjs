import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { UNFENCED } from './devops-store.mjs'

import {
  acquireLeader, advanceTick, expiredLeases, fenceOk, initialTicks, openSprint, recordCompletion,
  recordCompletionAt, TICK_CONFIG, wallClockOf,
} from './devops-ticks.mjs'

const MIN = 60000
const T0 = Date.UTC(2026, 10, 24, 9, 0, 0)

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-ticks-'))
}

test('three completed items make a tick; two do not', () => {
  let state = initialTicks(T0)
  for (let i = 0; i < 2; i += 1) state = recordCompletion(state, { nowMs: T0 }).state
  assert.equal(state.tick, 0)
  const third = recordCompletion(state, { nowMs: T0 })
  assert.equal(third.ticked, true)
  assert.equal(third.state.tick, 1)
})

test('fifteen minutes with no completed item makes a tick', () => {
  const state = initialTicks(T0)
  const later = recordCompletion(state, { nowMs: T0 + 15 * MIN })
  assert.equal(later.ticked, true)
  const sooner = recordCompletion(state, { nowMs: T0 + 14 * MIN })
  assert.equal(sooner.ticked, false)
})

test('a tick records its wall-clock start time; an unknown tick is null', () => {
  const state = advanceTick(initialTicks(), T0)
  assert.equal(wallClockOf(state, 1), new Date(T0).toISOString())
  assert.equal(wallClockOf(state, 9), null)
})

test('a sprint of ten ticks closes on its last tick', () => {
  let state = openSprint(initialTicks(), 'sprint-aaaaaa')
  for (let i = 0; i < TICK_CONFIG.ticksPerSprint - 1; i += 1) state = advanceTick(state, T0)
  assert.equal(state.sprint_status, 'open')
  state = advanceTick(state, T0)
  assert.equal(state.sprint_status, 'closed')
  assert.equal(state.sprint_tick, TICK_CONFIG.ticksPerSprint)
})

test('a second sprint cannot open while the first is open', () => {
  const state = openSprint(initialTicks(), 'sprint-aaaaaa')
  assert.throws(() => openSprint(state, 'sprint-bbbbbb'), /still open/)
})

test('leases that ended before the tick are expired, the rest are not', () => {
  const work = [{ id: 'a', lease_expires_tick: 3 }, { id: 'b', lease_expires_tick: 9 }]
  assert.deepEqual(expiredLeases(work, 5).map(a => a.id), ['a'])
})

test('a tick counter persists under the store and counts across calls', () => {
  const dir = scratch()
  const file = path.join(dir, 'ticks.json')
  recordCompletionAt(file, { nowMs: T0, fence: UNFENCED })
  recordCompletionAt(file, { nowMs: T0, fence: UNFENCED })
  const third = recordCompletionAt(file, { nowMs: T0, fence: UNFENCED })
  assert.equal(third.ticked, true)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tick, 1)
})

test('a second leader is refused while the first lease is live', () => {
  const dir = scratch()
  const file = path.join(dir, 'leader.json')
  assert.deepEqual(acquireLeader(file, 'server-a', T0, 30000), { acquired: true, epoch: 1 })
  assert.equal(acquireLeader(file, 'server-b', T0 + 1000, 30000).acquired, false)
})

test('a takeover after the lease expires bumps the epoch and fences the old leader', () => {
  const dir = scratch()
  const file = path.join(dir, 'leader.json')
  acquireLeader(file, 'server-a', T0, 30000)
  const takeover = acquireLeader(file, 'server-b', T0 + 60000, 30000)
  assert.deepEqual(takeover, { acquired: true, epoch: 2 })
  assert.equal(fenceOk(file, 1), false, 'the paused leader is fenced out')
  assert.equal(fenceOk(file, 2), true)
})

test('a write fenced by an old epoch is refused, and the board is left as it was', () => {
  const dir = scratch()
  const leader = path.join(dir, 'leader.json')
  const ticks = path.join(dir, 'ticks.json')
  assert.deepEqual(acquireLeader(leader, 'server-a', T0, 30000), { acquired: true, epoch: 1 })
  recordCompletionAt(ticks, { nowMs: T0, fence: { leaderFile: leader, epoch: 1 } })
  const takeover = acquireLeader(leader, 'server-b', T0 + 60000, 30000)
  assert.deepEqual(takeover, { acquired: true, epoch: 2 })
  const before = fs.readFileSync(ticks, 'utf8')
  assert.throws(
    () => recordCompletionAt(ticks, { nowMs: T0 + 61000, fence: { leaderFile: leader, epoch: 1 } }),
    /fenced out/,
  )
  assert.equal(fs.readFileSync(ticks, 'utf8'), before)
  const fence = { leaderFile: leader, epoch: 2 }
  const after = recordCompletionAt(ticks, { nowMs: T0 + 61000, fence })
  assert.equal(after.state.completed_since_tick, 2, 'the first write and the new leader\'s write')
})

test('the same leader renewing keeps its epoch', () => {
  const dir = scratch()
  const file = path.join(dir, 'leader.json')
  acquireLeader(file, 'server-a', T0, 30000)
  assert.deepEqual(acquireLeader(file, 'server-a', T0 + 10000, 30000), { acquired: true, epoch: 1 })
})
