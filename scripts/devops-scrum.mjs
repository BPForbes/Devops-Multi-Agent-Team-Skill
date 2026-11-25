// Scrum meetings on the goal board (see references/scrum-meetings.md).
// Pure functions over the board.
import {
  addGoal, assignWork, mintId, need, normalizeBoard, openThread, releaseWork,
} from './devops-board.mjs'
import { isAgentId, isGoalId, isJob, isTeamId } from './devops-ids.mjs'

/** Minutes per sprint week each kind may take at most; a daily scrum is 15 minutes flat. */
const MINUTES_PER_WEEK = Object.freeze({ planning: 120, refinement: 60, review: 60, retro: 45 })
const DAILY_MINUTES = 15
/** Story points a refined item may carry: the planning scale. */
const POINTS_MAX = 13
const MEETING_RE = /^meeting-[0-9a-f]{6}$/

/** The meeting kinds, in the order a sprint holds them. */
export const MEETING_KINDS = Object.freeze(['planning', 'daily', 'refinement', 'review', 'retro'])

const filled = value => String(value ?? '').trim() !== ''
const nonEmpty = list => Array.isArray(list) && list.length > 0

function texts(list, what) {
  const ok = Array.isArray(list) && list.every(t => typeof t === 'string' && filled(t))
  need(ok, `${what} must be a list of text`)
  return list.map(t => t.trim())
}

/** The most minutes a meeting of `kind` may take in a sprint of `weeks` weeks. */
export function timebox(kind, weeks) {
  return kind === 'daily' ? DAILY_MINUTES : MINUTES_PER_WEEK[kind] * weeks
}

function held(board, sprint, team) {
  return Object.values(normalizeBoard(board).meetings)
    .filter(m => m.sprint === sprint && m.team === team && m.state === 'held')
    .map(m => m.kind)
}

/** True when any team has held the joint Sprint Review for this sprint. */
function sprintHasReview(board, sprint) {
  return Object.values(normalizeBoard(board).meetings)
    .some(m => m.sprint === sprint && m.kind === 'review' && m.state === 'held')
}

/** Refuses a meeting out of order: planning first; one joint review per sprint; retro after it. */
function checkOrder(kinds, kind, { board, sprint } = {}) {
  const has = k => kinds.includes(k)
  if (kind === 'planning') need(!has('planning'), 'this team already held its Sprint Planning')
  else need(has('planning'), 'hold Sprint Planning first')
  if (kind === 'daily' || kind === 'refinement') {
    need(!sprintHasReview(board, sprint), 'the sprint is in review')
  }
  if (kind === 'review') {
    need(!sprintHasReview(board, sprint), 'this sprint already held its joint Sprint Review')
  }
  if (kind === 'retro') {
    need(sprintHasReview(board, sprint) && !has('retro'),
      'the retrospective comes once, after the joint Sprint Review')
  }
}

/** Every team the sprint's allocation names, authoring and judging, with its lead. */
function allocatedTeams(next, sprint) {
  const allocation = next.allocations[sprint]
  need(allocation !== undefined, `sprint ${sprint} has no allocation; spin up the board first`)
  return allocation.teams
}

/** Refuses a sprint that does not exist or is closed. */
function openSprint(next, sprint) {
  need(next.sprints[sprint] !== undefined, `unknown sprint: ${sprint}`)
  need(next.sprints[sprint].status !== 'closed', `sprint ${sprint} is closed`)
}

/**
 * Puts a meeting on the board for one allocated team in one sprint. `lead`
 * must be the lead the allocation recorded for that team. Returns { id, board }.
 */
export function scheduleMeeting(board, { sprint, team, kind, lead, at, mint }) {
  const next = normalizeBoard(structuredClone(board))
  openSprint(next, sprint)
  need(MEETING_KINDS.includes(kind), `meeting kind is one of ${MEETING_KINDS.join(', ')}`)
  need(isTeamId(team) && isAgentId(lead), 'a meeting names a team hash and its lead')
  const row = allocatedTeams(next, sprint).find(t => t.team === team)
  need(row !== undefined, `team ${team} is not in this sprint's allocation`)
  need(row.lead === lead, `only ${team}'s lead (${row.lead}) runs its meetings`)
  const id = mintId('meeting', next.meetings, mint)
  need(MEETING_RE.test(id), 'bad meeting id')
  next.meetings[id] = { sprint, team, kind, lead, state: 'scheduled', scheduled_at: at }
  return { id, board: next }
}

/** Refuses planning tasks that name no chosen goal, no job or no title, and goals with no task. */
function checkTasks(tasks, chosen) {
  need(Array.isArray(tasks), 'Sprint Planning breaks the work into tasks')
  for (const t of tasks) {
    need(chosen.includes(t.goal) && isJob(t.job) && filled(t.title),
      'a task names a chosen goal, a job and a title')
  }
  for (const g of chosen) need(tasks.some(t => t.goal === g), `goal ${g} has no task`)
}

/** Sprint Planning: the sprint goal, the backlog goals chosen, and each goal's tasks. */
function planning(next, meeting, record) {
  requireBa(meeting, record, 'Sprint Planning')
  need(filled(record.sprintGoal), 'Sprint Planning sets a sprint goal')
  const chosen = record.goals
  need(nonEmpty(chosen), 'Sprint Planning chooses one backlog goal or more')
  const seat = allocatedTeams(next, meeting.sprint).find(t => t.team === meeting.team)
  const own = [...(seat.goals ?? []), ...(seat.judged_goals ?? [])]
  for (const g of chosen) {
    const where = next.goals[g]?.sprint
    need(isGoalId(g) && (where === '' || where === meeting.sprint), `${g} is not a backlog goal`)
    need(own.includes(g), `${g} is not this team's work; plan the goals it builds or judges`)
  }
  checkTasks(record.tasks, chosen)
  const judging = new Set(['reviewer', 'qa', 'security'])
  for (const t of record.tasks) {
    const judged = !(seat.goals ?? []).includes(t.goal)
    need(!judged || judging.has(t.job),
      `${t.goal} is judged by this team: a ${t.job} task does not belong here`)
  }
  let board = next
  const { sprint, held_at: at } = meeting
  for (const goal of chosen.filter(g => board.goals[g].sprint !== sprint)) {
    board = addGoal(board, { goal, sprint, at })
  }
  const sprintGoal = record.sprintGoal.trim()
  const row = board.sprints[meeting.sprint]
  row.team_goals = { ...(row.team_goals ?? {}), [meeting.team]: sprintGoal }
  const tasks = record.tasks.map(t => ({ goal: t.goal, job: t.job, title: t.title.trim() }))
  return { board, record: { sprintGoal, goals: [...chosen], tasks, ...baField(record) } }
}

/**
 * Asserts the Business Analyst attends: always when `required` (Planning,
 * Refinement, Review), otherwise only when the record names one (Daily).
 */
function requireBa(meeting, record, what, { required = true } = {}) {
  const ba = record.businessAnalyst
  need(filled(ba) || !required, `${what} needs the Business Analyst (businessAnalyst)`)
  if (!filled(ba)) return
  need(isAgentId(ba), `${what} names a Business Analyst agent hash`)
  need(meeting.attendees.includes(ba), `Business Analyst ${ba} must attend ${what}`)
}

/** Optional businessAnalyst field copied onto a held meeting record. */
function baField(record) {
  return filled(record.businessAnalyst)
    ? { businessAnalyst: record.businessAnalyst }
    : {}
}

/** Normalizes Daily Scrum developer updates into notes and blockers. */
function dailyUpdates(updates, attendees) {
  need(nonEmpty(updates), 'a Daily Scrum has an update from each developer')
  for (const u of updates) {
    need(attendees.includes(u.agent), `${u.agent} is not in this Daily Scrum`)
    need(filled(u.done) && filled(u.today), 'an update says what was done and what is next')
  }
  const blockers = updates.flatMap(u => texts(u.blockers ?? [], 'blockers')
    .map(blocker => ({ agent: u.agent, blocker })))
  const notes = updates.map(u => ({
    agent: u.agent, done: u.done.trim(), today: u.today.trim(),
  }))
  return { notes, blockers }
}

/** Stress rows: high-priority goals still carrying open load. */
function parseStress(stress) {
  const rows = Array.isArray(stress) ? stress : []
  for (const row of rows) {
    need(isGoalId(row.goal) && Number.isInteger(row.priority) && row.priority >= 1,
      'stress names a goal and its priority (1 is first)')
  }
  return rows.map(s => ({ goal: s.goal, priority: s.priority, load: s.load ?? '' }))
}

/** Strain rows: higher-priority goals delayed while lower work continues. */
function parseStrain(strain) {
  const rows = Array.isArray(strain) ? strain : []
  for (const row of rows) {
    need(isGoalId(row.goal) && filled(row.reason), 'strain names a delayed goal and why')
  }
  return rows.map(s => ({ goal: s.goal, reason: String(s.reason).trim() }))
}

