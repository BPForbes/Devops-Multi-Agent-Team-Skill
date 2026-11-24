import assert from 'node:assert/strict'
import test from 'node:test'

import { addGoal, createSprint, emptyBoard, moveGoal } from './devops-board.mjs'
import { holdMeeting, meetingsFor, scheduleMeeting, timebox } from './devops-scrum.mjs'

const AT = '2026-11-24T10:00:00Z'
const TEAM = 'team-a1a1a1'
const LEAD = 'agent-a1a1a1'
const DEV = 'agent-c0c0c0'
const GOAL = 'goal-111111'
const NEXT = 'goal-222222'

const OTHER_TEAM = 'team-d4d4d4'
const OTHER_LEAD = 'agent-d4d4d4'

/** A sprint whose allocation names TEAM (led by LEAD) and, with `two`, a second team. */
function sprintBoard(weeks = 2, { two = false } = {}) {
  const sprint = { name: 'Sprint 1', weeks, at: AT, mint: () => 'aaaaaa' }
  const opened = createSprint(emptyBoard(), sprint)
  let board = addGoal(opened.board, { goal: GOAL, title: 'Parser', at: AT })
  board = addGoal(board, { goal: NEXT, title: 'Next', at: AT })
  const row = (name, team, lead, goals) => ({
    name, team, lead, goals, authors: { streams: [name] }, judges: [],
  })
  const teams = [row('A1', TEAM, LEAD, two ? [GOAL] : [GOAL, NEXT])]
  if (two) teams.push(row('A2', OTHER_TEAM, OTHER_LEAD, [NEXT]))
  board.allocations[opened.id] = { task: 'fix', teams }
  return { sprint: opened.id, board }
}

let counter = 0
const nextHex = () => {
  counter += 1
  return counter.toString(16).padStart(6, '0')
}

function meet(state, kind, options = {}) {
  const { minutes, attendees = [LEAD, DEV], record, by = LEAD, team = TEAM, lead = LEAD } = options
  const made = scheduleMeeting(state.board, {
    sprint: state.sprint, team, kind, lead, at: AT, mint: nextHex,
  })
  const board = holdMeeting(made.board, {
    id: made.id, by, minutes: minutes ?? timebox(kind, 1), attendees, record, at: AT,
  })
  return { ...state, board, id: made.id }
}

const PLAN = {
  sprintGoal: 'Parser takes an empty config',
  goals: [GOAL],
  tasks: [{ goal: GOAL, job: 'coder', title: 'Fix it' }],
}
const UPDATE = { agent: DEV, done: 'repro', today: 'fix' }

test('Sprint Planning sets the goal, pulls the chosen goals in, and breaks them into tasks', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN, minutes: 180 })
  assert.equal(planned.board.goals[GOAL].sprint, planned.sprint)
  assert.equal(planned.board.sprints[planned.sprint].team_goals[TEAM], PLAN.sprintGoal)
  assert.equal(planned.board.meetings[planned.id].record.tasks.length, 1)
  const noTasks = { record: { ...PLAN, tasks: [] } }
  assert.throws(() => meet(sprintBoard(), 'planning', noTasks), /has no task/)
})

test('each meeting keeps its timebox: planning 2 hours a sprint week, a daily 15 minutes', () => {
  assert.equal(timebox('planning', 2), 240)
  assert.equal(timebox('daily', 4), 15)
  const long = { record: PLAN, minutes: 121 }
  assert.throws(() => meet(sprintBoard(1), 'planning', long), /timeboxed to 120/)
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const late = { minutes: 16, record: { updates: [UPDATE] } }
  assert.throws(() => meet(planned, 'daily', late), /15 minutes/)
})

test('meetings come in order: planning first, review once, the retrospective last', () => {
  const fresh = sprintBoard()
  assert.throws(() => meet(fresh, 'daily', { record: { updates: [] } }), /Sprint Planning first/)
  const planned = meet(fresh, 'planning', { record: PLAN })
  assert.throws(() => meet(planned, 'planning', { record: PLAN }), /already held/)
  assert.throws(() => meet(planned, 'retro', { record: { actions: ['x'] } }), /after the review/)
})

test('a Daily Scrum records each developer and collects the blockers', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const updates = [{ ...UPDATE, blockers: ['needs the CI token'] }]
  const daily = meet(planned, 'daily', { minutes: 12, record: { updates } })
  const blockers = daily.board.meetings[daily.id].record.blockers
  assert.deepEqual(blockers, [{ agent: DEV, blocker: 'needs the CI token' }])
  const stranger = { minutes: 5, record: { updates: [{ ...UPDATE, agent: 'agent-0f0f0f' }] } }
  assert.throws(() => meet(planned, 'daily', stranger), /not in this Daily Scrum/)
})

test('Backlog Refinement sizes and orders upcoming goals, not ones already in the sprint', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const refine = item => meet(planned, 'refinement', { record: { items: [item] } })
  const refined = refine({ goal: NEXT, points: 5, priority: 1 })
  assert.equal(refined.board.goals[NEXT].points, 5)
  assert.equal(refined.board.goals[NEXT].priority, 1)
  assert.throws(() => refine({ goal: GOAL, points: 3, priority: 1 }), /is in this sprint/)
  assert.throws(() => refine({ goal: NEXT, points: 21, priority: 1 }), /1 to 13/)
})

