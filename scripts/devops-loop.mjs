// The sprint loop (references/sprint-loop.md): after the first sprint,
// sprints follow one another until the client is satisfied. Each closed
// sprint gets the Orchestrator's report, the Business Analyst signs it, and
// the client signs off on it. Pure rules, plus the command the client's
// /devops satisfied and /devops continue run.
import path from 'node:path'

import { isMain } from './devops-main.mjs'
import { UNFENCED, projectPath, updateJson } from './devops-store.mjs'

/** The loop file, relative to the project folder. */
export const LOOP_FILE = path.join('.devops', 'loop.json')
/** Sprints the loop runs before it pauses to ask the client. */
export const DEFAULT_SPRINT_LIMIT = 10
/** The most sprints a loop may be set to run before it pauses. */
export const MAX_SPRINT_LIMIT = 100

const need = (ok, message) => {
  if (!ok) throw new Error(message)
}
const filled = text => typeof text === 'string' && text.trim() !== ''

/** A new loop, started when the first sprint is allocated. */
export function startLoop({ ba, limit = DEFAULT_SPRINT_LIMIT, at }) {
  need(Number.isInteger(limit) && limit >= 1 && limit <= MAX_SPRINT_LIMIT,
    `the sprint limit is 1 to ${MAX_SPRINT_LIMIT}`)
  return {
    state: 'running', ba, limit, started: at, sprints: [], reports: {},
    carry: {}, scopes: {}, deferred: [], pause: null,
  }
}

/**
 * Records an allocated sprint: its teams carry over to the next one, each
 * goal keeps its scope for the next draft, and deferred tasks wait for it.
 */
export function recordAllocation(loop, { sprint, carry, scopes, deferred }) {
  const sprints = loop.sprints.includes(sprint) ? loop.sprints : [...loop.sprints, sprint]
  return { ...loop, sprints, carry, scopes: { ...loop.scopes, ...scopes }, deferred }
}

const meetingsOf = (board, sprint, kind) => Object.values(board.meetings ?? {})
  .filter(m => m.sprint === sprint && m.kind === kind && m.state === 'held')

const returnedFrom = (goal, sprint) => (goal.history ?? [])
  .some(event => event.event === 'returned' && event.from === sprint)

/**
 * The Orchestrator's report on a closed sprint: the goals done and the ones
 * the client approved, the ones that go back to the backlog, the Sprint
 * Review's feedback and new goals, the retrospectives' actions, and what the
 * next sprint can draw on.
 */
export function sprintReport(board, { sprint, at }) {
  const row = board.sprints[sprint]
  need(row?.status === 'closed', `sprint ${sprint} is not closed`)
  const goals = Object.entries(board.goals)
  const done = row.goals
  const approved = done.filter(goal => board.goals[goal]?.signoffs?.at(-1)?.step === 'client')
  const reviews = meetingsOf(board, sprint, 'review').map(m => m.record ?? {})
  return {
    sprint, name: row.name, closed: row.closed, made_by: 'orchestration', made_at: at,
    done, approved,
    unfinished: goals.filter(([, g]) => returnedFrom(g, sprint)).map(([id]) => id),
    feedback: reviews.flatMap(record => record.feedback ?? []),
    newGoals: reviews.flatMap(record => record.newGoals ?? []),
    actions: meetingsOf(board, sprint, 'retro').flatMap(m => m.record?.actions ?? []),
    backlog: goals.filter(([, g]) => g.state === 'backlog' && !g.sprint).length,
    ba: null, client: null,
  }
}

/** Adds the report of a sprint that just closed. */
export function addReport(loop, report) {
  need(loop.reports[report.sprint] === undefined, `sprint ${report.sprint} already has a report`)
  return { ...loop, reports: { ...loop.reports, [report.sprint]: report } }
}

const latestReport = loop => loop.reports[loop.sprints.findLast(s => loop.reports[s])]

/**
 * The Business Analyst signs the sprint report: its view of how the vision
 * was carried out. A question for the client (`askClient`), when the vision
 * is unclear, pauses the loop until the client answers.
 */
export function signReport(loop, { sprint, by, notes, askClient, at }) {
  need(by === loop.ba, `only the Business Analyst (${loop.ba}) signs the sprint report`)
  const report = loop.reports[sprint]
  need(report !== undefined, `sprint ${sprint} has no report yet`)
  need(report.ba === null, `the report on ${sprint} is already signed`)
  const ba = { by, at, notes: filled(notes) ? notes.trim() : '' }
  const next = { ...loop, reports: { ...loop.reports, [sprint]: { ...report, ba } } }
  if (!filled(askClient)) return next
  ba.askClient = askClient.trim()
  return { ...next, pause: { reason: 'ask-client', sprint, question: ba.askClient } }
}

