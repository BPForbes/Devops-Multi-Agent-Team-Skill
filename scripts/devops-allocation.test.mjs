import assert from 'node:assert/strict'
import test from 'node:test'

import { emptyBoard } from './devops-board.mjs'
import { validateEnvelope } from './devops-envelopes.mjs'
import {
  groupStreams, parallelPlan, planAllocation, spinUp, streamPoints,
} from './devops-allocation.mjs'

const AT = '2026-11-24T10:00:00Z'

test('a one-file fix: one coder, then one reviewer, QA and Security, each on its own team', () => {
  const plan = planAllocation({ task: 'Fix the typo', streams: [{ name: 'readme', files: 1 }] })
  assert.deepEqual(plan.teams.map(t => t.name), ['A1', 'R1', 'Q1', 'S1'])
  assert.equal(plan.teams[0].authors.coder, 1)
  assert.equal(plan.teams[0].authors.researcher, 0)
  for (const judge of plan.teams.slice(1)) assert.equal(judge.authors, null, judge.name)
  const seats = j => [j.of, j.reviewer, j.qa, j.security]
  const judges = plan.teams.slice(1).map(t => t.judges.map(seats))
  assert.deepEqual(judges, [[[['A1'], 1, 0, 0]], [[['A1'], 0, 1, 0]], [[['A1'], 0, 0, 1]]])
  const four = { teams: 4, researcher: 0, coder: 1, reviewer: 1, qa: 1, security: 1 }
  assert.deepEqual(plan.totals, four)
})

test('dependent streams share a team; the others get their own and judge each other', () => {
  const plan = planAllocation({
    task: 'Add sign-in',
    streams: [
      { name: 'api', files: 12, modules: 2, risks: ['auth'], newSurface: true },
      { name: 'client', files: 6, dependsOn: ['api'] },
      { name: 'docs', files: 3 },
    ],
  })
  const authored = plan.teams.filter(t => t.authors !== null).map(t => t.authors.streams)
  assert.deepEqual(authored, [['api', 'client'], ['docs']])
  assert.deepEqual(plan.teams.map(t => t.name), ['A1', 'A2', 'Q1', 'S1'])
  const judged = plan.teams.map(t => t.judges.map(j => j.of))
  assert.deepEqual(judged, [[['A2']], [['A1']], [['A1', 'A2']], [['A1', 'A2']]])
  const [qa, security] = [plan.teams[2].judges[0], plan.teams[3].judges[0]]
  assert.equal(plan.teams[3].authors, null, 'S1 authors nothing')
  assert.deepEqual([qa.reviewer, qa.security, security.qa], [0, 0, 0])
  assert.equal(security.security, 3, 'one, plus auth, for A1; one for A2')
  const api = plan.teams[0]
  assert.equal(api.authors.coder, 2)
  assert.equal(api.authors.researcher, 1)
  assert.equal(plan.teams[1].judges[0].qa, 0, 'final QA comes from Q1')
  assert.ok(api.authors.reasons.some(r => r.startsWith('api: ')))
})

test('no team judges work it authored, and no job goes past three seats', () => {
  const streams = Array.from({ length: 5 }, (_, i) => ({
    name: `s${i}`, files: 30, risks: ['auth', 'gate'], unknowns: true, newSurface: true,
    dependsOn: i > 0 ? ['s0'] : [],
  }))
  const plan = planAllocation({ task: 'Big', streams })
  for (const team of plan.teams) {
    for (const judged of team.judges) assert.ok(!judged.of.includes(team.name))
    for (const seats of [team.authors ?? {}, ...team.judges]) {
      for (const job of ['researcher', 'coder', 'reviewer', 'qa', 'security']) {
        assert.ok((seats[job] ?? 0) <= 3, `${team.name} ${job}`)
      }
    }
  }
})

test('points come from what was measured, each with its reason', () => {
  const scored = streamPoints({ name: 'x', files: 7, modules: 3, risks: ['infra'], unknowns: true })
  assert.equal(scored.points, 2 + 2 + 1 + 1)
  assert.ok(scored.reasons.includes('+1 cause or repro not known yet'))
  const streams = [{ name: 'a' }, { name: 'b', dependsOn: ['a'] }, { name: 'c' }]
  assert.equal(groupStreams(streams).length, 2)
})

