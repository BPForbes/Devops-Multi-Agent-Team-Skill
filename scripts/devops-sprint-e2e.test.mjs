// One sprint through the orchestration modules and the event log: commit,
// assign, work to done, tick, standup, review, retro, digest, then verify the
// hash-chained log. Not yet through the MCP server: these modules are not
// exposed as MCP tools.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { admit, securitySignOff, transition } from './devops-items.mjs'
import { assignPrimary, releaseExpired } from './devops-assign.mjs'
import { buildDigest, digestDue } from './devops-digest.mjs'
import { chainEvents, verifyChain } from './devops-identity.mjs'
import { appendEvent, readEvents } from './devops-store.mjs'
import { openStandup, recordUpdate, closeStandup } from './devops-meetings.mjs'
import {
  planCommitments, planningSummary, retroActionItems, reviewSprint, startSprint,
} from './devops-sprint.mjs'
import { initialTicks, recordCompletion } from './devops-ticks.mjs'

const KEY = 'server-secret'
const GOAL = 'goal-7f0a12'
const SEATS = [
  { agent: 'agent-a', jobs: ['coder'], status: 'active', capacity_points: 12 },
  { agent: 'agent-b', jobs: ['coder'], status: 'active', capacity_points: 12 },
]
const OWNERS = { 'item-0000a1': 'agent-a', 'item-0000a2': 'agent-b', 'item-0000a3': 'agent-a' }
const PATH_TO_DONE = [
  ['in_progress', 'assignee'],
  ['in_review', 'assignee'],
  ['in_qa', 'reviewer'],
  ['in_security', 'qa'],
  ['ready_for_human', 'security'],
  ['done', 'human'],
]

function walk(item, steps) {
  let current = item
  for (const [to, actor] of steps) {
    if (to === 'ready_for_human') {
      current = securitySignOff(current, { agent: 'agent-s', role: 'security' }).item
    }
    const moved = transition(current, to, actor)
    assert.equal(moved.ok, true, `${to} by ${actor}: ${moved.reason}`)
    current = moved.item
  }
  return current
}

function assignAll(items, tick) {
  const assignments = []
  const refusals = []
  const assigned = items.map(item => {
    const r = assignPrimary({
      item, seats: SEATS, assignments, tick, lease: `lease-${item.id}`,
      onRefuse: x => refusals.push(x),
    })
    assert.equal(r.ok, true, r.reason)
    assignments.push(r.assignment)
    return r.item
  })
  return { items: assigned, assignments, refusals }
}

test('one sprint runs from commitment to a digest with a verifiable log', () => {
  const admitted = ['item-0000a1', 'item-0000a2', 'item-0000a3'].map(id => admit({
    item: id, goal: GOAL, job: 'coder', acceptance: ['tests pass'], points: 3,
  }))
  assert.ok(admitted.every(r => r.ok))
  const queued = admitted.map(r => r.item)

  const plan = planCommitments({
    items: queued.map(i => ({ id: i.id, owner: OWNERS[i.id], points: i.points })),
    seats: SEATS,
  })
  assert.equal(plan.committed.length, 3)
  const started = startSprint({ state: initialTicks(0), sprintId: 'sprint-1', plan })
  let state = started.state
  const summary = planningSummary({ sprintId: 'sprint-1', plan, nextMeetingTick: 1 })

  const { items: assigned, assignments, refusals } = assignAll(queued, state.tick)
  assert.deepEqual(refusals, [])
  const working = assigned.map(item => transition(item, 'in_progress', 'assignee').item)

  const standup = openStandup({
    tick: state.tick, assignments, items: working, lastSignature: null,
  })
  assert.equal(standup.kind, 'invite')
  let meeting = standup.meeting
  for (const seat of meeting.attendees) {
    meeting = recordUpdate(meeting, { seat, did: [], will_do: ['work'], blocked: [] }).meeting
  }
  const standupSummary = closeStandup(meeting, state.tick + 1)
  assert.equal(standupSummary.capped, false)

  const finished = working.map(item => walk(item, PATH_TO_DONE.slice(1)))
  for (let n = 0; n < finished.length; n += 1) {
    state = recordCompletion(state, { nowMs: 0 }).state
  }
  assert.equal(state.tick, 1, 'three completions end a tick')
  assert.equal(state.sprint_tick, 1)

  const review = reviewSprint({ committed: plan.committed, items: finished, owners: OWNERS })
  assert.equal(review.finished.length, 3)
  assert.deepEqual(review.perSeat['agent-a'], { committed: 2, done: 2 })

  const retro = retroActionItems({
    actions: [{ id: 'item-9', text: 'add lint to CI', owner: 'agent-b' }],
    goal: GOAL,
    seats: SEATS,
  })
  const digest = buildDigest({
    sprint: 'sprint-1',
    finished: review.finished,
    slipped: review.slipped,
    decisions: summary.decisions,
    retroActions: retro.items.map(i => i.id),
  })
  assert.equal(digestDue({ sprint: 'sprint-1', sentSprints: [] }).due, true)
  assert.deepEqual(digest.done, ['item-0000a1', 'item-0000a2', 'item-0000a3'])

  const events = [
    { id: 'ev-1', from: { agent: 'agent-m', role: 'manager' }, kind: 'server.tick', tick: 0 },
    {
      id: 'ev-2', from: { agent: 'agent-m', role: 'manager' }, kind: 'work.assignment',
      n: assignments.length,
    },
    {
      id: 'ev-3', from: { agent: 'agent-m', role: 'manager' }, kind: 'human.digest',
      sprint: digest.sprint,
    },
  ]
  verifyLog(events)
})

function verifyLog(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-e2e-'))
  const log = path.join(dir, 'events.jsonl')
  for (const event of chainEvents(events, KEY)) appendEvent(log, event)
  assert.equal(verifyChain(readEvents(log), KEY), true)
  const lines = fs.readFileSync(log, 'utf8').split('\n')
  lines[0] = lines[0].replace('"tick":0', '"tick":9')
  fs.writeFileSync(log, lines.join('\n'))
  assert.equal(verifyChain(readEvents(log), KEY), false, 'an edited log fails verification')
}

test('a lapsed lease during the sprint returns that item to the queue', () => {
  const { item } = admit({
    item: 'item-0000a1', goal: GOAL, job: 'coder', acceptance: ['x'], points: 3,
  })
  const { items, assignments } = assignAll([item], 0)
  const started = walk(items[0], [['in_progress', 'assignee']])
  const out = releaseExpired([started], assignments, 5)
  assert.equal(out.items[0].state, 'queued')
})
