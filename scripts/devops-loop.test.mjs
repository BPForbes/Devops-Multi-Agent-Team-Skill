import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SPRINT_LIMIT, addReport, clientDecision, nextStep, nextTasks, pauseLoop, recordAllocation,
  signReport, sprintReport, startLoop,
} from './devops-loop.mjs'

const BA = 'agent-0b0b0b'
const AT = '2026-11-27T00:00:00Z'
const DONE = 'goal-0000a1'
const LEFT = 'goal-0000a2'
const NEW = 'goal-0000a3'

const SPRINT = 'sprint-000001'
const goal = extra => ({ title: 'g', history: [], ...extra })
const meeting = (kind, record) => ({ sprint: SPRINT, kind, state: 'held', record })
const returned = [{ event: 'returned', from: SPRINT }]
const half = {
  title: 'Half done', state: 'backlog', sprint: '', objective: 'Safe slugs', priority: 2,
}

/** A board whose sprint closed with one goal done and approved, one returned, one new from review. */
function closedBoard() {
  const signoffs = [{ step: 'client' }]
  return {
    sprints: { [SPRINT]: { name: 'Sprint 1', status: 'closed', closed: AT, goals: [DONE] } },
    goals: {
      [DONE]: goal({ state: 'done', sprint: SPRINT, signoffs }),
      [LEFT]: goal({ ...half, history: returned }),
      [NEW]: goal({ title: 'From feedback', state: 'backlog', sprint: '' }),
    },
    meetings: {
      'meeting-000001': meeting('review', { feedback: ['faster please'], newGoals: [NEW] }),
      'meeting-000002': meeting('retro', { actions: ['pair more'] }),
    },
  }
}

const running = (limit) => recordAllocation(startLoop({ ba: BA, limit, at: AT }), {
  sprint: 'sprint-000001', carry: {}, scopes: { [LEFT]: { modules: ['core'] } }, deferred: [],
})

test('the Orchestrator\'s report on a closed sprint lists what happened and what is next', () => {
  const report = sprintReport(closedBoard(), { sprint: 'sprint-000001', at: AT })
  assert.deepEqual(report.done, [DONE])
  assert.deepEqual(report.approved, [DONE])
  assert.deepEqual(report.unfinished, [LEFT])
  assert.deepEqual(report.feedback, ['faster please'])
  assert.deepEqual(report.newGoals, [NEW])
  assert.deepEqual(report.actions, ['pair more'])
  assert.equal(report.backlog, 2)
})

test('the loop waits for the BA\'s signature, then drafts the next sprint from the backlog', () => {
  const board = closedBoard()
  let loop = running()
  assert.equal(nextStep(loop, board).reason, 'sprint-running')
  loop = addReport(loop, sprintReport(board, { sprint: 'sprint-000001', at: AT }))
  assert.equal(nextStep(loop, board).reason, 'ba-signature')
  assert.throws(() => signReport(loop, { sprint: 'sprint-000001', by: 'agent-0c0c0c', at: AT }),
    /only the Business Analyst/)
  loop = signReport(loop, { sprint: 'sprint-000001', by: BA, notes: 'on track', at: AT })
  const step = nextStep(loop, board)
  assert.equal(step.action, 'draft')
  assert.equal(step.title, 'Sprint 2')
  const half = step.tasks.find(task => task.goal === LEFT)
  assert.deepEqual(half.scope, { modules: ['core'] }, 'a goal keeps the scope it had')
  assert.equal(half.objective, 'Safe slugs')
  assert.ok(step.tasks.some(task => task.goal === NEW))
})

test('a question for the client pauses the loop until the client continues', () => {
  const board = closedBoard()
  let loop = addReport(running(), sprintReport(board, { sprint: 'sprint-000001', at: AT }))
  loop = signReport(loop, {
    sprint: 'sprint-000001', by: BA, askClient: 'Keep the old API?', at: AT,
  })
  assert.equal(nextStep(loop, board).reason, 'ask-client')
  loop = clientDecision(loop, { decision: 'continue', note: 'yes, keep it', at: AT })
  assert.equal(loop.reports['sprint-000001'].client.note, 'yes, keep it')
  assert.equal(nextStep(loop, board).action, 'draft')
})

test('the client being satisfied ends the loop', () => {
  const board = closedBoard()
  let loop = addReport(running(), sprintReport(board, { sprint: 'sprint-000001', at: AT }))
  loop = clientDecision(loop, { decision: 'satisfied', at: AT })
  assert.equal(loop.state, 'satisfied')
  assert.equal(nextStep(loop, board).action, 'none')
  assert.throws(() => clientDecision(loop, { decision: 'continue', at: AT }), /already satisfied/)
})

test('the loop pauses at the sprint limit, and continue allows more sprints', () => {
  const board = closedBoard()
  let loop = addReport(running(1), sprintReport(board, { sprint: 'sprint-000001', at: AT }))
  loop = signReport(loop, { sprint: 'sprint-000001', by: BA, at: AT })
  assert.deepEqual(nextStep(loop, board), { action: 'pause', reason: 'limit' })
  loop = clientDecision(pauseLoop(loop, 'limit'), { decision: 'continue', at: AT })
  assert.equal(loop.limit, 1 + DEFAULT_SPRINT_LIMIT)
  assert.equal(nextStep(loop, board).action, 'draft')
})

test('with nothing left to do, the loop pauses for the client', () => {
  const board = closedBoard()
  for (const id of [LEFT, NEW]) board.goals[id].state = 'done'
  let loop = addReport(running(), sprintReport(board, { sprint: 'sprint-000001', at: AT }))
  loop = signReport(loop, { sprint: 'sprint-000001', by: BA, at: AT })
  assert.deepEqual(nextStep(loop, board), { action: 'pause', reason: 'nothing-left' })
  assert.deepEqual(nextTasks(board, loop), [])
})
