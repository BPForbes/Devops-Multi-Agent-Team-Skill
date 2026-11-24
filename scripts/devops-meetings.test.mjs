import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkCheckIn, closeStandup, oneOnOneDue, oneOnOneInvite, openStandup,
  recordUpdate, standupOver, stateSignature,
} from './devops-meetings.mjs'

const items = [
  { id: 'item-1', state: 'in_progress' },
  { id: 'item-2', state: 'done' },
]
const assignments = [
  { item: 'item-1', seat: 'agent-b', active: true, lease_expires_tick: 9 },
  { item: 'item-2', seat: 'agent-a', active: true, lease_expires_tick: 9 },
]

test('a check-in needs a known status, a known routing value and a summary', () => {
  assert.deepEqual(checkCheckIn({ status: 'ok', needs: 'none', summary: 'parser half' }).ok, true)
  assert.equal(checkCheckIn({ status: 'maybe', needs: 'none', summary: 'x' }).ok, false)
  assert.equal(checkCheckIn({ status: 'ok', needs: 'bob', summary: 'x' }).ok, false)
  assert.equal(checkCheckIn({ status: 'ok', needs: 'none', summary: ' ' }).ok, false)
})

test('a standup invites only the seats with open work, and skips when nothing changed', () => {
  const first = openStandup({ tick: 4, assignments, items, lastSignature: null })
  assert.equal(first.kind, 'invite')
  assert.deepEqual(first.meeting.attendees, ['agent-b'])
  const again = openStandup({
    tick: 5, assignments, items, lastSignature: first.meeting.signature,
  })
  assert.equal(again.kind, 'skipped')
  assert.match(again.reason, /no seat changed/)
})

test('a standup is skipped with a reason when no seat has open work', () => {
  const done = [{ id: 'item-1', state: 'done' }]
  const result = openStandup({ tick: 4, assignments, items: done, lastSignature: null })
  assert.equal(result.kind, 'skipped')
  assert.match(result.reason, /no seat has open work/)
})

test('only an invited seat may reply, and only once', () => {
  const meeting = openStandup({ tick: 4, assignments, items, lastSignature: null }).meeting
  assert.equal(recordUpdate(meeting, { seat: 'agent-a', did: [], will_do: [] }).ok, false)
  const once = recordUpdate(meeting, { seat: 'agent-b', did: ['parser'], will_do: [], blocked: [] })
  assert.equal(once.ok, true)
  assert.equal(recordUpdate(once.meeting, { seat: 'agent-b', did: [] }).ok, false)
})

test('a standup closes at the turn cap and lists blocked work for the manager', () => {
  let meeting = {
    meeting_kind: 'standup',
    attendees: ['agent-a', 'agent-b', 'agent-c'],
    replies: {},
    updates: [],
    max_turns: 3,
  }
  for (const seat of ['agent-a', 'agent-b', 'agent-c']) {
    const step = recordUpdate(meeting, { seat, did: [], will_do: [], blocked: [] })
    meeting = step.meeting
  }
  assert.equal(standupOver(meeting), true)
  const summary = closeStandup(meeting, 6)
  assert.equal(summary.capped, false)
  assert.equal(summary.next_meeting_tick, 6)
})

test('blocked work becomes a decision for the manager', () => {
  const meeting = openStandup({ tick: 4, assignments, items, lastSignature: null }).meeting
  const step = recordUpdate(meeting, {
    seat: 'agent-b', did: [], will_do: [], blocked: ['waiting on docs'],
  })
  const summary = closeStandup(step.meeting, 5)
  assert.deepEqual(summary.decisions, ['review agent-b: waiting on docs'])
  assert.equal(summary.capped, false)
})

test('a one-on-one is due when a lease lapses or a seat stalls for three ticks', () => {
  const lapsed = oneOnOneDue({
    assignment: { lease_expires_tick: 2 }, lastChangeTick: 4, tick: 5,
  })
  assert.equal(lapsed.due, true)
  assert.equal(lapsed.reason, 'lease expired')
  const stalled = oneOnOneDue({
    assignment: { lease_expires_tick: 9 }, lastChangeTick: 2, tick: 5,
  })
  assert.equal(stalled.reason, 'stalled')
  assert.equal(oneOnOneDue({
    assignment: { lease_expires_tick: 9 }, lastChangeTick: 4, tick: 5,
  }).due, false)
})

test('a one-on-one is between the manager and one seat, with the fixed topics', () => {
  const invite = oneOnOneInvite({ manager: 'agent-m', seat: 'agent-b', tick: 5, reason: 'stalled' })
  assert.deepEqual(invite.attendees, ['agent-b', 'agent-m'])
  assert.equal(invite.meeting_kind, 'one_on_one')
  assert.ok(invite.topics.includes('blockers'))
})

test('the state signature changes when a seat moves to a new state', () => {
  const before = stateSignature(assignments, items)
  const moved = [{ id: 'item-1', state: 'in_review' }, items[1]]
  assert.notEqual(stateSignature(assignments, moved), before)
})
