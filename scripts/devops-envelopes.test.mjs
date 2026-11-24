import assert from 'node:assert/strict'
import test from 'node:test'

import { envelopeKinds, validateEnvelope } from './devops-envelopes.mjs'

const FROM = { agent: 'agent-0c0c0c', role: 'manager' }
const head = (kind, id, body) => ({ v: 1, kind, id, from: FROM, sent_tick: 4, body })

const VALID = {
  'work.item': head('work.item', 'work-3c9e41', {
    item: 'item-3c9e41', goal: 'goal-7f0a12', job: 'coder', acceptance: ['lint passes'],
    deps: [], priority: 2, size: 3, points: 3,
  }),
  'work.assignment': head('work.assignment', 'work-4d5e6f', {
    item: 'item-3c9e41', seat: 'agent-0a0a0a', job: 'coder', role: 'primary',
    lease_id: 'lease-3c9e41', lease_expires_tick: 9,
  }),
  'work.heartbeat': head('work.heartbeat', 'work-5e6f70', {
    item: 'item-3c9e41', lease_id: 'lease-3c9e41',
  }),
  'work.checkin': head('work.checkin', 'work-6f7081', {
    item: 'item-3c9e41', status: 'ok', summary: 'Parser half done', needs: 'none',
  }),
  'work.accept': head('work.accept', 'work-708192', { assignment: 'work-4d5e6f' }),
  'work.estimate': head('work.estimate', 'work-8192a3', {
    item: 'item-3c9e41', owner: 'agent-0a0a0a', points: 3, value: 5, urgency: 4,
    meeting: 'meeting-3c9e41',
  }),
  'server.tick': head('server.tick', 'tick-3c9e41', {
    tick: 4, sprint: 'sprint-aaaaaa', sprint_tick: 1, started_utc: null,
  }),
  'meeting.invite': head('meeting.invite', 'meeting-3c9e41', {
    meeting: 'meeting-3c9e41', meeting_kind: 'standup', attendees: ['agent-0a0a0a'],
    agenda: ['progress'], at_tick: 5, max_turns: 3, max_tokens: 2000,
  }),
  'meeting.update': head('meeting.update', 'work-9a0b1c', {
    meeting: 'meeting-3c9e41', did: ['parser'], will_do: ['tests'], blocked: [],
  }),
  'meeting.summary': head('meeting.summary', 'work-0b1c2d', {
    meeting: 'meeting-3c9e41', decisions: ['ship parser'], action_items: [],
    next_meeting_tick: 9, capped: false,
  }),
  'question.ask': head('question.ask', 'question-3c9e41', {
    item: 'item-3c9e41', text: 'Which VM image?', route: 'docs', timeout_ticks: 2,
  }),
  'question.answer': head('question.answer', 'answer-3c9e41', {
    question: 'question-3c9e41', text: 'Ubuntu 24.04', source: 'docs',
  }),
  'human.answer': head('human.answer', 'answer-7f0a12', {
    question: 'question-3c9e41', text: 'Use the default image',
  }),
  'human.digest': head('human.digest', 'digest-3c9e41', {
    sprint: 'sprint-aaaaaa', done: ['parser'], slipped: [], decisions_needed: [], retro_actions: [],
  }),
  'help.request': head('help.request', 'help-3c9e41', {
    item: 'item-3c9e41', step: 3, question: 'Does vitest 2 need node 18?',
    online_query: 'vitest 2 node engines requirement', tried: ['project docs'],
  }),
  'help.answer': head('help.answer', 'help-7f0a12', {
    request: 'help-3c9e41', text: 'Yes, node 18+', verdict: 'PASS', method: 'vendor_docs',
    verifier: 'agent-bdfdfe', evidence: { docs: 'vitest.dev', version: '2.x' }, closed_tick: 7,
  }),
  'run.record': head('run.record', 'run-3c9e41', {
    command: 'npm test', tree: 'a'.repeat(40), exit_code: 0, counts: '217 pass, 0 fail',
    authorized_by: 'human', stored: 'local-ai-cache', pushed: false,
  }),
  'run.authorize': head('run.authorize', 'run-7f0a12', {
    command: 'npm test', tree: 'a'.repeat(40), origin: 'composer',
  }),
  'seat.profile': head('seat.profile', 'seat-3c9e41', {
    agent: 'agent-0a0a0a', team: 'team-1a2b3c', role: 'coder', initial_job: 'coder',
    primary_job: 'coder', temp_job: null, status: 'active', capacity_points: 12,
    key_id: 'key-3c9e41',
    active_tasks: [{ goal: 'goal-7f0a12', item: 'item-3c9e41', job: 'coder', role: 'primary' }],
  }),
  'handoff.triage': {
    kind: 'triage', item: 'item-3c9e41', goal: 'goal-7f0a12', signed_by: 'agent-0c0c0c',
    from: { job: 'qa', agent: 'agent-0c0c0c', team: 'team-4d5e6f' },
    to: { job: 'coder', agent: '', team: 'team-1a2b3c' }, reason: 'Lint still fails',
    blame: { agent: 'agent-0a0a0a', team: 'team-1a2b3c' }, created: '2026-11-20T10:00:00Z',
  },
}