test('research the plan cannot use is refused', () => {
  assert.throws(() => planAllocation({ task: 'x', streams: [] }), /one stream or more/)
  assert.throws(() => planAllocation({ streams: [{ name: 'a' }, { name: 'a' }] }), /unique/)
  assert.throws(() => planAllocation({ streams: [{ name: 'a', risks: ['nope'] }] }), /unknown risk/)
  const dangling = { streams: [{ name: 'a', dependsOn: ['b'] }] }
  assert.throws(() => planAllocation(dangling), /unknown stream/)
})

test('the plan overlaps the work; the verdicts stay in order: QA, Security, push-ok', () => {
  const plan = parallelPlan()
  assert.ok(plan.together.some(step => step.includes('as soon as its diff lands')))
  assert.match(plan.inOrder[1], /QA PASS on the final HEAD\^\{tree\}/)
  assert.match(plan.inOrder[2], /Security CLEAR on that same tree, after QA/)
  assert.match(plan.inOrder[3], /push-ok/)
})

test('spin-up opens the sprint, backlogs each stream, and hands each lead its planning', () => {
  const plan = planAllocation({ task: 'Fix', streams: [{ name: 'parser', files: 2 }] })
  let n = 0
  const mint = () => ['aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'eeeeee'][n++]
  const teams = {
    A1: { team: 'team-a1a1a1', lead: 'agent-a1a1a1' },
    R1: { team: 'team-b2b2b2', lead: 'agent-b2b2b2' },
    Q1: { team: 'team-c3c3c3', lead: 'agent-c3c3c3' },
    S1: { team: 'team-d4d4d4', lead: 'agent-d4d4d4' },
  }
  const up = spinUp(emptyBoard(), plan, {
    name: 'Sprint 1', weeks: 2, goals: { parser: 'goal-111111' }, teams, at: AT, mint,
  })
  assert.equal(up.sprint, 'sprint-aaaaaa')
  assert.equal(up.board.sprints[up.sprint].weeks, 2)
  assert.equal(up.board.goals['goal-111111'].sprint, '', 'the stream waits on the backlog')
  assert.deepEqual(up.meetings.map(m => m.team), Object.values(teams).map(t => t.team))
  assert.equal(up.board.meetings['meeting-bbbbbb'].state, 'scheduled')
  const record = up.board.allocations[up.sprint].teams
  assert.deepEqual(record.map(t => t.goals), [['goal-111111'], [], [], []])
  const by = job => record.map(t => t[job])
  assert.deepEqual(by('review_goals'), [[], ['goal-111111'], [], []])
  assert.deepEqual(by('qa_goals'), [[], [], ['goal-111111'], []])
  assert.deepEqual(by('security_goals'), [[], [], [], ['goal-111111']])
  assert.equal(up.setup.length, 4, 'each team lead gets a setup payload')
  const [setup] = up.setup
  assert.deepEqual([setup.kind, setup.to, setup.body.settings],
    ['seat.setup', 'agent-a1a1a1', { DEVOPS_SEAT: 'agent-a1a1a1', DEVOPS_TEAM: 'team-a1a1a1' }])
  assert.equal(validateEnvelope(setup).ok, true)
  const versions = { node: '22.0.0', plugin: '0.1.0' }
  const pinned = spinUp(emptyBoard(), plan, {
    name: 'S', goals: { parser: 'goal-111111' }, teams, at: AT, versions,
  })
  assert.deepEqual(pinned.setup[0].body.versions, versions)
  const missing = { name: 'S', goals: {}, teams, at: AT }
  assert.throws(() => spinUp(emptyBoard(), plan, missing), /needs a goal hash/)
})

test('with several teams, final QA and Security come from a team that wrote nothing', () => {
  const streams = [{ name: 'a', files: 2 }, { name: 'b', files: 2 }, { name: 'c', files: 2 }]
  const plan = planAllocation({ task: 'x', streams })
  const writers = plan.teams.filter(t => t.authors !== null).map(t => t.name)
  const finals = plan.teams.flatMap(t => t.judges.filter(j => j.qa > 0 || j.security > 0)
    .map(j => ({ team: t.name, of: j.of })))
  assert.deepEqual(finals, [{ team: 'Q1', of: writers }, { team: 'S1', of: writers }])
})
