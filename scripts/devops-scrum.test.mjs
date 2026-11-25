import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addGoal, assignWork, createSprint, emptyBoard, moveGoal, workInbox,
} from './devops-board.mjs'
import {
  clientSignOff, forwardReports, holdMeeting, leadSignOff, meetingsFor, reportsFor,
  scheduleMeeting, timebox,
} from './devops-scrum.mjs'

const AT = '2026-11-24T10:00:00Z'
const TEAM = 'team-a1a1a1'
const LEAD = 'agent-a1a1a1'
const DEV = 'agent-c0c0c0'
const GOAL = 'goal-111111'
const NEXT = 'goal-222222'
/** The Business Analyst: required at Planning, Refinement and the Sprint Review. */
const BA = 'agent-b1b1b1'

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


/** The board with QA's hand-off to Security and Security's clear sign-off on GOAL. */
const REVIEWER = 'agent-9a9a9a'
const QA_SEAT = 'agent-9b9b9b'
const SEC_SEAT = 'agent-9c9c9c'

function passedSecurity(board, options = {}) {
  const { result = 'clear', from = SEC_TEAM, qa = JUDGE_TEAM, signer = SEC_SEAT } = options
  const next = structuredClone(board)
  const done = payload => ({ payload: { goal: GOAL, ...payload }, state: 'done' })
  const count = Object.keys(next.handoffs).length
  const id = n => `handoff-${(count + n).toString(16).padStart(6, '0')}`
  const hand = (kind, agent, team, to) => ({ kind, from: { agent, team }, to: { team: to } })
  const reviewed = hand('review-to-qa', REVIEWER, 'team-9a9a9a', qa)
  const toSecurity = hand('qa-to-security', QA_SEAT, qa, SEC_TEAM)
  const verdict = { ...hand('security-signoff', signer, from, ''), result }
  next.handoffs[id(1)] = done(reviewed)
  next.handoffs[id(2)] = done(toSecurity)
  next.handoffs[id(3)] = done(verdict)
  return next
}

let counter = 0
const nextHex = () => {
  counter += 1
  return counter.toString(16).padStart(6, '0')
}

function meet(state, kind, options = {}) {
  const {
    minutes, attendees = [LEAD, DEV, BA], record, by = LEAD, team = TEAM, lead = LEAD,
  } = options
  const made = scheduleMeeting(state.board, {
    sprint: state.sprint, team, kind, lead, at: AT, mint: nextHex,
  })
  const board = holdMeeting(made.board, {
    id: made.id, by, minutes: minutes ?? timebox(kind, 1), attendees, record, at: AT,
  })
  return { ...state, board, id: made.id }
}

const PLAN = {
  businessAnalyst: BA,
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
  assert.throws(() => meet(planned, 'retro', { record: { actions: ['x'] } }), /after the joint/)
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

/** Minimal joint Sprint Review record (BA present; no demos required). */
const EMPTY_REVIEW = { businessAnalyst: BA, roster: [], feedback: [] }
const withBa = (attendees = [LEAD, BA]) => ({ attendees, record: EMPTY_REVIEW })

test('Daily Scrum records stress, strain and lead reallocations with the BA present', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const record = {
    businessAnalyst: BA,
    updates: [UPDATE],
    stress: [{ goal: GOAL, priority: 1, load: '2 seats open' }],
    strain: [{ goal: GOAL, reason: 'blocked on CI' }],
    reallocations: [{
      agent: DEV, to: GOAL, reason: 'priority 1 delayed', cost: 'defers polish',
    }],
  }
  const daily = meet(planned, 'daily', {
    minutes: 12, attendees: [LEAD, DEV, BA], record,
  })
  const held = daily.board.meetings[daily.id].record
  assert.equal(held.strain[0].goal, GOAL)
  assert.equal(held.reallocations[0].agent, DEV)
  assert.equal(held.businessAnalyst, BA)
  const missing = {
    minutes: 5, attendees: [LEAD, DEV], record: { ...record, updates: [UPDATE] },
  }
  assert.throws(() => meet(planned, 'daily', missing), /Business Analyst/)
})