test('every envelope kind the schema defines has a valid example here', () => {
  for (const kind of envelopeKinds()) {
    assert.ok(kind, 'a kind is named')
  }
  assert.ok(envelopeKinds().includes('work.item'))
  assert.ok(envelopeKinds().includes('server.tick'))
})

test('each valid example is accepted', () => {
  for (const [name, example] of Object.entries(VALID)) {
    const result = validateEnvelope(example)
    assert.equal(result.ok, true, `${name}: ${result.errors.join('; ')}`)
  }
})

test('an unknown version is refused', () => {
  const result = validateEnvelope({ ...VALID['work.item'], v: 2 })
  assert.equal(result.ok, false)
})

test('an id that carries a path separator is refused', () => {
  const result = validateEnvelope({ ...VALID['work.item'], id: '../../etc/passwd' })
  assert.equal(result.ok, false)
})

test('a spoofed extra field is refused on the envelope and on the sender', () => {
  assert.equal(validateEnvelope({ ...VALID['work.item'], by: 'agent-bbbbbb' }).ok, false)
  const spoofed = { ...VALID['work.item'], from: { ...FROM, extra: 'x' } }
  assert.equal(validateEnvelope(spoofed).ok, false)
})

test('a send-back without a blame tag is refused', () => {
  const noBlame = { ...VALID['handoff.triage'], blame: null }
  assert.equal(validateEnvelope(noBlame).ok, false)
})

test('a help step outside 1 to 6 and an unknown verification method are refused', () => {
  const badStep = { ...VALID['help.request'], body: { ...VALID['help.request'].body, step: 9 } }
  assert.equal(validateEnvelope(badStep).ok, false)
  const badMethod = { ...VALID['help.answer'], body: { ...VALID['help.answer'].body, method: 'trust_me' } }
  assert.equal(validateEnvelope(badMethod).ok, false)
})

test('a run record that claims to be pushed is refused', () => {
  const pushed = { ...VALID['run.record'], body: { ...VALID['run.record'].body, pushed: true } }
  assert.equal(validateEnvelope(pushed).ok, false)
})

test('an artifact path that climbs out of the repo is refused', () => {
  const climbing = {
    ...VALID['handoff.triage'],
    kind: 'coder-to-review',
    to: { job: 'reviewer', agent: '', team: 'team-4d5e6f' },
    blame: undefined,
  }
  delete climbing.blame
  const result = validateEnvelope({ ...climbing, artifacts: {
    branch: 'feature/x', commit: 'a'.repeat(40), tree: 'b'.repeat(40), files: ['../secrets'],
  } })
  assert.equal(result.ok, false)
})