/** Lead reallocations of attendees onto higher-priority work. */
function parseReallocations(reallocations, attendees) {
  const rows = Array.isArray(reallocations) ? reallocations : []
  for (const move of rows) {
    need(isAgentId(move.agent) && attendees.includes(move.agent),
      'a reallocation names an attending agent')
    need(filled(move.to) && filled(move.reason),
      'a reallocation says where the agent goes and why')
    need((move.goal === undefined) === (move.job === undefined),
      'a reallocation onto board work names both its goal and its job')
    need(move.goal === undefined || (isGoalId(move.goal) && isJob(move.job)),
      'a reallocation names a goal hash and a job')
  }
  return rows.map(m => ({
    agent: m.agent, to: String(m.to).trim(), reason: String(m.reason).trim(),
    cost: filled(m.cost) ? String(m.cost).trim() : '',
    ...(m.goal === undefined ? {} : { goal: m.goal, job: m.job }),
    ...(filled(m.from) ? { from: String(m.from).trim() } : {}),
  }))
}

/**
 * Puts the lead's reallocations onto the board: a move that names a goal and
 * a job becomes assigned work for the moved seat (assignWork), and the open work
 * it leaves (`from`, a work id) is released. Free-text moves stay on the
 * record only. Returns the board and the moves with their new work ids.
 */
function applyReallocations(board, meeting, moves) {
  const { lead: by, held_at: at, team } = meeting
  let next = board
  const applied = moves.map(move => {
    if (move.goal === undefined) return move
    if (move.from !== undefined) {
      next = releaseWork(next, { id: move.from, agent: move.agent, team, by, at })
    }
    const description = `Daily Scrum reallocation to ${move.to}: ${move.reason}`
    const made = assignWork(next, { ...move, team, description, by, at })
    next = made.board
    return { ...move, work: made.id }
  })
  return { board: next, reallocations: applied }
}

/**
 * Bugs raised at the Daily Scrum by the seat that found them, as the team
 * discussed them: how the code behaves now, how it should behave, the
 * possible solutions and code snippets.
 */
function parseBugs(bugs, attendees) {
  const rows = Array.isArray(bugs) ? bugs : []
  for (const b of rows) {
    need(attendees.includes(b.agent), 'a bug is raised by the attending seat that found it')
    need(filled(b.title) && filled(b.behavior) && filled(b.expected),
      'a bug names itself, how the code behaves now and how it should behave')
    need(nonEmpty(b.solutions), 'the team discusses one possible solution or more')
    need(b.goal === undefined || isGoalId(b.goal), 'a bug names a goal hash')
  }
  return rows.map(b => ({
    agent: b.agent, title: b.title.trim(), behavior: b.behavior.trim(),
    expected: b.expected.trim(), solutions: texts(b.solutions, 'solutions'),
    snippets: texts(b.snippets ?? [], 'snippets'),
    ...(b.goal === undefined ? {} : { goal: b.goal }),
  }))
}

/** Daily Scrum: updates, blockers, stress/strain, raised bugs and lead reallocations. */
function daily(next, meeting, record) {
  requireBa(meeting, record, 'Daily Scrum', { required: false })
  const { notes, blockers } = dailyUpdates(record.updates, meeting.attendees)
  const moves = parseReallocations(record.reallocations, meeting.attendees)
  const { board, reallocations } = applyReallocations(next, meeting, moves)
  return {
    board,
    record: {
      updates: notes,
      blockers,
      stress: parseStress(record.stress),
      strain: parseStrain(record.strain),
      reallocations,
      bugs: parseBugs(record.bugs, meeting.attendees),
      schedule: teamSchedule(board, meeting).find(row => row.team === meeting.team),
      ...baField(record),
    },
  }
}

/**
 * Refuses a refinement item that is not an upcoming goal with points and a
 * priority. Returns the goal row and the item's checked client fields.
 */
function checkItem(next, meeting, item) {
  const row = next.goals[item.goal]
  need(row !== undefined, `goal is not on the board: ${item.goal}`)
  need(row.sprint !== meeting.sprint, `${item.goal} is in this sprint; refine upcoming goals`)
  const sized = Number.isInteger(item.points) && item.points >= 1 && item.points <= POINTS_MAX
  need(sized, `points are 1 to ${POINTS_MAX}`)
  need(item.priority !== undefined, 'priority is 1 or more (1 is first)')
  return { row, fields: clientFields(item) }
}

/**
 * The client-facing fields a backlog goal may carry, checked: the client
 * `objective` it serves (the BA's link from chat to board), its
 * `acceptance` criteria, its `priority` (1 is first), an `owner` team, the
 * goals it depends on (`dependsOn`) and its open bug issues (`bugIssues`).
 */
function clientFields(item) {
  const out = {}
  if (filled(item.objective)) out.objective = String(item.objective).trim()
  if (item.acceptance !== undefined) out.acceptance = texts(item.acceptance, 'acceptance')
  if (item.priority !== undefined) {
    const ranked = Number.isInteger(item.priority) && item.priority >= 1
    need(ranked, 'priority is 1 or more (1 is first)')
    out.priority = item.priority
  }
  if (item.owner !== undefined) {
    need(isTeamId(item.owner), `owner is a team hash: ${item.owner}`)
    out.owner = item.owner
  }
  if (item.dependsOn !== undefined) {
    need(Array.isArray(item.dependsOn) && item.dependsOn.every(isGoalId),
      'dependsOn lists the goal hashes this goal depends on')
    out.depends_on = [...new Set(item.dependsOn)]
  }
  if (item.bugIssues !== undefined) {
    need(Array.isArray(item.bugIssues) && item.bugIssues.every(n => Number.isInteger(n) && n > 0),
      "bugIssues lists the open bug issues (numbers) in the project's repo")
    out.bug_issues = [...new Set(item.bugIssues)]
  }
  return out
}

/** Backlog Refinement: upcoming goals clarified, sized and ordered for the next sprints. */
function refinement(next, meeting, record) {
  requireBa(meeting, record, 'Backlog Refinement')
  const items = record.items
  need(nonEmpty(items), 'Backlog Refinement works one upcoming goal or more')
  for (const item of items) {
    const { row, fields } = checkItem(next, meeting, item)
    Object.assign(row, fields, { points: item.points, refined_at: meeting.held_at })
    if (filled(item.notes)) row.notes = String(item.notes).trim()
  }
  const refined = items.map(i => ({ goal: i.goal, points: i.points, priority: i.priority }))
  return {
    board: next,
    record: {
      items: refined,
      ...baField(record),
      ...(filled(record.costNotes) ? { costNotes: String(record.costNotes).trim() } : {}),
    },
  }
}

const DEMO_SURFACES = Object.freeze(['gui', 'browser', 'terminal', 'other'])

/** A roster row's goal is Done in the sprint; its demoer is the one the BA scheduled. */
function checkDemoer(goal, meeting, row) {
  need(goal?.sprint === meeting.sprint && goal.state === 'done',
    `${row.goal} is not Done in this sprint`)
  const scheduled = goal.signoffs?.find(sig => sig.step === 'ba')?.demo?.agent
  need(scheduled === undefined || scheduled === row.agent,
    `the BA scheduled ${scheduled} to demo ${row.goal}`)
}

/** Demo roster: Done sprint goals; bugs may appear but are not required demos. */
function parseRoster(next, meeting, roster) {
  need(Array.isArray(roster), 'the Business Analyst prepares a demo roster')
  for (const row of roster) {
    need(isAgentId(row.agent) && isGoalId(row.goal), 'roster rows name an agent and a goal')
    const kind = row.kind ?? 'feature'
    need(['feature', 'improvement', 'bug'].includes(kind),
      'roster kind is feature, improvement or bug')
    if (filled(row.surface)) {
      need(DEMO_SURFACES.includes(row.surface),
        'roster surface is gui, browser, terminal or other')
    }
    checkDemoer(next.goals[row.goal], meeting, row)
  }
  const listed = new Set(roster.map(r => r.goal))
  const missing = Object.entries(next.goals)
    .filter(([g, row]) => row.sprint === meeting.sprint && row.state === 'done' && !listed.has(g))
    .map(([g]) => g)
  need(missing.length === 0,
    `the demo roster lists every Done goal of the sprint (kind bug skips the demo): ${missing}`)
  const demo = roster.filter(r => (r.kind ?? 'feature') !== 'bug').map(r => r.goal)
  return {
    roster: roster.map(r => ({
      agent: r.agent, goal: r.goal, kind: r.kind ?? 'feature',
      ...(filled(r.surface) ? { surface: r.surface } : {}),
    })),
    demo: [...new Set(demo)],
  }
}

/** Demo follow-ups captured during the joint Sprint Review. */
function parseQuestions(questions) {
  const rows = Array.isArray(questions) ? questions : []
  for (const q of rows) {
    need(isAgentId(q.from) && isAgentId(q.to) && filled(q.question),
      'a review question names from, to and the question text')
  }
  return rows.map(q => ({
    from: q.from, to: q.to, question: String(q.question).trim(),
    answer: filled(q.answer) ? String(q.answer).trim() : '',
  }))
}

/** Adds new backlog goals named during the Sprint Review. */
function addReviewGoals(board, added, at) {
  const fields = added.map(g => {
    need(isGoalId(g.goal) && board.goals[g.goal] === undefined, `${g.goal} is not a new goal`)
    return clientFields(g)
  })
  let next = board
  added.forEach((g, i) => {
    next = addGoal(next, { goal: g.goal, title: g.title, at })
    Object.assign(next.goals[g.goal], fields[i])
  })
  return next
}

