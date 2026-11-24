import assert from 'node:assert/strict'
import test from 'node:test'

import {
  admit, allowedActors, checkIntake, goalState, securitySignOff, transition,
} from './devops-items.mjs'

const ITEM = 'item-3c9e41'
const SECURITY = { agent: 'agent-s', role: 'security' }
const itemIn = state => ({ id: ITEM, goal: 'goal-7f0a12', state, points: 3, acceptance: ['ok'] })
const VALID = { item: ITEM, goal: 'goal-7f0a12', acceptance: ['lint passes'], points: 3 }

test('an item walks the whole path with the right actor at each step', () => {
  const steps = [
    ['assigned', 'server'],
    ['in_progress', 'assignee'],
    ['in_review', 'assignee'],
    ['in_qa', 'reviewer'],
    ['in_security', 'qa'],
    ['ready_for_human', 'security'],
    ['done', 'manager'],
  ]
  let item = itemIn('queued')
  for (const [to, actor] of steps) {
    if (to === 'ready_for_human') item = securitySignOff(item, SECURITY).item
    const result = transition(item, to, actor)
    assert.equal(result.ok, true, `${to} by ${actor}: ${result.reason}`)
    item = result.item
  }
  assert.equal(item.state, 'done')
})

test('a move by the wrong actor is refused, names who may make it, and is logged', () => {
  const refusals = []
  const result = transition(itemIn('assigned'), 'queued', 'assignee', r => refusals.push(r))
  assert.equal(result.ok, false)
  assert.match(result.reason, /needs server, not assignee/)
  assert.equal(refusals.length, 1)
  assert.equal(refusals[0].from, 'assigned')
  assert.equal(refusals[0].to, 'queued')
})

test('a refused move leaves the item where it was', () => {
  const item = itemIn('ready_for_human')
  const result = transition(item, 'done', 'assignee')
  assert.equal(result.ok, false)
  assert.equal(item.state, 'ready_for_human')
})

test('a move that is not in the table is refused for every actor', () => {
  const result = transition(itemIn('queued'), 'done', 'manager')
  assert.equal(result.ok, false)
  assert.match(result.reason, /queued cannot move to done/)
  assert.deepEqual(allowedActors('queued', 'done'), [])
})

test('only the manager may return a failed item to the queue', () => {
  assert.equal(transition(itemIn('failed'), 'queued', 'assignee').ok, false)
  assert.equal(transition(itemIn('failed'), 'queued', 'manager').ok, true)
})

test('the manager may block a team item, and the assignee may unblock it', () => {
  assert.equal(transition(itemIn('in_progress'), 'blocked', 'manager').ok, true)
  assert.equal(transition(itemIn('blocked'), 'in_progress', 'assignee').ok, true)
  assert.equal(transition(itemIn('blocked'), 'in_progress', 'manager').ok, false)
})

test('the manager may escalate to blocked from any live state, not only two', () => {
  for (const state of ['queued', 'in_review', 'in_qa', 'ready_for_human']) {
    assert.equal(transition(itemIn(state), 'blocked', 'manager').ok, true, state)
  }
  assert.equal(transition(itemIn('done'), 'blocked', 'manager').ok, false)
})

test('the actor list is a copy, so a caller cannot change the table', () => {
  allowedActors('queued', 'assigned').push('human')
  assert.deepEqual(allowedActors('queued', 'assigned'), ['server'])
})

test('an item id must be item- and six hex digits', () => {
  assert.equal(checkIntake({ ...VALID, item: 'item-a' }).ok, false)
  assert.equal(checkIntake({ ...VALID, item: 'item-deadbeef' }).ok, false)
  assert.equal(checkIntake({ ...VALID, item: 'item-3c9e41' }).ok, true)
})

test('a lapsed lease sends an item back to the queue only through the server', () => {
  assert.equal(transition(itemIn('in_progress'), 'queued', 'server').ok, true)
  assert.equal(transition(itemIn('in_progress'), 'queued', 'assignee').ok, false)
})