/**
 * The client signs off on the latest report: `satisfied` ends the loop;
 * `continue` lifts a pause (answering the BA's question in `note`) and, past
 * the sprint limit, allows `more` sprints.
 */
export function clientDecision(loop, { decision, note, more, at }) {
  need(decision === 'satisfied' || decision === 'continue', 'the client is satisfied or continues')
  need(loop.state !== 'satisfied', 'the client is already satisfied; the loop has ended')
  const report = latestReport(loop)
  const client = { decision, at, ...(filled(note) ? { note: note.trim() } : {}) }
  const signed = report ? { [report.sprint]: { ...report, client } } : {}
  const reports = { ...loop.reports, ...signed }
  if (decision === 'satisfied') return { ...loop, reports, state: 'satisfied', pause: null }
  const extra = more ?? (loop.pause?.reason === 'limit' ? DEFAULT_SPRINT_LIMIT : 0)
  need(Number.isInteger(extra) && extra >= 0, 'more is a whole number of sprints')
  return { ...loop, reports, pause: null, limit: loop.limit + extra }
}

/**
 * The tasks for the next sprint: every backlog goal (unfinished work, review
 * feedback and the client's new approach), with the client's fields and the
 * scope it had, then the tasks deferred so far.
 */
export function nextTasks(board, loop) {
  const backlog = Object.entries(board.goals)
    .filter(([, goal]) => goal.state === 'backlog' && !goal.sprint)
    .map(([id, goal]) => ({
      title: goal.title, goal: id,
      ...(goal.objective ? { objective: goal.objective } : {}),
      ...(goal.acceptance ? { acceptance: goal.acceptance } : {}),
      ...(goal.priority ? { priority: goal.priority } : {}),
      ...(loop.scopes[id] ? { scope: loop.scopes[id] } : {}),
    }))
  return [...backlog, ...loop.deferred]
}

/**
 * What the loop does next: nothing once the client is satisfied, wait while
 * paused or while the latest report is unsigned, pause at the sprint limit
 * or when no task is left, and otherwise draft the next sprint.
 */
export function nextStep(loop, board) {
  if (loop.state === 'satisfied') return { action: 'none', reason: 'the client is satisfied' }
  if (loop.pause) return { action: 'wait', reason: loop.pause.reason }
  const report = latestReport(loop)
  const open = loop.sprints.at(-1)
  if (report?.sprint !== open) return { action: 'wait', reason: 'sprint-running' }
  if (report.ba === null) return { action: 'wait', reason: 'ba-signature' }
  if (loop.sprints.length >= loop.limit) return { action: 'pause', reason: 'limit' }
  const tasks = nextTasks(board, loop)
  if (tasks.length === 0) return { action: 'pause', reason: 'nothing-left' }
  return { action: 'draft', tasks, title: `Sprint ${loop.sprints.length + 1}` }
}

/** Pauses the loop for the client, with why. */
export function pauseLoop(loop, reason) {
  return { ...loop, pause: { reason, sprint: loop.sprints.at(-1) } }
}

const DECIDED = {
  satisfied: 'The client is satisfied: the sprint loop has ended.',
  continue: 'The loop continues; Orchestration starts the next sprint with loop_advance.',
}

function main(argv) {
  const [command, decision, ...rest] = argv
  const opt = name => {
    const at = rest.indexOf(name)
    return at === -1 ? undefined : rest[at + 1]
  }
  if (command !== 'decide' || opt('--dest') === undefined) {
    console.error('Usage: devops-loop decide satisfied|continue [--note TEXT] [--more N] '
      + '--dest DIR')
    return 1
  }
  const more = opt('--more') === undefined ? undefined : Number(opt('--more'))
  const file = projectPath(opt('--dest'), LOOP_FILE)
  updateJson(file, null, loop => {
    need(loop !== null, 'no sprint loop yet: it starts when the first sprint is allocated')
    const at = new Date().toISOString()
    return clientDecision(loop, { decision, note: opt('--note'), more, at })
  }, UNFENCED)
  console.log(DECIDED[decision])
  return 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-loop: ${error.message}`)
    process.exitCode = 2
  }
}