/**
 * Joint Sprint Review (once per sprint): BA roster, feature demos,
 * recorded follow-ups, feedback and new backlog goals.
 */
function review(next, meeting, record) {
  requireBa(meeting, record, 'Sprint Review')
  const attendance = record.attendance ?? meeting.attendees
  need(Array.isArray(attendance) && attendance.every(isAgentId),
    'Sprint Review attendance is a list of agent hashes')
  need(record.demo === undefined, 'the demos come from the roster; drop record.demo')
  const { roster, demo } = parseRoster(next, meeting, record.roster ?? [])
  const added = record.newGoals ?? []
  const board = addReviewGoals(next, added, meeting.held_at)
  return {
    board,
    record: {
      attendance: [...attendance],
      roster,
      demo,
      questions: parseQuestions(record.questions),
      feedback: texts(record.feedback ?? [], 'feedback'),
      newGoals: added.map(g => g.goal),
      schedule: teamSchedule(board, meeting),
      ...baField(record),
    },
  }
}

/** True when every team in the allocation has held its retrospective (this one counts). */
function allRetrosHeld(next, meeting) {
  return allocatedTeams(next, meeting.sprint)
    .every(t => t.team === meeting.team || held(next, meeting.sprint, t.team).includes('retro'))
}

/**
 * Closes a sprint: its unfinished goals go back to the backlog, in the backlog
 * state so the next sprint judges them from the start, and its allocation no
 * longer holds them, so a later sprint can plan them.
 */
function closeSprint(next, sprint, at) {
  const row = next.sprints[sprint]
  const unfinished = row.goals.filter(g => next.goals[g]?.state !== 'done')
  for (const g of unfinished) returnToBacklog(next, g, { at, from: sprint })
  Object.assign(row, { status: 'closed', closed: at })
}

/** Sends a goal from sprint `from` back to the backlog state, out of the sprint. */
function returnToBacklog(next, goal, { at, from }) {
  const target = next.goals[goal]
  const was = target.state
  // A return starts the review over: verdicts before it no longer count.
  const judgedFrom = Object.keys(next.handoffs).length
  Object.assign(target, { sprint: '', state: 'backlog', judged_from: judgedFrom })
  delete target.blocked_from
  target.history.push({ at, event: 'returned', from, was, sprint: '' })
  const row = next.sprints[from]
  if (row !== undefined) row.goals = row.goals.filter(g => g !== goal)
}

/** Sprint Retrospective: what went well, the bottlenecks, and the agreed improvements. */
function retro(next, meeting, record) {
  const actions = texts(record.actions ?? [], 'actions')
  need(actions.length > 0, 'a retrospective agrees one improvement or more')
  const outcome = {
    wentWell: texts(record.wentWell ?? [], 'wentWell'),
    bottlenecks: texts(record.bottlenecks ?? [], 'bottlenecks'),
    actions,
  }
  if (allRetrosHeld(next, meeting)) closeSprint(next, meeting.sprint, meeting.held_at)
  return { board: next, record: outcome }
}

const HOLD = { planning, daily, refinement, review, retro }

/** Refuses a meeting held by someone other than its lead, or past its timebox. */
function checkHolding(next, meeting, { by, minutes, attendees }) {
  need(meeting.state === 'scheduled', 'the meeting was already held')
  need(by === meeting.lead, 'only the team lead holds the meeting')
  const ok = Array.isArray(attendees) && attendees.includes(by) && attendees.every(isAgentId)
  need(ok, 'attendees are agent hashes, the lead among them')
  const most = timebox(meeting.kind, next.sprints[meeting.sprint].weeks ?? 1)
  need(Number.isInteger(minutes) && minutes > 0 && minutes <= most,
    `${meeting.kind} is timeboxed to ${most} minutes`)
}

/**
 * The lead holds a scheduled meeting: who attended, how long it took (within
 * its timebox), and what it decided. Returns the new board.
 */
export function holdMeeting(board, { id, by, minutes, attendees, record = {}, at }) {
  const next = normalizeBoard(structuredClone(board))
  const meeting = next.meetings[id]
  need(meeting !== undefined, `unknown meeting: ${id}`)
  openSprint(next, meeting.sprint)
  checkHolding(next, meeting, { by, minutes, attendees })
  checkOrder(held(next, meeting.sprint, meeting.team), meeting.kind, {
    board: next, sprint: meeting.sprint,
  })
  Object.assign(meeting, { attendees: [...attendees], minutes, held_at: at })
  const done = HOLD[meeting.kind](next, meeting, record)
  Object.assign(done.board.meetings[id], { state: 'held', record: done.record })
  return done.board
}

/** A sprint's meetings, or one team's, oldest first. */
export function meetingsFor(board, { sprint, team }) {
  return Object.entries(normalizeBoard(board).meetings)
    .filter(([, m]) => m.sprint === sprint && (team === undefined || m.team === team))
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
}

/**
 * The sprint's joint schedule by team hash: what each team does as a whole
 * (the goals it builds and judges, the tasks it planned, its demos) for the
 * Daily Scrum, the Sprint Review and the other meetings. Each demo names
 * its demoer by seat hash.
 */
export function teamSchedule(board, { sprint }) {
  const next = normalizeBoard(board)
  const planned = team => Object.values(next.meetings).find(m => m.sprint === sprint
    && m.team === team && m.kind === 'planning' && m.state === 'held')?.record?.tasks ?? []
  const demos = goals => goals.flatMap(goal => {
    const demo = next.goals[goal]?.signoffs?.find(sig => sig.step === 'ba')?.demo
    return demo === undefined ? [] : [{ goal, ...demo }]
  })
  return (next.allocations[sprint]?.teams ?? []).map(t => ({
    team: t.team, lead: t.lead, goals: [...(t.goals ?? [])],
    judged_goals: [...(t.judged_goals ?? [])], tasks: planned(t.team), demos: demos(t.goals ?? []),
  }))
}

/** The index of the last hand-off of `kind` after `after` that passes `ok`, or -1. */
function lastAt(list, kind, ok, after) {
  const index = list.findLastIndex(h => h.payload.kind === kind && ok(h))
  return index > after ? index : -1
}

/** Hand-offs that send work back for rework: verdicts before the last one no longer count. */
const SEND_BACKS = new Set([
  'triage', 'review-send-back', 'security-send-back', 'research-send-back',
])

/** Hand-offs that mark authors of the goal's work (the sender; for research, the coder too). */
const AUTHORING = new Set(['coder-to-review', 'research-to-coder'])

/**
 * The seats that wrote a goal's work, in any sprint: the sender of each
 * authoring hand-off and, for research, the coder that received it. Authors
 * stay authors across a return; only verdicts start over.
 */
function goalAuthors(next, goal) {
  const ever = Object.values(next.handoffs ?? {}).filter(h => h.payload.goal === goal)
  return new Set(ever.filter(h => AUTHORING.has(h.payload.kind)).flatMap(h => [
    h.payload.from?.agent, ...(h.payload.kind === 'research-to-coder' ? [h.payload.to?.agent] : []),
  ]))
}

/**
 * Refuses a sign-off unless, since the goal's last send-back or return to the
 * backlog (whichever is later) and in this order,
 * the goal was reviewed into the QA team the allocation names, that QA team
 * handed it to its Security team, and that Security team's latest sign-off
 * after the hand-off is clear. No verdict counts from a seat that ever
 * authored the goal, in any sprint, or from its team lead, whatever team the
 * seat names (teams are self-declared on a shared server).
 */
function checkVerdicts(next, sprint, goal) {
  const teams = allocatedTeams(next, sprint)
  const team = job => teams.find(t => (t[`${job}_goals`] ?? []).includes(goal))?.team
  const [qa, security] = [team('qa'), team('security')]
  need(qa !== undefined && security !== undefined,
    `${goal} has no QA and Security team in the allocation`)
  const all = Object.values(next.handoffs ?? {})
  const authors = goalAuthors(next, goal)
  const owner = teams.find(t => (t.goals ?? []).includes(goal))?.lead
  const independent = h => !authors.has(h.payload.from?.agent) && h.payload.from?.agent !== owner
  const mine = all.slice(next.goals[goal].judged_from ?? 0).filter(h => h.payload.goal === goal)
  const since = mine.slice(mine.findLastIndex(h => SEND_BACKS.has(h.payload.kind)) + 1)
  const at = (kind, from, to, after = -1) => since.findIndex((h, i) => i > after
    && h.payload.kind === kind && h.payload.to?.team === to
    && (from === undefined || h.payload.from?.team === from) && independent(h))
  const reviewed = at('review-to-qa', undefined, qa)
  need(reviewed !== -1, `${goal} has no review hand-off to QA (${qa}) since its last send-back`)
  const handed = lastAt(since, 'qa-to-security', h => h.payload.from?.team === qa
    && h.payload.to?.team === security && independent(h), reviewed)
  need(handed !== -1,
    `${goal} has no QA hand-off from ${qa} to Security (${security}) after its review`)
  const latest = since.slice(handed + 1).filter(h => h.payload.kind === 'security-signoff').at(-1)
  const clear = latest?.payload.result === 'clear' && latest.payload.from?.team === security
    && independent(latest)
  need(clear,
    `${goal}'s latest Security sign-off after QA's hand-off must be clear, from ${security}`)
}

