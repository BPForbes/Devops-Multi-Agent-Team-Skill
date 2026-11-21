import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addGoal,
  assignGoal,
  emptyMemory,
  findGoalByText,
  goalTrailers,
  isGoalId,
  mintGoalId,
  normalizeGoalText,
  supersedeGoal,
} from './devops-goals.mjs'

const T1 = 'team-1a2b3c'
const T2 = 'team-4d5e6f'
const AT = '2026-11-20T10:00:00Z'

test('goal hashes are goal- plus six lowercase hex characters', () => {
  assert.match(mintGoalId(), /^goal-[0-9a-f]{6}$/)
  assert.equal(isGoalId('goal-3c9e41'), true)
  assert.equal(isGoalId('goal-3C9E41'), false)
  assert.equal(isGoalId('item-3c9e41'), false)
})

test('goal text matches ignoring case and extra spaces', () => {
  assert.equal(normalizeGoalText('  The  Lint\tgate  '), 'the lint gate')
  const { memory } = addGoal(emptyMemory(), { text: 'Lint gate passes', team: T1, at: AT, mint: () => 'goal-aaaaaa' })
  assert.equal(findGoalByText(memory, 'lint   GATE passes'), 'goal-aaaaaa')
  assert.equal(findGoalByText(memory, ''), undefined)
})

test('a new goal gets a fresh hash and is assigned to a pod', () => {
  const added = addGoal(emptyMemory(), { text: 'A', metric: 'm', team: T1, judgedBy: [T2], at: AT, mint: () => 'goal-111111' })
  assert.equal(added.hash, 'goal-111111')
  assert.equal(added.reused, false)
  assert.deepEqual(added.memory.goals['goal-111111'].judged_by, [T2])
  assert.deepEqual(added.memory.teams[T1].goals, ['goal-111111'])
  assert.equal(added.memory.goals['goal-111111'].history[0].event, 'minted')
})

test('the same goal text reuses its earlier hash and records the reuse', () => {
  const first = addGoal(emptyMemory(), { text: 'A', team: T1, at: AT, mint: () => 'goal-111111' })
  const again = addGoal(first.memory, { text: ' a ', team: T2, judgedBy: [T1], at: AT, mint: () => 'goal-222222' })
  assert.equal(again.hash, 'goal-111111')
  assert.equal(again.reused, true)
  assert.equal(again.memory.goals['goal-111111'].team, T2)
  assert.equal(again.memory.goals['goal-111111'].history.at(-1).event, 'reused')
  assert.equal(again.memory.goals['goal-222222'], undefined)
})

test('minting skips a hash that is already in memory', () => {
  const ids = ['goal-111111', 'goal-111111', 'goal-222222']
  const first = addGoal(emptyMemory(), { text: 'A', team: T1, at: AT, mint: () => ids.shift() })
  const second = addGoal(first.memory, { text: 'B', team: T1, at: AT, mint: () => ids.shift() })
  assert.equal(second.hash, 'goal-222222')
})

test('a pod cannot judge its own goal, and bad hashes are refused', () => {
  assert.throws(() => addGoal(emptyMemory(), { text: 'A', team: T1, judgedBy: [T1], at: AT }), /cannot judge/)
  assert.throws(() => addGoal(emptyMemory(), { text: 'A', team: 'pod-1', at: AT }), /not a team hash/)
  assert.throws(() => addGoal(emptyMemory(), { text: 'A', team: T1, judgedBy: 'team-4d5e6f', at: AT }), /list/)
})

test('assigning a goal moves it to another pod and keeps the old history', () => {
  const added = addGoal(emptyMemory(), { text: 'A', team: T1, at: AT, mint: () => 'goal-111111' })
  const moved = assignGoal(added.memory, { hash: 'goal-111111', team: T2, judgedBy: [T1], at: AT })
  assert.equal(moved.goals['goal-111111'].team, T2)
  assert.equal(moved.goals['goal-111111'].history.length, 2)
  assert.deepEqual(moved.teams[T1].goals, ['goal-111111'])
  assert.throws(() => assignGoal(added.memory, { hash: 'goal-999999', team: T2, at: AT }), /unknown goal/)
})

test('a changed goal gets a new hash and the old one points at it', () => {
  const added = addGoal(emptyMemory(), { text: 'A', team: T1, at: AT, mint: () => 'goal-111111' })
  const changed = supersedeGoal(added.memory, {
    hash: 'goal-111111', text: 'A, with the metric', team: T1, judgedBy: [T2], at: AT, mint: () => 'goal-333333',
  })
  assert.equal(changed.hash, 'goal-333333')
  assert.equal(changed.memory.goals['goal-111111'].status, 'superseded')
  assert.equal(changed.memory.superseded['goal-111111'], 'goal-333333')
})

test('a change back to an old goal text reuses that old hash', () => {
  const first = addGoal(emptyMemory(), { text: 'A', team: T1, at: AT, mint: () => 'goal-111111' })
  const second = supersedeGoal(first.memory, {
    hash: 'goal-111111', text: 'B', team: T1, judgedBy: [T2], at: AT, mint: () => 'goal-222222',
  })
  const back = supersedeGoal(second.memory, {
    hash: 'goal-222222', text: 'a', team: T2, judgedBy: [T1], at: AT, mint: () => 'goal-444444',
  })
  assert.equal(back.hash, 'goal-111111')
  assert.equal(back.reused, true)
})

test('superseding a goal with its own text is refused', () => {
  const added = addGoal(emptyMemory(), { text: 'A', team: T1, at: AT, mint: () => 'goal-111111' })
  assert.throws(
    () => supersedeGoal(added.memory, { hash: 'goal-111111', text: 'A', team: T1, at: AT }),
    /same hash/,
  )
})

test('the input memory is never changed', () => {
  const before = emptyMemory()
  addGoal(before, { text: 'A', team: T1, at: AT, mint: () => 'goal-111111' })
  assert.deepEqual(before, emptyMemory())
})

test('goal trailers are read from a commit message, without repeats', () => {
  const message = [
    'Fix the lint gate',
    '',
    'Goal: goal-3c9e41',
    'Goal: goal-7f0a12',
    'Goal: goal-3c9e41',
    'Not a trailer: goal-000000',
  ].join('\n')
  assert.deepEqual(goalTrailers(message), ['goal-3c9e41', 'goal-7f0a12'])
  assert.deepEqual(goalTrailers(undefined), [])
})