test('a Daily Scrum reallocation onto a goal and job moves the seat\'s board work', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const given = assignWork(planned.board, {
    goal: NEXT, job: 'coder', agent: DEV, team: TEAM, description: 'polish', by: LEAD, at: AT,
  })
  const state = { ...planned, board: given.board }
  const move = {
    agent: DEV, to: 'parser fix', reason: 'priority 1 delayed',
    goal: GOAL, job: 'coder', from: given.id,
  }
  const record = { businessAnalyst: BA, updates: [UPDATE], reallocations: [move] }
  const daily = meet(state, 'daily', { minutes: 10, attendees: [LEAD, DEV, BA], record })
  const held = daily.board.meetings[daily.id].record.reallocations[0]
  assert.equal(daily.board.assignments[given.id].state, 'released')
  assert.deepEqual(workInbox(daily.board, DEV).map(w => [w.id, w.goal]), [[held.work, GOAL]])
  const half = { ...record, reallocations: [{ ...move, job: undefined, from: undefined }] }
  const halfMove = { minutes: 10, attendees: [LEAD, DEV, BA], record: half }
  const refused = () => meet(state, 'daily', halfMove)
  assert.throws(refused, /both its goal and its job/)
})

test('Planning, Refinement and the Sprint Review need the Business Analyst; Daily does not', () => {
  const { businessAnalyst, ...noBa } = PLAN
  assert.equal(businessAnalyst, BA)
  assert.throws(() => meet(sprintBoard(), 'planning', { record: noBa }),
    /Sprint Planning needs the Business Analyst/)
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  assert.equal(planned.board.meetings[planned.id].record.businessAnalyst, BA)
  const refine = { record: { items: [{ goal: NEXT, points: 3, priority: 1 }] } }
  assert.throws(() => meet(planned, 'refinement', refine), /Refinement needs the Business/)
  assert.throws(() => meet(planned, 'review', { record: { roster: [] } }), /Review needs the/)
  const daily = meet(planned, 'daily', { minutes: 5, record: { updates: [UPDATE] } })
  assert.equal(daily.board.meetings[daily.id].state, 'held')
})

test('Backlog Refinement sizes and orders upcoming goals, not ones already in the sprint', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const refine = item => meet(planned, 'refinement', {
    record: { businessAnalyst: BA, items: [item] },
  })
  const refined = refine({ goal: NEXT, points: 5, priority: 1 })
  assert.equal(refined.board.goals[NEXT].points, 5)
  assert.equal(refined.board.goals[NEXT].priority, 1)
  assert.throws(() => refine({ goal: GOAL, points: 3, priority: 1 }), /is in this sprint/)
  assert.throws(() => refine({ goal: NEXT, points: 21, priority: 1 }), /1 to 13/)
})

test('backlog goals carry the client objective, acceptance criteria, priority and owner', () => {
  const planned = meet(sprintBoard(), 'planning', { record: PLAN })
  const item = {
    goal: NEXT, points: 3, priority: 2, objective: 'Configs never crash the parser',
    acceptance: ['empty file parses', 'unknown key warns once'],
  }
  const refined = meet(planned, 'refinement', { record: { businessAnalyst: BA, items: [item] } })
  const row = refined.board.goals[NEXT]
  assert.equal(row.objective, 'Configs never crash the parser')
  assert.deepEqual(row.acceptance, ['empty file parses', 'unknown key warns once'])
  const bad = { businessAnalyst: BA, items: [{ ...item, acceptance: [''] }] }
  assert.throws(() => meet(planned, 'refinement', { record: bad }), /acceptance must be/)
  const added = {
    goal: 'goal-444444', title: 'Warn on unknown keys', priority: 1, owner: TEAM,
    acceptance: ['warns with the key name'],
  }
  const review = goals => ({ record: { ...EMPTY_REVIEW, newGoals: goals } })
  const reviewed = meet(planned, 'review', review([added]))
  assert.deepEqual(
    [reviewed.board.goals['goal-444444'].priority, reviewed.board.goals['goal-444444'].owner],
    [1, TEAM],
  )
  assert.throws(() => meet(planned, 'review', review([{ ...added, owner: 'A1' }])),
    /owner is a team hash/)
})