/**
 * The Done chain on a goal, in order: a team member who neither wrote the
 * goal nor leads the team (`peer`), the team lead, or another member when
 * the lead wrote it (`lead`), the Business Analyst when the goal goes on the
 * scheduled Sprint Review's demo list (`ba`) and again when Orchestration
 * prepares the merge presentation (`ba_final`), and last the client
 * (`client`), whose push-ok approves Orchestration's merge report.
 */
export const SIGNOFF_STEPS = Object.freeze(['peer', 'lead', 'ba', 'ba_final', 'client'])

/** The step of the Done chain the goal waits for, or undefined once the client signed. */
function nextStep(target) {
  const last = target.signoffs?.at(-1)?.step
  return SIGNOFF_STEPS[last === undefined ? 0 : SIGNOFF_STEPS.indexOf(last) + 1]
}

/**
 * Records one signature item as a `chain.signature` envelope
 * (docs/schemas/envelopes.schema.json) in the board's `signatures`: a
 * merge-ok or merge-deny (`ok`, `deny`), a done (`signed`), the BA's scan
 * (step `scan`), Orchestration's merge report (step `report`) and the
 * client's decision. Returns the envelope id.
 */
function recordSignature(next, goal, { step, by, verdict, at, ...detail }) {
  const id = mintId('sig', next.signatures)
  const body = Object.fromEntries(Object.entries({ goal, step, verdict, at, ...detail })
    .filter(([, value]) => value !== undefined))
  next.signatures[id] = { v: 1, kind: 'chain.signature', id, signer: by, body }
  return id
}

/**
 * Records one signature ("done") of the Done chain on the goal, in its
 * history and as a signature envelope: only the step the goal waits for, and
 * only after the same signer ran merge-ok on that step (goalVerdict).
 */
function sign(next, goal, { step, by, at, ...extra }) {
  const target = next.goals[goal]
  const waiting = nextStep(target)
  need(waiting === step, `the next signature on this goal is ${waiting ?? 'none'}, not ${step}`)
  const approved = (target.reviews ?? [])
    .some(r => r.step === step && r.by === by && r.verdict === 'ok')
  need(approved, `${by} runs merge-ok on the ${step} step before done`)
  const sig = recordSignature(next, goal, { step, by, verdict: 'signed', at, ...extra })
  target.signoffs = [...(target.signoffs ?? []), { step, by, at, sig, ...extra }]
  target.history.push({ at, event: `${step}_signoff`, by, sig, ...extra })
}

/** Records a merge-ok or merge-deny on the goal (`reviews`) and as a signature envelope. */
function recordVerdict(next, goal, { step, by, verdict, reason, at, ...detail }) {
  const sig = recordSignature(next, goal, { step, by, verdict, reason, at, ...detail })
  const target = next.goals[goal]
  target.reviews = [...(target.reviews ?? []), { step, by, verdict, at, reason, sig }]
}

/** The goal's done report still moving up the chain, if any. */
function liveReport(next, goal) {
  return Object.entries(next.reports)
    .find(([, r]) => r.goal === goal && LIVE_REPORTS.has(r.state))
}

/** Report states on the way to the client; the others are decided or reopened. */
const LIVE_REPORTS = new Set([
  'awaiting_ba', 'ba_signed', 'preparing', 'to_orchestration', 'to_person',
])

/** The Business Analyst named on `team`'s held Sprint Planning in `sprint`. */
function sprintAnalyst(next, sprint, team) {
  return Object.values(next.meetings)
    .find(m => m.sprint === sprint && m.team === team && m.kind === 'planning'
      && m.state === 'held')
    ?.record?.businessAnalyst
}

/**
 * A member of the building team acting at the peer or lead step: the team
 * hash it acts under is the building team's, it is on the team's member list
 * when the team board has one, and it wrote none of the goal.
 */
function checkMember(next, row, goal, { by, team, members }) {
  need(isAgentId(by) && team === row.team, `${by} acts here as a seat of ${row.team}`)
  need(members === undefined || members.includes(by), `${by} is not a member of ${row.team}`)
  need(!goalAuthors(next, goal).has(by), `${by} wrote ${goal}; another member looks at it`)
}

/**
 * Refuses `by` as the signer of `step` on the goal. Peer: a member other
 * than the lead. Lead: the team lead, or, when the lead wrote the goal,
 * another member than the peer. BA steps: the building team's BA. Client:
 * the person. Returns the building team row and the live report.
 */
function checkSigner(next, goal, step, { by, team, members }) {
  const target = next.goals[goal]
  need(target !== undefined, `goal is not on the board: ${goal}`)
  const [id, report] = liveReport(next, goal) ?? []
  if (step === 'peer' || step === 'lead') {
    const row = buildingTeam(next, target.sprint, goal)
    need(target.state === 'security', `${goal} must pass security first (it is ${target.state})`)
    const leadWrote = goalAuthors(next, goal).has(row.lead)
    const leadSigns = step === 'lead' && !leadWrote
    if (leadSigns) need(by === row.lead, `only ${row.team}'s lead (${row.lead}) signs ${goal}`)
    else checkMember(next, row, goal, { by, team, members })
    const peer = target.signoffs?.find(s => s.step === 'peer')?.by
    need(step === 'lead' || by !== row.lead, 'the lead signs next; a peer is another member')
    need(leadSigns || step === 'peer' || by !== peer, 'the peer cannot also sign for the lead')
    return { row }
  }
  need(report !== undefined, `${goal} has no done report at the ${step} step`)
  if (step === 'client') {
    need(by === 'client' && report.state === 'to_person', 'only the client signs the merge report')
  } else {
    const analyst = sprintAnalyst(next, report.sprint, report.team)
    need(analyst !== undefined && by === analyst,
      `only ${report.team}'s Business Analyst (${analyst ?? 'none'}) signs ${goal}`)
  }
  return { id, report }
}

/**
 * merge-ok or merge-deny on the step a goal waits for, by that step's
 * signer (checkSigner). merge-ok lets the same signer run done (sign). It
 * pings the goal's BA (recorded in `pings`) and goes ahead without a scan;
 * only a BA scan on the step that holds or denies it blocks it (baScan). A
 * denial needs a reason and reopens the goal (reopenGoal). The BA's merge-ok
 * on a goal with a reported bug is recorded as a denial (denyForBug), unless
 * the BA signs over it for a big matter (`override`, a reason). The goal's BA
 * and the client may also deny, to reopen a goal on feedback. A client
 * denial of the merge report sends the report back to the BA (`denied`).
 */
export function goalVerdict(board, { goal, by, team, members, decision, reason, override, at }) {
  const next = normalizeBoard(structuredClone(board))
  need(decision === 'ok' || decision === 'deny', 'the verdict is merge-ok or merge-deny')
  need(decision === 'ok' || filled(reason), 'merge-deny says why')
  const target = next.goals[goal]
  need(target !== undefined, `goal is not on the board: ${goal}`)
  const step = nextStep(target)
  need(step !== undefined, `${goal} was signed by the client; open a new goal instead`)
  try {
    checkSigner(next, goal, step, { by, team, members })
  } catch (refusal) {
    if (decision === 'ok' || !mayReopen(next, goal, by)) throw refusal
  }
  const denied = bugDenial(next, goal, { step, by, at, override, decision })
  if (denied !== undefined) return denied
  const trimmed = filled(reason) ? String(reason).trim() : undefined
  const verdict = decision === 'ok' ? 'ok' : 'deny'
  if (verdict === 'ok') checkScan(target, step)
  const signedOver = overrideOf(next, goal, override)
  recordVerdict(next, goal, { step, by, verdict, reason: trimmed, at, ...signedOver })
  if (verdict === 'ok') return pingAnalyst(next, goal, { step, by, at })
  const [id, report] = liveReport(next, goal) ?? []
  if (step === 'client' && by === 'client') {
    Object.assign(report, { state: 'denied', decided_at: at, decision_reason: trimmed })
    target.history.push({ at, event: 'client_denied', by, reason: trimmed, report: id })
    return next
  }
  return reopenGoal(next, goal, { by, step, reason: trimmed, at })
}

/** The goal's BA, or the client, may deny any step to reopen the goal on feedback. */
function mayReopen(next, goal, by) {
  if (by === 'client') return true
  const analyst = goalAnalyst(next, goal)
  return analyst !== undefined && by === analyst
}

/** The BA the goal's building team named at its Sprint Planning, if any. */
function goalAnalyst(next, goal) {
  const [, report] = liveReport(next, goal) ?? []
  const sprint = report?.sprint ?? next.goals[goal].sprint
  const team = report?.team ?? allocatedTeams(next, sprint)
    .find(t => (t.goals ?? []).includes(goal))?.team
  return team === undefined ? undefined : sprintAnalyst(next, sprint, team)
}

