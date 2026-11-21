import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  agentsOnJob,
  freeAgents,
  independenceOk,
  isAgentId,
  isItemId,
  isJob,
  isTeamId,
  itemRecord,
  mintAgentId,
  mintItemId,
  mintTeamId,
  teamsOf,
} from './devops-ids.mjs'

test('minted ids match the team/agent/item forms', () => {
  assert.ok(isTeamId(mintTeamId()))
  assert.ok(isAgentId(mintAgentId()))
  assert.ok(isItemId(mintItemId()))
  assert.equal(isTeamId('agent-0a0a0a'), false)
  assert.equal(isAgentId('team-0a0a0a'), false)
})

test('jobs are the closed vocabulary', () => {
  assert.ok(isJob('coder'))
  assert.ok(isJob('idle'))
  assert.equal(isJob('Coder'), false)
  assert.equal(isJob('author'), false)
})

test('independence refuses own agent, own handle and own pod', () => {
  const judge = { agent: 'agent-aaaaaa', team: 'team-111111', handle: 'h1' }
  assert.equal(
    independenceOk(judge, [{ agent: 'agent-bbbbbb', team: 'team-222222' }]).ok,
    true,
  )
  assert.match(
    independenceOk(judge, [{ agent: 'agent-aaaaaa', team: 'team-111111' }]).reason,
    /own work/,
  )
  assert.match(
    independenceOk(judge, [{
      agent: 'agent-bbbbbb', team: 'team-222222', handle: 'h1',
    }]).reason,
    /own handle/,
  )
  assert.match(
    independenceOk(judge, [{ agent: 'agent-bbbbbb', team: 'team-111111' }]).reason,
    /own pod/,
  )
})

test('independence uses team history and fails closed when incomplete', () => {
  const judge = {
    agent: 'agent-aaaaaa',
    team: 'team-999999',
    teams: ['team-111111'],
  }
  assert.deepEqual(teamsOf(judge).sort(), ['team-111111', 'team-999999'])
  assert.match(
    independenceOk(judge, [{ agent: 'agent-bbbbbb', team: 'team-111111' }]).reason,
    /own pod: team-111111/,
  )
  assert.match(
    independenceOk({ agent: 'agent-aaaaaa' }, [{
      agent: 'agent-bbbbbb', team: 'team-222222',
    }]).reason,
    /incomplete: judge teams/,
  )
  assert.match(
    independenceOk(
      { agent: 'agent-aaaaaa', team: 'team-111111' },
      [{ agent: 'agent-bbbbbb' }],
    ).reason,
    /incomplete: author teams/,
  )
})

test('freeAgents and agentsOnJob support allocation', () => {
  const registry = [
    {
      agent: 'agent-aaaaaa', team: 'team-1', initial_job: 'coder',
      current_job: 'idle',
    },
    {
      agent: 'agent-bbbbbb', team: 'team-1', initial_job: 'coder',
      current_job: 'coder',
    },
    {
      agent: 'agent-cccccc', team: 'team-2', initial_job: 'reviewer',
      current_job: 'idle',
    },
  ]
  assert.deepEqual(
    freeAgents(registry, { initial: 'coder' }).map(r => r.agent),
    ['agent-aaaaaa'],
  )
  assert.deepEqual(
    agentsOnJob(registry, 'coder').map(r => r.agent),
    ['agent-bbbbbb'],
  )
})

test('free --want returns agents on that job through the CLI', () => {
  const registry = JSON.stringify([
    { agent: 'agent-aaaaaa', team: 'team-1', initial_job: 'coder', current_job: 'coder' },
    { agent: 'agent-bbbbbb', team: 'team-2', initial_job: 'reviewer', current_job: 'reviewer' },
  ])
  const script = fileURLToPath(new URL('./devops-ids.mjs', import.meta.url))
  const out = execFileSync(process.execPath, [
    script, 'free', '--registry', registry, '--want', 'coder',
  ], { encoding: 'utf8' })
  assert.deepEqual(JSON.parse(out).map(r => r.agent), ['agent-aaaaaa'])
})

test('itemRecord requires notes and a well-formed item id', () => {
  const row = itemRecord({
    item: 'item-abcdef',
    kind: 'handoff',
    notes: 'Coder to Reviewer for login rate limit',
    authors: ['agent-aaaaaa'],
    team: 'team-111111',
    path: 'devops-skill/thoughts/non-final/handoff-agent-aaaaaa.md',
  })
  assert.equal(row.item, 'item-abcdef')
  assert.equal(row.notes.includes('rate limit'), true)
  assert.throws(() => itemRecord({ item: 'bad', kind: 'x', notes: 'n' }))
  assert.throws(() => itemRecord({
    item: 'item-abcdef', kind: 'x', notes: '  ',
  }))
})