test('the joint Sprint Review demos Done features, records Q&A, and adds backlog goals', () => {
  let state = meet(judgedBoard(), 'planning', { record: PLAN })
  assert.throws(() => meet(state, 'review', {
    attendees: [LEAD, BA],
    record: { businessAnalyst: BA, roster: [{ agent: LEAD, goal: GOAL, kind: 'feature' }] },
  }), /not Done/)
  let board = state.board
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  const signoff = { sprint: state.sprint, goal: GOAL, lead: LEAD, at: AT }
  board = leadSignOff(passedSecurity(board), signoff).board
  state = { ...state, board }
  const newGoals = [{ goal: 'goal-333333', title: 'Warn on unknown keys' }]
  const record = {
    businessAnalyst: BA,
    attendance: [LEAD, DEV, BA],
    roster: [{ agent: DEV, goal: GOAL, kind: 'feature', surface: 'terminal' }],
    questions: [{
      from: BA, to: DEV, question: 'Does empty config warn?', answer: 'Yes, once.',
    }],
    feedback: ['Show the key name'],
    newGoals,
  }
  const empty = { ...record, roster: [] }
  assert.throws(() => meet(state, 'review', { attendees: [LEAD, DEV, BA], record: empty }),
    /lists every Done goal of the sprint.*goal-111111/)
  const reviewed = meet(state, 'review', { attendees: [LEAD, DEV, BA], record })
  assert.equal(reviewed.board.goals['goal-333333'].sprint, '')
  assert.equal(reviewed.board.meetings[reviewed.id].record.questions[0].answer, 'Yes, once.')
  assert.equal(reviewed.board.meetings[reviewed.id].record.roster[0].surface, 'terminal')
  const daily = { minutes: 5, attendees: [LEAD, DEV], record: { updates: [UPDATE] } }
  assert.throws(() => meet(reviewed, 'daily', daily), /in review/)
  assert.throws(() => meet(reviewed, 'review', {
    attendees: [LEAD, BA], record: { businessAnalyst: BA, roster: [] },
  }), /already held its joint/)
})