/** Refuses merge-ok while the BA's latest scan of this step holds or denies it. */
function checkScan(target, step) {
  const scan = (target.scans ?? []).findLast(s => s.step === step)
  need(scan === undefined || scan.verdict === 'ok',
    `the Business Analyst's scan ${scan?.verdict === 'hold' ? 'holds' : 'denies'} the ${step}`
      + ` step: ${scan?.reason}; merge-ok waits for the BA's ok`)
}

/**
 * Records that merge-ok pinged the goal's BA to scan the step as needed
 * (`pings`, and a `ba_pinged` history event). A BA signing its own step
 * pings no one. Returns the board.
 */
function pingAnalyst(next, goal, { step, by, at }) {
  const ba = goalAnalyst(next, goal)
  if (ba === undefined || ba === by) return next
  const target = next.goals[goal]
  target.pings = [...(target.pings ?? []), { step, ba, by, at }]
  target.history.push({ at, event: 'ba_pinged', ba, step, by })
  return next
}

/**
 * The BA's scan of the step a goal waits for, as needed: `ok`, or `hold` or
 * `deny` with a reason. A hold or a denial blocks merge-ok on that step until
 * the BA's next scan is ok; it does not reopen the goal (merge-deny does).
 */
export function baScan(board, { goal, ba, verdict, reason, at }) {
  const next = normalizeBoard(structuredClone(board))
  const target = next.goals[goal]
  need(target !== undefined, `goal is not on the board: ${goal}`)
  const step = nextStep(target)
  need(step !== undefined, `${goal} was signed by the client; nothing to scan`)
  const analyst = goalAnalyst(next, goal)
  need(analyst !== undefined && ba === analyst,
    `only the goal's Business Analyst (${analyst ?? 'none'}) scans ${goal}`)
  need(['ok', 'hold', 'deny'].includes(verdict), 'a scan is ok, hold or deny')
  need(verdict === 'ok' || filled(reason), 'a scan that holds or denies says why')
  const said = filled(reason) ? String(reason).trim() : undefined
  const sig = recordSignature(next, goal, {
    step: 'scan', by: ba, verdict, reason: said, at, scanned: step,
  })
  target.scans = [...(target.scans ?? []), { step, by: ba, verdict, reason: said, at, sig }]
  target.history.push({ at, event: 'ba_scan', by: ba, step, verdict, reason: said, sig })
  return next
}

/** Merge-oks that pinged `ba` (any BA when unnamed) with no scan of that step since. */
export function pingsFor(board, { ba } = {}) {
  const next = normalizeBoard(board)
  const open = g => p => (ba === undefined || p.ba === ba)
    && !(g.scans ?? []).some(s => s.step === p.step && s.at >= p.at)
  const goals = Object.entries(next.goals)
    .flatMap(([goal, g]) => (g.pings ?? []).filter(open(g)).map(p => ({ goal, ...p })))
  return [...goals, ...heldPings(next, ba)]
}

/**
 * Work held past a seat's open-work limit, as pings for its team's BA
 * (step `load`), until the BA or the client decides it.
 */
function heldPings(next, ba) {
  return Object.entries(next.assignments)
    .filter(([, w]) => w.state === 'held')
    .map(([work, w]) => ({
      goal: w.goal, work, step: 'load', ba: teamAnalyst(next, w.team), by: w.assigned_by,
      at: w.held.at,
    }))
    .filter(p => ba === undefined || p.ba === ba)
}

/** The BA the team named at its latest held Sprint Planning. */
function teamAnalyst(next, team) {
  return Object.values(next.meetings)
    .filter(m => m.team === team && m.kind === 'planning' && m.state === 'held')
    .sort((a, b) => String(a.held_at).localeCompare(String(b.held_at)))
    .at(-1)?.record?.businessAnalyst
}

/**
 * Sends a goal back to work after a denial: it returns to `in_progress`,
 * its verdicts and signatures start over, and its live report is
 * `reopened`. A goal that was Done is flagged for the client's review of
 * the recommendations (the BA asks Orchestration), so the client's latest
 * feedback stays in force.
 */
function reopenGoal(next, goal, { by, step, reason, at }) {
  const target = next.goals[goal]
  const was = target.state
  Object.assign(target, {
    state: 'in_progress', judged_from: Object.keys(next.handoffs).length, signoffs: [],
    reviews: [], scans: [], pings: [],
  })
  delete target.blocked_from
  delete target.raised
  target.history.push({ at, event: 'reopened', by, step, reason, was })
  const [, report] = liveReport(next, goal) ?? []
  if (report !== undefined) {
    Object.assign(report, {
      state: 'reopened', reopened_at: at, reopen_reason: reason,
      needs_client_review: was === 'done',
    })
  }
  return next
}

/** The peer step's "done": a member verifies the goal before the lead signs. */
export function peerVerify(board, { goal, peer, team, members, at }) {
  const next = normalizeBoard(structuredClone(board))
  checkSigner(next, goal, 'peer', { by: peer, team, members })
  sign(next, goal, { step: 'peer', by: peer, at, seq: Object.keys(next.handoffs).length })
  return next
}

/** Refuses the lead's sign-off without a peer verification since the last send-back. */
function checkPeer(next, goal) {
  const target = next.goals[goal]
  const peer = (target.signoffs ?? []).findLast(s => s.step === 'peer')
  const later = Object.values(next.handoffs).slice(peer?.seq ?? 0)
  const current = peer !== undefined && peer.seq >= (target.judged_from ?? 0)
    && !later.some(h => h.payload.goal === goal && SEND_BACKS.has(h.payload.kind))
  need(current, `${goal} needs a team member's peer verification since its last send-back`)
}

/**
 * The lead step's "done": the team lead (another member when the lead
 * wrote the goal) signs it done for the team, once it has passed security
 * and a member verified it. Moves the goal to done and files a done report
 * that waits for the Business Analyst (`awaiting_ba`).
 */
export function leadSignOff(board, { sprint, goal, lead, team, members, at, mint }) {
  const next = normalizeBoard(structuredClone(board))
  need(next.goals[goal]?.sprint === sprint, `${goal} is not in this sprint`)
  const acting = { by: lead, team: team ?? buildingTeam(next, sprint, goal).team, members }
  const { row } = checkSigner(next, goal, 'lead', acting)
  checkVerdicts(next, sprint, goal)
  checkPeer(next, goal)
  return fileDone(next, { sprint, goal, team: row.team, lead: row.lead, by: lead, at, mint })
}

/** The allocated team that builds `goal` in an open `sprint`, the goal being in it. */
function buildingTeam(next, sprint, goal) {
  openSprint(next, sprint)
  const row = allocatedTeams(next, sprint).find(t => (t.goals ?? []).includes(goal))
  need(row !== undefined, `${goal} is not built by a team in this sprint's allocation`)
  need(next.goals[goal]?.sprint === sprint, `${goal} is not in this sprint`)
  return row
}

/** Moves a goal to done on the lead step and files its done report for the BA. */
function fileDone(next, { sprint, goal, team, lead, by, at, mint }) {
  const target = next.goals[goal]
  const from = target.state
  sign(next, goal, { step: 'lead', by, at, from, to: 'done' })
  Object.assign(target, { state: 'done', done_by: by, done_at: at })
  delete target.blocked_from
  const id = mintId('report', next.reports, mint)
  next.reports[id] = {
    sprint, goal, team, lead, signed_at: at, state: 'awaiting_ba',
    ...(by === lead ? {} : { signed_by: by }),
  }
  return { id, board: next }
}

/** A Sprint Review of `sprint` that is scheduled and not held yet. */
function reviewScheduled(next, sprint) {
  return Object.values(next.meetings)
    .some(m => m.sprint === sprint && m.kind === 'review' && m.state === 'scheduled')
}

/** The BA signature a report waits for, by report state, and where it goes next. */
const BA_STEPS = Object.freeze({
  awaiting_ba: { step: 'ba', then: 'ba_signed' },
  preparing: { step: 'ba_final', then: 'to_orchestration' },
})

/**
 * The BA steps' "done". A goal with an open reported bug is not signed: it
 * is denied as needing a bug fix (denyForBug), unless the BA signs over it
 * for a big matter (`override`). First (`ba`): see firstSignature. Second
 * (`ba_final`): once Orchestration prepares the merge presentation
 * (prepareMerge); it promotes the report to Orchestration. Returns the board.
 */
export function baSignOff(board, {
  goal, ba, kind = 'feature', surface, demoer, meets, override, at,
}) {
  const next = normalizeBoard(structuredClone(board))
  const step = nextStep(next.goals[goal] ?? {})
  need(step === 'ba' || step === 'ba_final', `${goal} is not waiting for the Business Analyst`)
  const { report } = checkSigner(next, goal, step, { by: ba })
  need(BA_STEPS[report.state]?.step === step,
    step === 'ba' ? `${goal}'s report is ${report.state}`
      : `Orchestration prepares the merge presentation before the BA's second signature`)
  const denied = bugDenial(next, goal, { step, by: ba, at, override, decision: 'ok' })
  if (denied !== undefined) return denied
  const first = step === 'ba'
    ? firstSignature(next, goal, report, { kind, surface, demoer, meets }) : {}
  sign(next, goal, { step, by: ba, at, ...first, ...overrideOf(next, goal, override) })
  report.state = BA_STEPS[report.state].then
  return next
}