test('the Sprint Review demos only Done goals and adds feedback goals to the backlog', () => {
  let state = meet(sprintBoard(), 'planning', { record: PLAN })
  assert.throws(() => meet(state, 'review', { record: { demo: [GOAL] } }), /not Done/)
  let board = state.board
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security', 'done']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  state = { ...state, board }
  const newGoals = [{ goal: 'goal-333333', title: 'Warn on unknown keys' }]
  const record = { demo: [GOAL], feedback: ['Show the key name'], newGoals }
  const reviewed = meet(state, 'review', { record })
  assert.equal(reviewed.board.goals['goal-333333'].sprint, '')
  const daily = { minutes: 5, record: { updates: [UPDATE] } }
  assert.throws(() => meet(reviewed, 'daily', daily), /in review/)
})

test('the retrospective agrees an improvement and closes the sprint after every team', () => {
  let state = meet(sprintBoard(), 'planning', { record: PLAN })
  state = meet(state, 'review', { record: { demo: [], feedback: [] } })
  assert.throws(() => meet(state, 'retro', { record: { actions: [] } }), /one improvement or more/)
  const record = { wentWell: ['fast review'], bottlenecks: ['CI queue'], actions: ['Cache it'] }
  const retro = meet(state, 'retro', { record })
  assert.equal(retro.board.sprints[retro.sprint].status, 'closed')
  assert.equal(meetingsFor(retro.board, { sprint: retro.sprint, team: TEAM }).length, 3)
  const another = { sprint: retro.sprint, team: TEAM, kind: 'daily', lead: LEAD, at: AT }
  assert.throws(() => scheduleMeeting(retro.board, another), /closed/)
})

test('only the team lead holds a meeting, with agent hashes for the attendees', () => {
  const fresh = sprintBoard()
  assert.throws(() => meet(fresh, 'planning', { record: PLAN, by: DEV }), /only the team lead/)
  const bad = { record: PLAN, attendees: [LEAD, '../../etc'] }
  assert.throws(() => meet(fresh, 'planning', bad), /agent hashes/)
})

test('only the lead the allocation names runs a team\'s meetings, for an allocated team', () => {
  const fresh = sprintBoard()
  const stranger = { record: PLAN, lead: DEV, by: DEV, attendees: [DEV] }
  assert.throws(() => meet(fresh, 'planning', stranger), /only team-a1a1a1's lead/)
  const madeUp = { record: PLAN, team: 'team-e5e5e5' }
  assert.throws(() => meet(fresh, 'planning', madeUp), /no work in this sprint's allocation/)
  const bare = createSprint(emptyBoard(), { name: 'S', at: AT, mint: () => 'bbbbbb' })
  const plain = { sprint: bare.id, team: TEAM, kind: 'planning', lead: LEAD, at: AT }
  assert.throws(() => scheduleMeeting(bare.board, plain), /spin up the board first/)
})

test('the sprint closes only when every allocated team held its retrospective', () => {
  const both = sprintBoard(2, { two: true })
  let state = meet(both, 'planning', { record: PLAN })
  state = meet(state, 'review', { record: { demo: [], feedback: [] } })
  state = meet(state, 'retro', { record: { actions: ['Cache it'] } })
  assert.equal(state.board.sprints[state.sprint].status, 'active', 'A2 has not held its retro')
  const other = { lead: OTHER_LEAD, by: OTHER_LEAD, attendees: [OTHER_LEAD], team: OTHER_TEAM }
  const plan2 = { ...PLAN, goals: [NEXT], tasks: [{ goal: NEXT, job: 'coder', title: 'Do it' }] }
  state = meet(state, 'planning', { ...other, record: plan2 })
  state = meet(state, 'review', { ...other, record: { demo: [], feedback: [] } })
  state = meet(state, 'retro', { ...other, record: { actions: ['Pair on CI'] } })
  assert.equal(state.board.sprints[state.sprint].status, 'closed')
})

test('a closed sprint holds no more meetings, even ones scheduled before it closed', () => {
  let state = meet(sprintBoard(), 'planning', { record: PLAN })
  state = meet(state, 'review', { record: { demo: [], feedback: [] } })
  const early = scheduleMeeting(state.board, {
    sprint: state.sprint, team: TEAM, kind: 'daily', lead: LEAD, at: AT, mint: nextHex,
  })
  state = { ...state, board: early.board }
  state = meet(state, 'retro', { record: { actions: ['Cache it'] } })
  const late = { id: early.id, by: LEAD, minutes: 5, attendees: [LEAD], record: {}, at: AT }
  assert.throws(() => holdMeeting(state.board, late), /is closed/)
})

test('planning takes only backlog goals, and a review adds only new goals', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const again = { ...PLAN, goals: [GOAL] }
  const unknown = { record: { ...again, goals: ['goal-999999'] } }
  assert.throws(() => meet(sprintBoard(), 'planning', unknown), /not a backlog goal/)
  const existing = { demo: [], feedback: [], newGoals: [{ goal: NEXT, title: 'x' }] }
  assert.throws(() => meet(planned, 'review', { record: existing }), /not a new goal/)
})

test('a team plans only its own streams, not another team\'s', () => {
  const both = sprintBoard(2, { two: true })
  const theirs = { ...PLAN, goals: [NEXT], tasks: [{ goal: NEXT, job: 'coder', title: 'x' }] }
  assert.throws(() => meet(both, 'planning', { record: theirs }), /another team's stream/)
})
