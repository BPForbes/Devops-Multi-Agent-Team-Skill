import assert from 'node:assert/strict'
import test from 'node:test'

import { HANDOFF_KINDS, makeHandoff, validateHandoff } from './devops-handoff.mjs'

const QA = 'agent-0c0c0c'
const CODER = 'agent-0a0a0a'
const REVIEWER = 'agent-0b0b0b'
const RESEARCHER = 'agent-0f0f0f'
const T_CODER = 'team-1a2b3c'
const T_QA = 'team-4d5e6f'
const BASE = {
  item: 'item-3c9e41',
  goal: 'goal-7f0a12',
  created: '2026-11-20T10:00:00Z',
}

function triage(overrides = {}) {
  return makeHandoff('triage', {
    ...BASE,
    signedBy: QA,
    fromAgent: QA,
    fromTeam: T_QA,
    toAgent: '',
    toTeam: T_CODER,
    reason: 'The lint gate still fails on the new branch',
    ...overrides,
  })
}

test('every kind has a sender and a receiver job', () => {
  assert.deepEqual(Object.keys(HANDOFF_KINDS), [
    'triage', 'research-to-coder', 'coder-to-review',
    'review-to-qa', 'qa-to-security', 'security-signoff',
  ])
})

test('a triage resend is signed by QA, names the goal and team, and is valid', () => {
  const payload = triage()
  assert.equal(payload.from.job, 'qa')
  assert.equal(payload.signed_by, QA)
  assert.equal(payload.to.agent, '')
  assert.deepEqual(validateHandoff(payload), { ok: true, errors: [] })
})

test('a triage needs a one-line reason', () => {
  const result = validateHandoff(triage({ reason: '   ' }))
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /reason is required/)
})

test('the coder is empty until one is chosen, then must be an agent hash', () => {
  assert.equal(validateHandoff(triage({ toAgent: CODER })).ok, true)
  const bad = validateHandoff(triage({ toAgent: 'coder' }))
  assert.match(bad.errors.join(' '), /to.agent/)
})

test('a judging handoff must go to another team', () => {
  const same = makeHandoff('coder-to-review', {
    ...BASE, signedBy: CODER, fromAgent: CODER, fromTeam: T_CODER,
    toAgent: REVIEWER, toTeam: T_CODER,
  })
  assert.match(validateHandoff(same).errors.join(' '), /must differ/)
  const other = makeHandoff('coder-to-review', {
    ...BASE, signedBy: CODER, fromAgent: CODER, fromTeam: T_CODER,
    toAgent: REVIEWER, toTeam: T_QA,
  })
  assert.equal(validateHandoff(other).ok, true)
})

test('research to coder stays in the same pod and needs no reason', () => {
  const payload = makeHandoff('research-to-coder', {
    ...BASE, signedBy: RESEARCHER, fromAgent: RESEARCHER, fromTeam: T_CODER,
    toAgent: CODER, toTeam: T_CODER,
  })
  assert.equal(validateHandoff(payload).ok, true)
})

test('the signer must be the sending seat, and the goal must be a goal hash', () => {
  const payload = triage({ signedBy: CODER })
  assert.match(validateHandoff(payload).errors.join(' '), /signed_by/)
  assert.match(validateHandoff(triage({ goal: 'goal-XYZ' })).errors.join(' '), /goal must be/)
})

test('a security sign-off records clear or blocked', () => {
  const base = {
    ...BASE, signedBy: 'agent-0d0d0d', fromAgent: 'agent-0d0d0d', fromTeam: 'team-7a8b9c',
    toAgent: '', toTeam: '',
  }
  const clear = makeHandoff('security-signoff', { ...base, result: 'clear' })
  assert.equal(validateHandoff(clear).ok, true)
  const maybe = makeHandoff('security-signoff', { ...base, result: 'maybe' })
  assert.match(validateHandoff(maybe).errors.join(' '), /clear or blocked/)
})

test('an unknown kind is refused', () => {
  assert.throws(() => makeHandoff('pizza', BASE), /unknown handoff kind/)
  assert.equal(validateHandoff({ kind: 'pizza' }).ok, false)
})