const BA_STEP_NAMES = new Set(Object.values(BA_STEPS).map(row => row.step))

/**
 * What the BA's first signature records. A feature or improvement meets the
 * client's expectations and goes on the scheduled Sprint Review's demo list.
 * A bug is signed when fixing it is a client objective (expectationsMet), or,
 * when it was found during development, once the seat that signed the lead
 * step raised it to the BA (raiseToAnalyst). A bug is listed without a demo.
 */
function firstSignature(next, goal, report, { kind, surface, demoer, meets }) {
  const target = next.goals[goal]
  if (kind !== 'bug' && target.kind !== 'bug') {
    const demo = demoEntry(next, report.sprint, { kind, surface, demoer })
    return { ...demo, expectations: expectationsMet(target, meets) }
  }
  if (filled(target.objective)) return { expectations: expectationsMet(target, meets) }
  need(target.raised !== undefined,
    `${goal} is a bug found during development: the team lead raises it to the BA first`)
  return { raised: { ...target.raised } }
}

/**
 * The lead step's signer raises a bug found during development (no client
 * objective) to the goal's BA, who may then sign it. The raise is recorded
 * and pings the BA. Returns the board.
 */
export function raiseToAnalyst(board, { goal, lead, reason, at }) {
  const next = normalizeBoard(structuredClone(board))
  const target = next.goals[goal]
  need(target !== undefined, `goal is not on the board: ${goal}`)
  need(nextStep(target) === 'ba', `${goal} is not waiting for the BA's first signature`)
  const signer = target.signoffs.find(sig => sig.step === 'lead')?.by
  need(lead === signer, `only ${signer}, who signed the lead step, raises ${goal} to the BA`)
  need(filled(reason), 'raising a bug to the BA says why')
  target.raised = { by: lead, reason: String(reason).trim(), at }
  target.history.push({ at, event: 'raised_to_ba', by: lead })
  return pingAnalyst(next, goal, { step: 'ba', by: lead, at })
}

/**
 * The BA's merge-ok or done on a goal with an open reported bug is denied
 * as needing a bug fix, unless the BA signs over it for a big matter
 * (`override`, BA steps only). Returns the denied board, or undefined.
 */
function bugDenial(next, goal, { step, by, at, override, decision }) {
  need(!filled(override) || BA_STEP_NAMES.has(step),
    'only the Business Analyst signs over a reported bug (override)')
  const open = decision === 'ok' && BA_STEP_NAMES.has(step) && reportedBugs(next, goal).length > 0
  return open && !filled(override) ? denyForBug(next, goal, { step, by, at }) : undefined
}

/** The override a BA signature carries: its reason and the bugs it signs over. */
function overrideOf(next, goal, override) {
  if (!filled(override)) return {}
  return { override: { reason: String(override).trim(), bugs: reportedBugs(next, goal) } }
}

/**
 * The reported bugs open on a goal: issues in the project's repo it lists
 * (`bug_issues`), and bugs found in discovery (QA's triage hand-offs on the
 * goal that are not done, and bug reports on the goal the client had fixed
 * whose bug goal is not done). A listed issue stops counting once its bug
 * goal is done; a filed bug report counts as its issue.
 */
function reportedBugs(next, goal) {
  const fixed = n => Object.values(next.goals)
    .some(g => g.kind === 'bug' && g.issue === n && g.state === 'done')
  const issues = (next.goals[goal].bug_issues ?? []).filter(n => !fixed(n)).map(n => `issue #${n}`)
  const triage = Object.entries(next.handoffs)
    .filter(([, h]) => h.payload.goal === goal && h.payload.kind === 'triage' && h.state !== 'done')
    .map(([id]) => `triage ${id}`)
  const found = Object.entries(next.reports)
    .filter(([, r]) => r.kind === 'bug' && r.envelope.body.goal === goal
      && BUG_TO_FIX.has(r.state) && next.goals[r.bug_goal]?.state !== 'done'
      && next.goals[r.bug_goal]?.issue === undefined)
    .map(([id]) => `bug ${id}`)
  return [...issues, ...triage, ...found]
}

/**
 * The BA does not sign a goal that needs a bug fix: its merge-ok or done is
 * recorded as merge-deny ("bug fix needed"), the goal reopens and goes back
 * to the backlog until the bug is fixed, and the coders are told
 * (bugFixNeeded). Returns the board.
 */
function denyForBug(next, goal, { step, by, at }) {
  const bugs = reportedBugs(next, goal)
  const reason = `bug fix needed${bugs.length > 0 ? `: ${bugs.join(', ')}` : ''}`
  const [, report] = liveReport(next, goal) ?? []
  const from = next.goals[goal].sprint
  recordVerdict(next, goal, { step, by, verdict: 'deny', reason, at })
  const reopened = reopenGoal(next, goal, { by, step, reason, at })
  returnToBacklog(reopened, goal, { at, from })
  return bugFixNeeded(reopened, goal, { by, team: report?.team, bugs, reason, at })
}

/**
 * Records that a goal needs a bug fix, which is planned like other work
 * rather than made at once: a draft for a real issue in the project's repo
 * (filed by a person or the Ticket Lead, never by the board) and a
 * `bug fix needed` thread that reaches the goal's coders in their inbox.
 */
function bugFixNeeded(next, goal, { by, team, bugs, reason, at }) {
  const target = next.goals[goal]
  const criteria = (target.acceptance ?? []).map(a => `- [ ] ${a}`)
  const body = [reason, goal, ...criteria].join('\n')
  const draft = { title: `Bug fix needed: ${target.title}`, body }
  target.bug_fix = { by, at, reason, bugs, issue_draft: draft }
  target.history.push({ at, event: 'bug_fix_needed', by, bugs })
  const item = Object.values(next.handoffs).findLast(h => h.payload.goal === goal)?.payload.item
  if (item === undefined || !isTeamId(team)) return next
  const topic = 'bug fix needed'
  return openThread(next, { goal, item, topic, agent: by, team, body: reason, at }).board
}

/**
 * The client's expectations the BA checked at its first signature, by
 * task: the goal states its objective and acceptance criteria, and the BA
 * confirms the goal meets them (`meets`). Refused otherwise.
 */
function expectationsMet(target, meets) {
  need(filled(target.objective) && nonEmpty(target.acceptance),
    'the BA signs a goal against its objective and acceptance criteria; set them first')
  need(meets === true, "the BA confirms the goal meets its acceptance criteria (meets)")
  return { objective: target.objective, acceptance: [...target.acceptance] }
}

/** The demo-list entry of the BA's first signature, refused without a scheduled review. */
function demoEntry(next, sprint, { kind, surface, demoer }) {
  need(reviewScheduled(next, sprint), `schedule ${sprint}'s Sprint Review first`)
  need(['feature', 'improvement'].includes(kind), 'demo kind is feature or improvement')
  need(surface === undefined || DEMO_SURFACES.includes(surface),
    'demo surface is gui, browser, terminal or other')
  need(isAgentId(demoer), 'the demo names the agent hash of the seat that demos it')
  return { demo: { kind, agent: demoer, ...(surface === undefined ? {} : { surface }) } }
}

/**
 * The "done" of the step a goal waits for, run by that step's signer:
 * peer, lead, or one of the BA's two signatures. The client's step is its
 * push-ok (clientSignOff). Returns { board } (and the report id on the
 * lead step, or `bugFixNeeded` when the BA's step was denied for a bug).
 */
export function goalDone(board, {
  goal, by, team, members, kind, surface, demoer, meets, override, at, mint,
}) {
  const target = normalizeBoard(board).goals[goal]
  need(target !== undefined, `goal is not on the board: ${goal}`)
  const step = nextStep(target)
  if (step === 'peer') return { board: peerVerify(board, { goal, peer: by, team, members, at }) }
  if (step === 'lead') {
    return leadSignOff(board, { sprint: target.sprint, goal, lead: by, team, members, at, mint })
  }
  need(step === 'ba' || step === 'ba_final',
    step === 'client' ? "the client's push-ok signs the merge report" : `${goal} is fully signed`)
  const after = baSignOff(board, { goal, ba: by, kind, surface, demoer, meets, override, at })
  const fix = after.goals[goal].bug_fix
  return { board: after, ...(fix?.at === at && fix.by === by ? { bugFixNeeded: fix } : {}) }
}

/**
 * Done reports by where they stand: `awaiting_ba`, `ba_signed`, `preparing`,
 * `to_orchestration`, `to_person`, then `approved` or `denied` by the
 * client, `reworked` once the BA filed the new approach, or `reopened`.
 */
export function reportsFor(board, { state } = {}) {
  return Object.entries(normalizeBoard(board).reports)
    .filter(([, r]) => state === undefined || r.state === state)
    .map(([id, r]) => ({ id, ...r }))
}

/** Refuses an id list naming a report that is not in `state`. */
function reportsIn(next, ids, state, what) {
  need(Array.isArray(ids) && ids.length > 0, `${what} one done report or more`)
  return ids.map(id => {
    const row = next.reports[id]
    need(row !== undefined, `unknown report: ${id}`)
    need(row.state === state, `report ${id} is ${row.state}, not ${state}`)
    return row
  })
}

