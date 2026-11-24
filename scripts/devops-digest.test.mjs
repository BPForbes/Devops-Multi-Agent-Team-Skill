import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDigest, checkHumanAnswer, digestDue, interruptMessage, shouldInterrupt,
} from './devops-digest.mjs'

test('the human is interrupted for a gate, a human decision, or a failure past its retries', () => {
  assert.equal(shouldInterrupt({ kind: 'gate', retriesUsed: 0, retryLimit: 2 }), true)
  assert.equal(shouldInterrupt({ kind: 'human_decision', retriesUsed: 0, retryLimit: 2 }), true)
  assert.equal(shouldInterrupt({ kind: 'failure', retriesUsed: 1, retryLimit: 2 }), false)
  assert.equal(shouldInterrupt({ kind: 'failure', retriesUsed: 2, retryLimit: 2 }), true)
  assert.equal(shouldInterrupt({ kind: 'progress', retriesUsed: 0, retryLimit: 2 }), false)
})

test('an interrupt is one line with one ask', () => {
  assert.equal(interruptMessage({ kind: 'gate', ask: 'Approve the push?' }).ok, true)
  assert.equal(interruptMessage({ kind: 'gate', ask: 'Q1?\nQ2?' }).ok, false)
  assert.equal(interruptMessage({ kind: 'gate', ask: '' }).ok, false)
  assert.equal(interruptMessage({ kind: 'news', ask: 'hi' }).ok, false)
})

test('a sprint gets one digest, with done, slipped, decisions and retro actions', () => {
  assert.equal(digestDue({ sprint: 'sprint-1', sentSprints: [] }).due, true)
  assert.equal(digestDue({ sprint: 'sprint-1', sentSprints: ['sprint-1'] }).due, false)
  const digest = buildDigest({
    sprint: 'sprint-1',
    finished: ['item-1'],
    slipped: ['item-2'],
    decisions: ['ship parser'],
    retroActions: ['item-9'],
  })
  assert.deepEqual(digest.done, ['item-1'])
  assert.deepEqual(digest.decisions_needed, ['ship parser'])
})

test('a human answer must answer an open question, in words, not a gate command', () => {
  const openQuestions = ['question-1']
  const answer = (question, text) => checkHumanAnswer({ question, text, openQuestions })
  assert.equal(answer('question-1', 'Yes').ok, true)
  assert.equal(answer('question-9', 'Yes').ok, false)
  assert.equal(answer('question-1', '/devops push-ok').ok, false)
})
