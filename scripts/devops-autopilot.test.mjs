import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  allocateAutopilot, draftAutopilot, measureTask, steerAutopilot,
} from './devops-autopilot.mjs'
import { OPEN_WORK_LIMIT, emptyBoard, workInbox } from './devops-board.mjs'
import { buildMindMap } from './devops-mindmap.mjs'

const FILES = {
  'core/util.ts': 'export function slugify(text: string) {\n  return text.toLowerCase()\n}\n',
  'core/login.ts': 'export function loginUser(token: string) {\n  return token\n}\n',
  'core/util.test.ts': "import { slugify } from './util'\nslugify('A')\n",
  'api/routes.ts': "import { slugify } from '../core/util'\n"
    + "export function routeFor(name: string) {\n  return '/' + slugify(name)\n}\n",
  'web/page.ts': 'export function pageTitle() {\n  return 1\n}\n',
}

function mapOf(files = FILES) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-autopilot-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return buildMindMap(dir).map
}

const BA = 'agent-0b0b0b'
const AT = '2026-11-27T00:00:00Z'
const counter = () => {
  let n = 0
  return () => {
    n += 1
    return n.toString(16).padStart(6, '0')
  }
}
const draftOf = (tasks, map = mapOf()) => draftAutopilot(map, {
  title: 'Sprint 1', ba: BA, tasks, mint: counter(),
})
const steerAs = (by, draft, task, decision) => steerAutopilot(draft, {
  by, decisions: [{ task, ...decision }],
})

test('a task is measured from its wording, or from the scope it names', () => {
  const map = mapOf()
  const worded = measureTask(map, { title: 'Make slugify safe for unicode' })
  assert.deepEqual(worded.modules, ['core'])
  assert.equal(worded.matchedBy, 'wording')
  assert.equal(worded.owner, 'core')
  const scoped = measureTask(map, { title: 'Titles', scope: { files: ['web/page.ts'] } })
  assert.deepEqual(scoped.modules, ['web'])
  assert.equal(scoped.files, 1)
  const risky = measureTask(map, { title: 'Fix the login token check in loginUser' })
  assert.ok(risky.risks.includes('auth'))
})

test('a task the map cannot place, or that spans modules, waits for the BA', () => {
  const draft = draftOf([
    { title: 'Something unrelated entirely' },
    { title: 'Routes and pages', scope: { modules: ['api', 'web'] } },
  ])
  assert.deepEqual(draft.questions.map(q => q.ask), ['scope', 'owner'])
  assert.equal(draft.questions[1].suggested, 'api')
  assert.throws(() => allocateAutopilot(emptyBoard(), draft, { by: BA, at: AT, mint: counter() }),
    /answer first/)
})

test('only the BA steers, and an owner must be a module the task touches', () => {
  const draft = draftOf([{ title: 'Routes and pages', scope: { modules: ['api', 'web'] } }])
  const task = draft.tasks[0].id
  assert.throws(() => steerAs('agent-0c0c0c', draft, task, { owner: 'api' }),
    /only the Business Analyst/)
  assert.throws(() => steerAs(BA, draft, task, { owner: 'core' }), /touches/)
  const steered = steerAs(BA, draft, task, { owner: 'api', priority: 1 })
  assert.deepEqual(steered.questions, [])
  assert.equal(steered.plan.teams[0].module, 'api')
})

test('one team per module; coders scale with its tasks up to the cap the BA sets', () => {
  const four = ['slugify a', 'slugify b', 'slugify c', 'slugify d'].map(title => ({ title }))
  const draft = draftOf([...four, { title: 'Use pageTitle' }])
  const authoring = draft.plan.teams.filter(team => team.authors)
  const coders = authoring.map(team => [team.module, team.authors.coder])
  assert.deepEqual(coders, [['core', 3], ['web', 1]])
  const capped = steerAutopilot(draft, { by: BA, caps: { core: 2 } })
  const core = capped.plan.teams.find(team => team.module === 'core')
  assert.equal(core.authors.coder, 2)
  const judges = capped.plan.teams.flatMap(team => team.judges)
  const reviewOfCore = judges.find(j => j.of.includes(core.name))
  assert.ok(reviewOfCore.reviewer <= 2, 'review seats follow the coders')
})

test('allocation mints seats, records the BA\'s specs, and hands out work within limits', () => {
  const tasks = ['slugify a', 'slugify b', 'slugify c', 'slugify d'].map(title => ({ title }))
  tasks[0] = { ...tasks[0], objective: 'Safe slugs', acceptance: ['unicode is kept'], priority: 1 }
  let draft = draftOf([...tasks, { title: 'Use pageTitle' }, { title: 'Later slugify' }])
  const later = draft.tasks.at(-1).id
  const decisions = [{ task: later, defer: true }]
  draft = steerAutopilot(draft, { by: BA, caps: { core: 1 }, decisions })
  const asOther = { by: 'agent-0c0c0c', at: AT, mint: counter() }
  assert.throws(() => allocateAutopilot(emptyBoard(), draft, asOther),
    /only the Business Analyst/)
  const out = allocateAutopilot(emptyBoard(), draft, { by: BA, at: AT, mint: counter() })
  const first = Object.values(out.board.goals).find(goal => goal.title === 'slugify a')
  assert.equal(first.objective, 'Safe slugs')
  assert.equal(first.priority, 1)
  assert.ok(Object.values(out.board.goals).every(goal => goal.title !== 'Later slugify'))
  for (const seat of out.launch.seats) {
    const open = workInbox(out.board, seat.agent).length
    assert.ok(open <= OPEN_WORK_LIMIT, `${seat.agent} is not overstretched`)
  }
  const waiting = tasks.length - OPEN_WORK_LIMIT
  assert.equal(out.overflow.A1.length, waiting, 'past capacity waits for the lead')
  const leads = out.launch.seats.filter(seat => seat.roles.includes('manager'))
  const coreLead = leads.find(seat => seat.module === 'core')
  assert.deepEqual(coreLead.roles, ['manager', 'coder'])
  assert.equal(coreLead.subagent, 'devops-multi-agent-team:devops-coder')
  assert.equal(coreLead.env.DEVOPS_SEAT, coreLead.agent)
  const brief = out.launch.briefs.find(b => b.lead === coreLead.agent)
  assert.match(brief.goals[0].spec, /objective: Safe slugs \| acceptance: unicode is kept/)
  assert.ok(out.teamBoards.every(board => board.members[0].roles.includes('manager')))
  assert.equal(out.launch.ba.agent, BA)
})