/**
 * Orchestration starts preparing the merge presentation for reports the BA
 * signed once: they become `preparing`, which opens the BA's second
 * signature. Returns the new board.
 */
export function prepareMerge(board, { ids, at }) {
  const next = normalizeBoard(structuredClone(board))
  for (const row of reportsIn(next, ids, 'ba_signed', 'prepare')) {
    Object.assign(row, { state: 'preparing', preparing_at: at })
  }
  return next
}

/** The id of a report row on the board. */
function reportId(next, row) {
  return Object.keys(next.reports).find(id => next.reports[id] === row)
}

/**
 * The big-picture merge plan Orchestration attaches to the reports it
 * forwards; `side` lists the temporary virtual-git branches (local refs
 * and side worktrees) to delete once the real PR is merged (recordMerged).
 */
function mergePlan(merge) {
  const plan = merge ?? {}
  need(filled(plan.branch) && filled(plan.design) && filled(plan.implementation),
    'a merge report names the real branch, how it fits the design, and the implementation')
  return {
    branch: String(plan.branch).trim(), design: String(plan.design).trim(),
    implementation: String(plan.implementation).trim(),
    risks: texts(plan.risks ?? [], 'risks'),
    side: texts(plan.side ?? [], 'side'),
  }
}

/**
 * Orchestration delivers the merge report to the client for reports the BA
 * signed twice: a summary and the big-picture merge plan (the real branch,
 * the design fit, the implementation, the risks). The client answers with
 * push-ok (clientSignOff) or merge-deny (goalVerdict).
 */
export function forwardReports(board, { sprint, ids, summary, merge, at }) {
  const next = normalizeBoard(structuredClone(board))
  need(next.sprints[sprint] !== undefined, `unknown sprint: ${sprint}`)
  need(String(summary ?? '').trim() !== '', 'a report to the person needs a summary')
  const plan = mergePlan(merge)
  for (const row of reportsIn(next, ids, 'to_orchestration', 'forward')) {
    need(row.sprint === sprint, `a report belongs to ${row.sprint}; forward one sprint at a time`)
    Object.assign(row, {
      state: 'to_person', forwarded_at: at, summary: summary.trim(), merge: plan,
    })
    row.sig = recordSignature(next, row.goal, {
      step: 'report', by: 'orchestration', verdict: 'signed', at, report: reportId(next, row),
    })
  }
  return next
}

/**
 * The client's signature, the last step: its push-ok naming merge reports
 * is its merge-ok and its done on each. Each named report becomes
 * `approved`. An item is judged on its own: other reports do not matter,
 * except a goal it depends on (`depends_on`), which must be approved (in
 * this call or before) and not denied. It comes after the BA's two
 * signatures and never replaces them. Returns { board, approved }.
 */
export function clientSignOff(board, { ids, at }) {
  const next = normalizeBoard(structuredClone(board))
  need(nonEmpty(ids), 'push-ok names the merge reports it approves')
  for (const id of ids) {
    need(next.reports[id]?.state === 'to_person', `report ${id} is not waiting for the client`)
  }
  let waiting = [...ids]
  while (waiting.length > 0) {
    const blocker = id => blockingDependency(next, next.reports[id].goal)
    const ready = waiting.filter(id => blocker(id) === undefined)
    if (ready.length === 0) {
      const id = waiting[0]
      need(false, `report ${id} waits on ${blocker(id)}`)
    }
    for (const id of ready) {
      const row = next.reports[id]
      recordVerdict(next, row.goal, { step: 'client', by: 'client', verdict: 'ok', at })
      sign(next, row.goal, { step: 'client', by: 'client', at, report: id })
      Object.assign(row, { state: 'approved', decided_at: at })
    }
    waiting = waiting.filter(id => !ready.includes(id))
  }
  return { board: next, approved: ids }
}

/**
 * The first goal `goal` depends on that is denied or not signed off by the
 * client yet, described; undefined when every dependency is approved.
 */
function blockingDependency(next, goal) {
  for (const dep of next.goals[goal].depends_on ?? []) {
    const row = next.goals[dep]
    if (row === undefined) return `${dep}, which is not on the board`
    const denied = Object.values(next.reports).some(r => r.goal === dep && r.state === 'denied')
    if (denied) return `${dep}, which the client denied`
    if (row.signoffs?.at(-1)?.step !== 'client') return `${dep}, which is not signed off yet`
  }
  return undefined
}

/**
 * Records the push of approved merge reports: who ran it (`by`), the tree
 * and when, on each report and in its goal's history. Returns the board.
 */
export function recordPush(board, { ids, by, tree, at }) {
  const next = normalizeBoard(structuredClone(board))
  for (const id of ids) {
    const row = next.reports[id]
    need(row?.state === 'approved', `report ${id} is not approved`)
    Object.assign(row, { pushed_by: by, pushed_at: at, pushed_tree: tree })
    next.goals[row.goal].history.push({ at, event: 'pushed', by, report: id, tree })
  }
  return next
}

/**
 * Records that the real PR carrying pushed reports was merged (by the
 * person, on the forge). Each report keeps the first merge (`merged_at`,
 * `merged_by`); the temporary virtual-git branches its merge plan listed
 * are returned for deletion, which happens only after the merge.
 * Returns { board, side }.
 */
export function recordMerged(board, { ids, by, at }) {
  const next = normalizeBoard(structuredClone(board))
  const side = []
  for (const id of ids) {
    const row = next.reports[id]
    need(row?.pushed_at !== undefined, `report ${id} was not pushed`)
    if (row.merged_at === undefined) {
      Object.assign(row, { merged_at: at, merged_by: by })
      next.goals[row.goal].history.push({ at, event: 'merged', by, report: id })
    }
    side.push(...(row.merge?.side ?? []))
  }
  return { board: next, side: [...new Set(side)] }
}

/**
 * After the client denies a merge report, the BA turns the client's
 * feedback into the new approach: new backlog goals through the Sprint
 * Review `newGoals` path, each with the objective it answers and its
 * acceptance criteria, carrying the client's reason (`client_feedback`, which
 * wins over a conflicting AI recommendation), linked back to the report.
 */
export function newApproach(board, { report: id, ba, goals, at }) {
  const next = normalizeBoard(structuredClone(board))
  const row = next.reports[id]
  need(row?.state === 'denied', `report ${id} was not denied by the client`)
  const analyst = sprintAnalyst(next, row.sprint, row.team)
  need(ba === analyst, `only ${row.team}'s Business Analyst (${analyst}) files the new approach`)
  need(nonEmpty(goals), 'a new approach adds one backlog goal or more')
  need(goals.every(g => filled(g.objective) && nonEmpty(g.acceptance)),
    'each new-approach goal states the objective it answers and its acceptance criteria')
  const added = addReviewGoals(next, goals, at)
  for (const g of goals) {
    Object.assign(added.goals[g.goal], { from_report: id, client_feedback: row.decision_reason })
  }
  Object.assign(added.reports[id], {
    state: 'reworked', reworked_at: at, new_goals: goals.map(g => g.goal),
  })
  return added
}

/** Bug report states once the client had the bug fixed, until its bug goal is done. */
const BUG_TO_FIX = new Set(['bug_fix', 'issue_drafted'])

/**
 * The BA files a bug the team raised at a held Daily Scrum (`index` in its
 * record's `bugs`) as a `bug.report` for the client through Orchestration.
 * The report row waits in `bug_to_person`. Returns { id, board }.
 */
export function fileBugReport(board, { meeting: mid, index, ba, report, at, mint }) {
  const next = normalizeBoard(structuredClone(board))
  const meeting = next.meetings[mid]
  need(meeting?.kind === 'daily' && meeting.state === 'held', `${mid} is not a held Daily Scrum`)
  const bug = meeting.record.bugs?.[index]
  need(bug !== undefined, `${mid} raised no bug ${index}`)
  const analyst = sprintAnalyst(next, meeting.sprint, meeting.team)
  need(ba === analyst, `only ${meeting.team}'s Business Analyst (${analyst}) reports its bugs`)
  need(meeting.attendees.includes(ba), `the Business Analyst attends ${mid} to report its bugs`)
  const filed = Object.values(next.reports).some(r => r.meeting === mid && r.bug_index === index)
  need(!filed, `bug ${index} of ${mid} is reported already`)
  const id = mintId('report', next.reports, mint)
  const raised = { title: bug.title, behavior: bug.behavior, expected: bug.expected }
  const body = {
    team: meeting.team, meeting: mid, found_by: bug.agent, ...(bug.goal ? { goal: bug.goal } : {}),
    ...raised, ...bugReportFields(report), at,
  }
  next.reports[id] = {
    kind: 'bug', sprint: meeting.sprint, team: meeting.team, ba, meeting: mid, bug_index: index,
    state: 'bug_to_person', filed_at: at,
    envelope: { v: 1, kind: 'bug.report', id, from: ba, body },
  }
  return { id, board: next }
}

/**
 * What a bug report tells the client: the issue, why it is reported, the
 * proposed solutions, the files, lines and code snippets, an easy-to-read
 * explanation and the plan of attack. Refused when one is missing.
 */
