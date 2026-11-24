import assert from 'node:assert/strict'
import test from 'node:test'

import {
  closeAnswer, nextStep, openRequest, routeQuestion, usable,
} from './devops-help.mjs'

const TREE = 'a'.repeat(40)
const request = { item: 'item-1' }
const base = {
  request, text: 'Node 18 is enough', author: 'agent-a', verifier: 'agent-b',
  verdict: 'PASS', evidence: { docs: 'vitest.dev', version: '2.x' }, tree: TREE, tick: 7,
}

test('the ladder skips a teammate step with no peer, and the lead step for the lead', () => {
  assert.equal(nextStep({ step: 3, teamSize: 1, askerIsLead: false }), 5)
  assert.equal(nextStep({ step: 3, teamSize: 2, askerIsLead: false }), 4)
  assert.equal(nextStep({ step: 4, teamSize: 3, askerIsLead: true }), 6)
  assert.equal(nextStep({ step: 6, teamSize: 3, askerIsLead: false }), null)
})

test('a request needs a step on the ladder, a question and an online query', () => {
  const ok = {
    item: 'item-1', seat: 'agent-a', step: 3, question: 'Q?', onlineQuery: 'q', prior: [],
  }
  assert.equal(openRequest(ok).ok, true)
  assert.equal(openRequest({ ...ok, step: 9 }).ok, false)
  assert.equal(openRequest({ ...ok, onlineQuery: '' }).ok, false)
})

test('the same question is not asked twice on an item', () => {
  const first = openRequest({
    item: 'item-1', seat: 'agent-a', step: 1, question: 'Q?', onlineQuery: 'q', prior: [],
  }).request
  const again = openRequest({
    item: 'item-1', seat: 'agent-a', step: 2, question: 'Q?', onlineQuery: 'q', prior: [first],
  })
  assert.equal(again.ok, false)
  assert.match(again.reason, /already asked/)
})

test('a fourth request on one item escalates to the manager', () => {
  const prior = [1, 2, 3].map(n => ({
    item: 'item-1', seat: 'agent-a', question: `Q${n}`,
  }))
  const fourth = openRequest({
    item: 'item-1', seat: 'agent-a', step: 1, question: 'Q4', onlineQuery: 'q', prior,
  })
  assert.equal(fourth.ok, false)
  assert.equal(fourth.escalate, 'manager')
})

test('a verifier other than the author closes an answer with exactly one kind of evidence', () => {
  assert.equal(closeAnswer(base).ok, true)
  assert.equal(closeAnswer({ ...base, verifier: 'agent-a' }).ok, false)
  assert.equal(closeAnswer({ ...base, verifier: '' }).ok, false)
  const twoKinds = { docs: 'x', version: '2', command: 'npm test' }
  assert.equal(closeAnswer({ ...base, evidence: twoKinds }).ok, false)
})

test('a verdict other than PASS or BLOCKED, or a bad tree hash, is refused', () => {
  assert.equal(closeAnswer({ ...base, verdict: 'MAYBE' }).ok, false)
  assert.equal(closeAnswer({ ...base, tree: 'short' }).ok, false)
})

test('an answer is usable only as PASS on the current tree', () => {
  const closed = closeAnswer(base).answer
  assert.equal(usable(closed, TREE), true)
  assert.equal(usable(closed, 'b'.repeat(40)), false, 'a new commit voids the verdict')
  assert.equal(usable({ ...closed, verdict: 'BLOCKED' }, TREE), false)
})

test('a seat may not route a question to a human; the server may', () => {
  assert.equal(routeQuestion({ fromRole: 'seat', route: 'human' }).ok, false)
  assert.equal(routeQuestion({ fromRole: 'server', route: 'human' }).ok, true)
  assert.equal(routeQuestion({ fromRole: 'seat', route: 'docs' }).ok, true)
})