test('the retrospective agrees an improvement and closes the sprint after every team', () => {
  let state = meet(sprintBoard(), 'planning', { record: PLAN })
  state = meet(state, 'review', {
    attendees: [LEAD, BA],
    record: { businessAnalyst: BA, roster: [], feedback: [] },
  })
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
  assert.throws(() => meet(fresh, 'planning', madeUp), /is not in this sprint's allocation/)
  const bare = createSprint(emptyBoard(), { name: 'S', at: AT, mint: () => 'bbbbbb' })
  const plain = { sprint: bare.id, team: TEAM, kind: 'planning', lead: LEAD, at: AT }
  assert.throws(() => scheduleMeeting(bare.board, plain), /spin up the board first/)
})

test('the sprint closes only when every allocated team held its retrospective', () => {
  const both = sprintBoard(2, { two: true })
  let state = meet(both, 'planning', { record: PLAN })
  // One joint Sprint Review for the whole sprint (hosted by TEAM).
  state = meet(state, 'review', {
    attendees: [LEAD, BA],
    record: { businessAnalyst: BA, roster: [], feedback: [] },
  })
  state = meet(state, 'retro', { record: { actions: ['Cache it'] } })
  assert.equal(state.board.sprints[state.sprint].status, 'active', 'A2 has not held its retro')
  const other = {
    lead: OTHER_LEAD, by: OTHER_LEAD, attendees: [OTHER_LEAD, BA], team: OTHER_TEAM,
  }
  const plan2 = { ...PLAN, goals: [NEXT], tasks: [{ goal: NEXT, job: 'coder', title: 'Do it' }] }
  state = meet(state, 'planning', { ...other, record: plan2 })
  state = meet(state, 'retro', { ...other, record: { actions: ['Pair on CI'] } })
  assert.equal(state.board.sprints[state.sprint].status, 'closed')
})

test('a closed sprint holds no more meetings, even ones scheduled before it closed', () => {
  let state = meet(sprintBoard(), 'planning', { record: PLAN })
  state = meet(state, 'review', {
    attendees: [LEAD, BA],
    record: { businessAnalyst: BA, roster: [], feedback: [] },
  })
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
  const existing = {
    businessAnalyst: BA,
    roster: [],
    feedback: [],
    newGoals: [{ goal: NEXT, title: 'x' }],
  }
  assert.throws(() => meet(planned, 'review', {
    attendees: [LEAD, BA], record: existing,
  }), /not a new goal/)
})

test('a team plans only its own streams, not another team\'s', () => {
  const both = sprintBoard(2, { two: true })
  const theirs = { ...PLAN, goals: [NEXT], tasks: [{ goal: NEXT, job: 'coder', title: 'x' }] }
  assert.throws(() => meet(both, 'planning', { record: theirs }), /not this team's work/)
})

const JUDGE_TEAM = 'team-f6f6f6'
const JUDGE_LEAD = 'agent-f6f6f6'
const SEC_TEAM = 'team-e7e7e7'
const SEC_LEAD = 'agent-e7e7e7'

/** A sprint with TEAM building GOAL and a judging team (J1) that judges it. */
function judgedBoard() {
  const state = sprintBoard()
  const teams = state.board.allocations[state.sprint].teams
  const judgeRow = (name, team, lead, job) => ({
    name, team, lead, goals: [], judged_goals: [GOAL], review_goals: [], qa_goals: [],
    security_goals: [], [`${job}_goals`]: [GOAL], authors: null, judges: [],
  })
  teams.push(judgeRow('Q1', JUDGE_TEAM, JUDGE_LEAD, 'qa'))
  teams.push(judgeRow('S1', SEC_TEAM, SEC_LEAD, 'security'))
  return state
}

test('every team lead runs its own meetings, the judging team\'s lead too', () => {
  const judge = {
    team: JUDGE_TEAM, lead: JUDGE_LEAD, by: JUDGE_LEAD, attendees: [JUDGE_LEAD, BA],
  }
  const tasks = [{ goal: GOAL, job: 'qa', title: 'QA it' }]
  const record = { businessAnalyst: BA, sprintGoal: 'Judge the parser fix', goals: [GOAL], tasks }
  const planned = meet(judgedBoard(), 'planning', { ...judge, record })
  assert.equal(planned.board.meetings[planned.id].state, 'held')
  const updates = [{ agent: JUDGE_LEAD, done: 'plan', today: 'test' }]
  const daily = meet(planned, 'daily', { ...judge, minutes: 10, record: { updates } })
  assert.equal(daily.board.meetings[daily.id].state, 'held')
})

test('the sprint waits for the judging team\'s retrospective too', () => {
  let state = meet(judgedBoard(), 'planning', { record: PLAN })
  state = meet(state, 'review', withBa())
  state = meet(state, 'retro', { record: { actions: ['Cache it'] } })
  assert.equal(state.board.sprints[state.sprint].status, 'active')
})

test('a goal is done only by its own team lead\'s sign-off, after security', () => {
  const planned = meet(judgedBoard(), 'planning', { record: PLAN })
  let board = planned.board
  for (const step of ['ready', 'in_progress', 'review', 'qa']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  const sign = lead => leadSignOff(board, { sprint: planned.sprint, goal: GOAL, lead, at: AT })
  assert.throws(() => sign(LEAD), /must pass security first/)
  board = moveGoal(board, { goal: GOAL, state: 'security', at: AT })
  assert.throws(() => sign(LEAD), /no review hand-off to QA \(team-f6f6f6\)/)
  board = passedSecurity(board, { result: 'blocked' })
  assert.throws(() => sign(LEAD), /latest Security sign-off after QA.s hand-off must be clear/)
  board = passedSecurity(board)
  const direct = () => moveGoal(board, { goal: GOAL, state: 'done', at: AT })
  assert.throws(direct, /team lead's sign-off/)
  assert.throws(() => sign(JUDGE_LEAD), /only team-a1a1a1's lead/)
  assert.throws(() => sign(DEV), /only team-a1a1a1's lead/)
  const done = sign(LEAD).board
  assert.equal(done.goals[GOAL].state, 'done')
  assert.equal(done.goals[GOAL].done_by, LEAD)
})

test('the lead reports done to Orchestration, which reports to the person', () => {
  const planned = meet(judgedBoard(), 'planning', { record: PLAN })
  let board = planned.board
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  const signed = leadSignOff(passedSecurity(board), {
    sprint: planned.sprint, goal: GOAL, lead: LEAD, at: AT, mint: () => 'abcabc',
  })
  assert.equal(signed.id, 'report-abcabc')
  const waiting = reportsFor(signed.board, { state: 'to_orchestration' })
  assert.deepEqual(waiting.map(r => [r.goal, r.team, r.lead]), [[GOAL, TEAM, LEAD]])
  const forward = summary => ({ sprint: planned.sprint, ids: [signed.id], summary, at: AT })
  assert.throws(() => forwardReports(signed.board, forward(' ')),
    /needs a summary/)
  const told = forwardReports(signed.board, {
    sprint: planned.sprint, ids: [signed.id], summary: 'Parser fix done', at: AT,
  })
  assert.equal(reportsFor(told, { state: 'to_person' }).length, 1)
  const again = () => forwardReports(told, forward('x'))
  assert.throws(again, /already passed to the person/)
})

test('an allocated goal cannot be walked to done another way, nor start as done', () => {
  const planned = meet(judgedBoard(), 'planning', { record: PLAN })
  const out = () => addGoal(planned.board, { goal: GOAL, at: AT })
  assert.throws(out, /stays there/)
  assert.throws(() => addGoal(planned.board, { goal: 'goal-777777', state: 'done', at: AT }),
    /bad starting state/)
})

test('the judging team plans only judging work on the goals it judges', () => {
  const judge = {
    team: JUDGE_TEAM, lead: JUDGE_LEAD, by: JUDGE_LEAD, attendees: [JUDGE_LEAD, BA],
  }
  const tasks = [{ goal: GOAL, job: 'coder', title: 'Rewrite it' }]
  const record = { businessAnalyst: BA, sprintGoal: 'Judge it', goals: [GOAL], tasks }
  assert.throws(() => meet(judgedBoard(), 'planning', { ...judge, record }), /does not belong here/)
})

/** GOAL walked to the security step in a judged sprint. */
function atSecurity() {
  const planned = meet(judgedBoard(), 'planning', { record: PLAN })
  let board = planned.board
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  return { sprint: planned.sprint, board }
}

test('a verdict before the last send-back, or overturned since, no longer counts', () => {
  const { sprint, board } = atSecurity()
  const sign = b => leadSignOff(b, { sprint, goal: GOAL, lead: LEAD, at: AT })
  const cleared = passedSecurity(board)
  const sentBack = structuredClone(cleared)
  const back = { goal: GOAL, kind: 'security-send-back' }
  sentBack.handoffs['handoff-ffffff'] = { payload: back, state: 'done' }
  assert.throws(() => sign(sentBack), /since its last send-back/)
  const overturned = passedSecurity(cleared, { result: 'blocked' })
  assert.throws(() => sign(overturned), /must be clear/)
  assert.equal(sign(passedSecurity(overturned)).board.goals[GOAL].state, 'done')
})

test('only the QA and Security teams the allocation names count for the sign-off', () => {
  const { sprint, board } = atSecurity()
  const sign = b => leadSignOff(b, { sprint, goal: GOAL, lead: LEAD, at: AT })
  const fromSecurity = /must be clear, from team-e7e7e7/
  assert.throws(() => sign(passedSecurity(board, { from: 'team-0b0b0b' })), fromSecurity)
  assert.throws(() => sign(passedSecurity(board, { from: TEAM })), fromSecurity)
  const fromQa = /hand-off to QA \(team-f6f6f6\)|QA hand-off from team-f6f6f6/
  assert.throws(() => sign(passedSecurity(board, { qa: 'team-0b0b0b' })), fromQa)
})

test('no verdict counts from a seat that wrote the goal, or from its own lead', () => {
  const { sprint, board } = atSecurity()
  const written = structuredClone(board)
  written.handoffs['handoff-c0c0c0'] = {
    payload: { goal: GOAL, kind: 'coder-to-review', from: { agent: DEV, team: TEAM } },
    state: 'done',
  }
  const sign = b => leadSignOff(b, { sprint, goal: GOAL, lead: LEAD, at: AT })
  assert.throws(() => sign(passedSecurity(written, { signer: DEV })), /must be clear/)
  assert.throws(() => sign(passedSecurity(written, { signer: LEAD })), /must be clear/)
  assert.equal(sign(passedSecurity(written)).board.goals[GOAL].state, 'done')
})

test('the sign-off also needs the goal reviewed into QA since its last send-back', () => {
  const { sprint, board } = atSecurity()
  const unreviewed = passedSecurity(board)
  for (const [id, h] of Object.entries(unreviewed.handoffs)) {
    if (h.payload.kind === 'review-to-qa') delete unreviewed.handoffs[id]
  }
  const sign = () => leadSignOff(unreviewed, { sprint, goal: GOAL, lead: LEAD, at: AT })
  assert.throws(sign, /no review hand-off to QA/)
})

test('a coder who received the research counts as an author, so it cannot judge', () => {
  const { sprint, board } = atSecurity()
  const briefed = structuredClone(board)
  briefed.handoffs['handoff-d0d0d0'] = {
    payload: {
      goal: GOAL, kind: 'research-to-coder', from: { agent: 'agent-0f0f0f' }, to: { agent: DEV },
    },
    state: 'done',
  }
  const sign = b => leadSignOff(b, { sprint, goal: GOAL, lead: LEAD, at: AT })
  assert.throws(() => sign(passedSecurity(briefed, { signer: DEV })), /must be clear/)
})

test('the verdicts count only in order: review into QA, then QA to Security, then a clear', () => {
  const { sprint, board } = atSecurity()
  const sign = b => leadSignOff(b, { sprint, goal: GOAL, lead: LEAD, at: AT })
  const shuffled = passedSecurity(board)
  const ids = Object.keys(shuffled.handoffs)
  const rows = ids.map(id => shuffled.handoffs[id])
  const [review, toSecurity, clear] = rows.slice(-3)
  const reorder = order => {
    const next = structuredClone(board)
    order.forEach((h, i) => { next.handoffs[`handoff-e0e0e${i}`] = structuredClone(h) })
    return next
  }
  assert.throws(() => sign(reorder([clear, review, toSecurity])), /must be clear/)
  assert.throws(() => sign(reorder([toSecurity, review, clear])), /after its review/)
  assert.equal(sign(reorder([review, toSecurity, clear])).board.goals[GOAL].state, 'done')
})

test('a closing sprint returns its unfinished goals to the backlog, free for later', () => {
  let state = meet(sprintBoard(), 'planning', { record: PLAN })
  state = meet(state, 'review', withBa())
  state = meet(state, 'retro', { record: { actions: ['Cache it'] } })
  assert.equal(state.board.sprints[state.sprint].status, 'closed')
  assert.equal(state.board.goals[GOAL].sprint, '')
  assert.equal(state.board.goals[GOAL].history.at(-1).event, 'returned')
  assert.equal(state.board.goals[GOAL].state, 'backlog', 'the next sprint judges it from the start')
  let walked = state.board
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    walked = moveGoal(walked, { goal: GOAL, state: step, at: AT })
  }
  const done = () => moveGoal(walked, { goal: GOAL, state: 'done', at: AT })
  assert.throws(done, /only its team lead's sign-off/, 'still done only by sign-off')
  const next = createSprint(state.board, { name: 'Sprint 2', at: AT, mint: () => 'cccccc' })
  const moved = addGoal(next.board, { goal: GOAL, sprint: next.id, at: AT })
  assert.equal(moved.goals[GOAL].sprint, next.id)
})

test('a QA hand-off after Security\'s clear needs a new clear', () => {
  const { sprint, board } = atSecurity()
  const cleared = passedSecurity(board)
  const again = structuredClone(cleared)
  const qaAgain = Object.values(cleared.handoffs).find(h => h.payload.kind === 'qa-to-security')
  again.handoffs['handoff-f1f1f1'] = structuredClone(qaAgain)
  const sign = () => leadSignOff(again, { sprint, goal: GOAL, lead: LEAD, at: AT })
  assert.throws(sign, /must be clear/)
})

test('a goal returned from a closed sprint is judged again: old verdicts do not count', () => {
  let state = meet(judgedBoard(), 'planning', { record: PLAN })
  let board = structuredClone(state.board)
  board.handoffs['handoff-c1c1c1'] = {
    payload: { goal: GOAL, kind: 'coder-to-review', from: { agent: DEV, team: TEAM } },
    state: 'done',
  }
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  state = { ...state, board: passedSecurity(board) }
  const close = (s, team, lead, { holdReview = false } = {}) => {
    const who = { team, lead, by: lead, attendees: [lead, BA] }
    const tasks = [{ goal: GOAL, job: 'qa', title: 'x' }]
    const record = { businessAnalyst: BA, sprintGoal: 'x', goals: [GOAL], tasks }
    let next = team === TEAM ? s : meet(s, 'planning', { ...who, record })
    if (holdReview) next = meet(next, 'review', { ...who, record: EMPTY_REVIEW })
    return meet(next, 'retro', { ...who, record: { actions: ['x'] } })
  }
  // One joint review (hosted by TEAM), then each team's retro.
  state = close(state, TEAM, LEAD, { holdReview: true })
  state = close(state, JUDGE_TEAM, JUDGE_LEAD)
  state = close(state, SEC_TEAM, SEC_LEAD)
  assert.equal(state.board.sprints[state.sprint].status, 'closed')
  const next = createSprint(state.board, { name: 'Sprint 2', at: AT, mint: () => 'dddddd' })
  const allocation = structuredClone(state.board.allocations[state.sprint])
  let again = addGoal(next.board, { goal: GOAL, sprint: next.id, at: AT })
  again.allocations[next.id] = allocation
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    again = moveGoal(again, { goal: GOAL, state: step, at: AT })
  }
  const sign = b => leadSignOff(b, { sprint: next.id, goal: GOAL, lead: LEAD, at: AT })
  assert.throws(() => sign(again), /no review hand-off to QA/)
  const byAuthor = passedSecurity(again, { signer: DEV })
  assert.throws(() => sign(byAuthor), /must be clear/, 'an author stays an author after a return')
  assert.equal(sign(passedSecurity(again)).board.goals[GOAL].state, 'done')
})

test('the client signs a goal done without the seat checks; each skip is recorded', () => {
  const planned = meet(judgedBoard(), 'planning', { record: PLAN })
  const board = moveGoal(planned.board, { goal: GOAL, state: 'ready', at: AT })
  const sign = more => clientSignOff(board, {
    sprint: planned.sprint, goal: GOAL, at: AT, mint: () => 'cdecde', ...more,
  })
  assert.throws(() => sign({ reason: 'demo today' }), /reason and the risk/)
  const signed = sign({ reason: 'demo today', risk: 'no QA run' })
  const goal = signed.board.goals[GOAL]
  assert.equal(goal.state, 'done')
  assert.equal(goal.done_by, 'client')
  assert.equal(goal.history.at(-1).event, 'client_signoff')
  const [report] = reportsFor(signed.board, { state: 'to_orchestration' })
  assert.equal(report.signed_by, 'client')
  assert.equal(report.lead, LEAD)
  assert.match(report.override.skipped[0], /has not passed security \(it is ready\)/)
  assert.match(report.override.skipped[1], /no review hand-off to QA/)
  const again = () => clientSignOff(signed.board, {
    sprint: planned.sprint, goal: GOAL, reason: 'x', risk: 'y', at: AT,
  })
  assert.throws(again, /already done/)
})

test('a client sign-off after every check passed records an empty skip list', () => {
  const planned = meet(judgedBoard(), 'planning', { record: PLAN })
  let board = planned.board
  for (const step of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    board = moveGoal(board, { goal: GOAL, state: step, at: AT })
  }
  const signed = clientSignOff(passedSecurity(board), {
    sprint: planned.sprint, goal: GOAL, reason: 'ship it', risk: 'none known', at: AT,
  })
  assert.deepEqual(signed.board.goals[GOAL].history.at(-1).override.skipped, [])
})