function bugReportFields(report) {
  const row = report ?? {}
  const words = ['issue', 'reason', 'explanation', 'plan']
  need(words.every(k => filled(row[k])),
    'a bug report states the issue, why, an easy-to-read explanation and the plan of attack')
  const lists = ['proposals', 'files', 'lines', 'snippets']
  need(lists.every(k => nonEmpty(row[k])),
    'a bug report lists proposed solutions, files, lines and code snippets')
  return {
    ...Object.fromEntries(words.map(k => [k, String(row[k]).trim()])),
    ...Object.fromEntries(lists.map(k => [k, texts(row[k], k)])),
  }
}

/** The client's answers to a bug report, and the report state each leads to. */
const BUG_DECISIONS = Object.freeze({ fine: 'bug_fine', fix: 'bug_fix' })

/**
 * The client's answer to a bug report: the behavior is fine, or it is fixed
 * with one of the proposals (`proposal`, from 1) or the client's own
 * `alternative`. Returns the new board.
 */
export function decideBug(board, { id, decision, proposal, alternative, at }) {
  const next = normalizeBoard(structuredClone(board))
  const row = next.reports[id]
  need(row?.kind === 'bug' && row.state === 'bug_to_person',
    `report ${id} is not a bug report waiting for the client`)
  need(Object.hasOwn(BUG_DECISIONS, decision), 'the client finds the behavior fine or has it fixed')
  const { proposals } = row.envelope.body
  const fix = decision === 'fix' ? fixChoice(proposals, proposal, alternative) : {}
  Object.assign(row, { state: BUG_DECISIONS[decision], decided_at: at, ...fix })
  return next
}

/** The fix the client chose: a proposal by number, or its own alternative. */
function fixChoice(proposals, proposal, alternative) {
  need((proposal === undefined) !== (alternative === undefined),
    'a fix picks one proposal by number or gives an alternative')
  if (alternative !== undefined) {
    need(filled(alternative), 'an alternative says what to do')
    return { fix: String(alternative).trim(), alternative: true }
  }
  need(Number.isInteger(proposal) && proposal >= 1 && proposal <= proposals.length,
    `pick a proposal from 1 to ${proposals.length}`)
  return { fix: proposals[proposal - 1], proposal }
}

/**
 * The team lead makes the issue from the BA's report and the client's
 * choice: a backlog goal of kind bug carrying the issue draft, which the
 * lead files in the project's repo; the board files nothing. The optional
 * `assign` (the seat hash, its job and a description) goes through assignWork, which
 * refuses a seat holding OPEN_WORK_LIMIT open pieces. Returns { board, work }.
 */
export function bugIssue(board, { id, lead, goal, title, assign, at, mint }) {
  const next = normalizeBoard(structuredClone(board))
  const row = next.reports[id]
  need(row?.kind === 'bug' && row.state === 'bug_fix',
    `report ${id} has no fix to make an issue of`)
  checkReportLead(next, row, lead)
  need(isGoalId(goal) && next.goals[goal] === undefined, `${goal} is not a new goal`)
  const body = row.envelope.body
  const draft = bugIssueDraft(body, { goal, fix: row.fix, title })
  const added = addGoal(next, { goal, title: draft.title, at })
  Object.assign(added.goals[goal], {
    kind: 'bug', from_report: id, client_feedback: row.fix, acceptance: [body.expected],
    issue_draft: draft, ...(body.goal === undefined ? {} : { bug_of: body.goal }),
  })
  Object.assign(added.reports[id], { state: 'issue_drafted', bug_goal: goal, issue_at: at })
  if (assign === undefined) return { board: added }
  const { id: work, board: given, held } = assignWork(added, {
    ...assign, goal, team: row.team, by: lead, at, mint,
  })
  return { board: given, work, held }
}

/** Refuses anyone but the team lead the allocation names for the report's team. */
function checkReportLead(next, row, lead) {
  const owner = allocatedTeams(next, row.sprint).find(t => t.team === row.team)?.lead
  need(lead === owner, `only ${row.team}'s team lead (${owner}) makes the issue`)
}

/**
 * The issue text the team lead files: the work item (the bug goal's hash,
 * kind bug), the report and the client's chosen fix.
 */
function bugIssueDraft(body, { goal, fix, title }) {
  const lines = [
    `Work item: ${goal} (bug)`, '', body.explanation, '',
    `Now: ${body.behavior}`, `Expected: ${body.expected}`,
    `Fix (client's choice): ${fix}`, '', 'Plan:', body.plan, '',
    'Files:', ...body.files.map(f => `- ${f}`), 'Lines:', ...body.lines.map(l => `- ${l}`),
    '', 'Snippets:', ...body.snippets.map(c => ['```', c, '```'].join('\n')),
  ]
  return { title: filled(title) ? String(title).trim() : body.title, body: lines.join('\n') }
}

/** A real issue's title: `#<number> <description>`. */
const ISSUE_TITLE = /^#[1-9][0-9]* \S/
const ISSUE_PREFIX = /^#[0-9]+ /

/** The title of real issue `number` with `description`. */
export function issueTitle(number, description) {
  const text = String(description ?? '').replace(ISSUE_PREFIX, '').trim()
  need(Number.isInteger(number) && number > 0, 'an issue number is a positive whole number')
  need(text !== '', 'an issue title carries a description after its number')
  return `#${number} ${text}`
}

/** Refuses an issue whose title or body breaks the format for a bug work item. */
function checkIssue(draft, goal) {
  need(ISSUE_TITLE.test(draft.title), `issue title "${draft.title}" is not "#<number> <text>"`)
  need(draft.body.includes(`Work item: ${goal} (bug)`),
    `the issue names its work item: Work item: ${goal} (bug)`)
}

/**
 * The team lead records the real issue it filed for a bug goal: the goal and
 * its draft are titled `#<number> <description>`, the goal keeps the number
 * (`issue`), and the goal the bug touches lists it (`bug_issues`). Returns
 * the new board.
 */
export function recordIssue(board, { goal, lead, number, at }) {
  const next = normalizeBoard(structuredClone(board))
  const target = next.goals[goal]
  need(target?.kind === 'bug', `${goal} is not a work item of kind bug`)
  need(target.issue === undefined, `${goal} already has issue #${target.issue}`)
  checkReportLead(next, next.reports[target.from_report], lead)
  const title = issueTitle(number, target.title)
  const draft = { ...target.issue_draft, title }
  checkIssue(draft, goal)
  Object.assign(target, { title, issue: number, issue_draft: draft })
  target.history.push({ at, event: 'issue_filed', by: lead, issue: number })
  const touched = next.goals[target.bug_of]
  if (touched !== undefined) {
    touched.bug_issues = [...new Set([...(touched.bug_issues ?? []), number])]
  }
  return next
}

/** The BA's or the client's answers on held work, and the work state each leads to. */
const HELD_DECISIONS = Object.freeze({ approve: 'assigned', decline: 'declined' })

/**
 * The team's BA decides work held past a seat's open-work limit against the
 * client's objectives: approve gives it to the seat, decline drops it (with
 * a reason), and `ask` sends the client a load report through Orchestration
 * when the BA cannot decide. Returns { board, report }; report only on ask.
 */
export function decideHeldWork(board, { id, ba, decision, reason, at, mint }) {
  const next = normalizeBoard(structuredClone(board))
  const row = next.assignments[id]
  need(row?.state === 'held', `work ${id} is not held for the Business Analyst`)
  const analyst = teamAnalyst(next, row.team)
  need(ba === analyst, `only ${row.team}'s Business Analyst (${analyst}) decides held work`)
  need(decision === 'ask' || Object.hasOwn(HELD_DECISIONS, decision),
    'held work is approved, declined, or asked of the client')
  need(decision === 'approve' || filled(reason), `${decision} on held work says why`)
  if (decision !== 'ask') return { board: settleHeld(next, id, { by: ba, decision, reason, at }) }
  const report = mintId('report', next.reports, mint)
  next.reports[report] = {
    kind: 'load', work: id, goal: row.goal, team: row.team, ba, reason: String(reason).trim(),
    state: 'load_to_person', filed_at: at,
  }
  row.state = 'held_for_client'
  return { board: next, report }
}

/** The client's answer on a load report: approve or decline the held work. */
export function decideLoad(board, { id, decision, reason, at }) {
  const next = normalizeBoard(structuredClone(board))
  const row = next.reports[id]
  need(row?.kind === 'load' && row.state === 'load_to_person',
    `report ${id} is not a load report waiting for the client`)
  need(Object.hasOwn(HELD_DECISIONS, decision), 'the client approves or declines the held work')
  Object.assign(row, { state: `load_${decision}d`, decided_at: at })
  return settleHeld(next, row.work, { by: 'client', decision, reason, at })
}

/** Records the decision on held work: it reaches the seat, or it is declined. */
function settleHeld(next, id, { by, decision, reason, at }) {
  const row = next.assignments[id]
  const decided = { by, decision, at, ...(filled(reason) ? { reason: String(reason).trim() } : {}) }
  Object.assign(row, { state: HELD_DECISIONS[decision], held: { ...row.held, decided } })
  return next
}
