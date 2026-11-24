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