test('intake accepts a complete work item and admits it as queued', () => {
  assert.deepEqual(checkIntake(VALID), { ok: true, errors: [] })
  const admitted = admit(VALID)
  assert.equal(admitted.ok, true)
  assert.equal(admitted.item.state, 'queued')
  assert.equal(admitted.item.points, 3)
})

test('an admitted item keeps the job it needs', () => {
  assert.equal(admit({ ...VALID, job: 'qa' }).item.job, 'qa')
})

test('intake refuses an empty or blank acceptance list', () => {
  assert.equal(checkIntake({ ...VALID, acceptance: [] }).ok, false)
  assert.equal(checkIntake({ ...VALID, acceptance: ['  '] }).ok, false)
  assert.equal(checkIntake({ ...VALID, acceptance: undefined }).ok, false)
})

test('intake refuses points outside 1 to 13 and fractional points', () => {
  assert.equal(checkIntake({ ...VALID, points: 0 }).ok, false)
  assert.equal(checkIntake({ ...VALID, points: 14 }).ok, false)
  assert.equal(checkIntake({ ...VALID, points: 2.5 }).ok, false)
  assert.equal(checkIntake({ ...VALID, points: 13 }).ok, true)
})

test('intake refuses an id that is not item-<hex>', () => {
  assert.equal(checkIntake({ ...VALID, item: '../item' }).ok, false)
  assert.equal(checkIntake({ ...VALID, item: undefined }).ok, false)
})

test('a refused intake says every problem it found', () => {
  const result = admit({ item: 'nope', acceptance: [], points: 0 })
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 3)
})

test('a goal is empty, active, or done by its items', () => {
  assert.equal(goalState([]), 'empty')
  assert.equal(goalState([itemIn('done'), itemIn('queued')]), 'active')
  assert.equal(goalState([itemIn('done'), itemIn('done')]), 'done')
})

test('an item needs security sign-off to be done; only security signs off in review', () => {
  const refusals = []
  const refused = transition(itemIn('ready_for_human'), 'done', 'manager', r => refusals.push(r))
  assert.equal(refused.ok, false)
  assert.match(refused.reason, /security sign-off/)
  assert.equal(refusals.length, 1)
  const coder = { agent: 'agent-c', role: 'coder' }
  const security = { agent: 'agent-s', role: 'security' }
  assert.equal(securitySignOff(itemIn('in_security'), coder).ok, false)
  assert.equal(securitySignOff(itemIn('in_review'), security).ok, false)
  const signed = securitySignOff(itemIn('in_security'), security)
  assert.equal(signed.ok, true)
  const ready = transition(signed.item, 'ready_for_human', 'security')
  assert.equal(transition(ready.item, 'done', 'manager').ok, true)
})

test('rework after a sign-off clears it, so the next review must sign off again', () => {
  const signed = securitySignOff(itemIn('in_security'), { agent: 'agent-s', role: 'security' })
  const back = transition(signed.item, 'in_progress', 'security')
  assert.equal(back.ok, true)
  assert.equal(back.item.security_signoff, undefined)
  const again = transition(back.item, 'in_review', 'assignee')
  assert.equal(again.ok, true)
})

test('a sign-off does not survive a detour through blocked and rework', () => {
  const signed = securitySignOff(itemIn('in_security'), SECURITY).item
  let item = transition(signed, 'ready_for_human', 'security').item
  const path = [
    ['blocked', 'manager'], ['in_progress', 'assignee'], ['in_review', 'assignee'],
    ['in_qa', 'reviewer'], ['in_security', 'qa'], ['ready_for_human', 'security'],
  ]
  for (const [to, actor] of path) item = transition(item, to, actor).item
  assert.equal(item.security_signoff, undefined)
  assert.match(transition(item, 'done', 'manager').reason, /security sign-off/)
})
