import assert from 'node:assert/strict'
import test from 'node:test'

import {
  needsAttention, openBoard, teamIntake, teamMove, teamSignOff,
} from './devops-teams.mjs'

const TEAM = 'team-1a2b3c'
const MEMBERS = [
  { agent: 'agent-lead', role: 'manager' },
  { agent: 'agent-dev', role: 'assignee' },
  { agent: 'agent-sec', role: 'security' },
]
const body = id => ({
  item: id, goal: 'goal-7f0a12', job: 'coder', acceptance: ['tests pass'], points: 3,
})
const open = () => openBoard({ team: TEAM, members: MEMBERS }).board

test('a team board needs a lead, known roles and no repeated member', () => {
  assert.equal(openBoard({ team: TEAM, members: [{ agent: 'a', role: 'assignee' }] }).ok, false)
  assert.equal(openBoard({ team: TEAM, members: [{ agent: 'a', role: 'boss' }] }).ok, false)
  const twice = [{ agent: 'a', role: 'manager' }, { agent: 'a', role: 'assignee' }]
  assert.equal(openBoard({ team: TEAM, members: twice }).ok, false)
})

test('only a member may add an item, and it lives on that team board', () => {
  const stranger = teamIntake(open(), 'agent-x', body('item-0000a1'))
  assert.equal(stranger.ok, false)
  const added = teamIntake(open(), 'agent-dev', body('item-0000a1'))
  assert.equal(added.ok, true)
  assert.equal(added.board.items[0].team, TEAM)
})

test('only a security member signs an item off, and only in review', () => {
  let board = teamIntake(open(), 'agent-dev', body('item-0000a2')).board
  board.items[0] = { ...board.items[0], state: 'in_security' }
  assert.equal(teamSignOff(board, 'agent-dev', { item: 'item-0000a2' }).ok, false)
  const signed = teamSignOff(board, 'agent-sec', { item: 'item-0000a2' })
  assert.equal(signed.ok, true)
  assert.equal(signed.board.items[0].security_signoff.role, 'security')
})

test('the lead reads needs-attention; a member does not', () => {
  const board = teamIntake(open(), 'agent-dev', body('item-0000a1')).board
  board.items[0] = { ...board.items[0], state: 'blocked' }
  assert.equal(needsAttention(board, 'agent-dev').ok, false)
  const view = needsAttention(board, 'agent-lead')
  assert.equal(view.ok, true)
  assert.deepEqual(view.attention.map(a => [a.id, a.kind]), [['item-0000a1', 'blocked']])
})

test('needs-attention lists items awaiting security or the human, not finished work', () => {
  let board = open()
  board = teamIntake(board, 'agent-dev', body('item-0000a1')).board
  board = teamIntake(board, 'agent-dev', body('item-0000a2')).board
  board.items[0] = { ...board.items[0], state: 'in_security' }
  board.items[1] = { ...board.items[1], state: 'done' }
  const kinds = needsAttention(board, 'agent-lead').attention.map(a => a.kind)
  assert.deepEqual(kinds, ['awaiting_signoff'])
})

test('a lead may hold several roles, and each role acts where its rules allow', () => {
  const members = [
    { agent: 'agent-lead', roles: ['manager', 'coder', 'researcher'] },
    { agent: 'agent-rev', roles: ['reviewer'] },
    { agent: 'agent-sec', roles: ['security'] },
  ]
  const opened = openBoard({ team: TEAM, members })
  assert.equal(opened.ok, true)
  assert.deepEqual(opened.board.members[0].roles, ['manager', 'coder', 'researcher'])
  let board = teamIntake(opened.board, 'agent-lead', body('item-0000b1')).board
  board.items[0] = { ...board.items[0], state: 'assigned' }
  const started = teamMove(board, 'agent-lead', { item: 'item-0000b1', to: 'in_progress' })
  assert.equal(started.ok, true, 'a coder moves items as the assignee')
})

test('a role that is not known is refused, and a member needs at least one role', () => {
  const wizard = [{ agent: 'a', roles: ['manager', 'wizard'] }]
  assert.equal(openBoard({ team: TEAM, members: wizard }).ok, false)
  assert.equal(openBoard({ team: TEAM, members: [{ agent: 'a', roles: [] }] }).ok, false)
  assert.equal(openBoard({ team: TEAM, members: [{ agent: 'a', roles: ['manager'] }] }).ok, true)
})

test('a board written with one role string still acts as before', () => {
  const legacy = {
    team: TEAM, members: [{ agent: 'agent-lead', role: 'manager' }], items: [], refusals: [],
  }
  assert.equal(teamIntake(legacy, 'agent-lead', body('item-0000c1')).ok, true)
  assert.equal(needsAttention(legacy, 'agent-lead').ok, true)
})

test('a member without the manager role cannot read the lead view', () => {
  const opened = openBoard({ team: TEAM, members: [
    { agent: 'agent-lead', roles: ['manager'] },
    { agent: 'agent-coder', roles: ['coder'] },
  ] }).board
  assert.equal(needsAttention(opened, 'agent-coder').ok, false)
  assert.equal(needsAttention(opened, 'agent-lead').ok, true)
})
