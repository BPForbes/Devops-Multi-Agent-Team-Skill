// Scrum meetings on the goal board (see references/scrum-meetings.md).
// Pure functions over the board.
import { addGoal, mintId, need, normalizeBoard } from './devops-board.mjs'
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
  return { board, record: { sprintGoal, goals: [...chosen], tasks } }
}

/** Asserts businessAnalyst is among attendees when the field is set. */
function requireBa(meeting, record, what) {
  const ba = record.businessAnalyst
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
  }
  return rows.map(m => ({
    agent: m.agent, to: String(m.to).trim(), reason: String(m.reason).trim(),
    cost: filled(m.cost) ? String(m.cost).trim() : '',
  }))
}

/** Daily Scrum: updates, blockers, stress/strain, and lead reallocations. */
function daily(next, meeting, record) {
  requireBa(meeting, record, 'Daily Scrum')
  const { notes, blockers } = dailyUpdates(record.updates, meeting.attendees)
  return {
    board: next,
    record: {
      updates: notes,
      blockers,
      stress: parseStress(record.stress),
      strain: parseStrain(record.strain),
      reallocations: parseReallocations(record.reallocations, meeting.attendees),
      ...baField(record),
    },
  }
}

/** Refuses a refinement item that is not an upcoming goal with points and a priority. */
function checkItem(next, meeting, item) {
  const row = next.goals[item.goal]
  need(row !== undefined, `goal is not on the board: ${item.goal}`)
  need(row.sprint !== meeting.sprint, `${item.goal} is in this sprint; refine upcoming goals`)
  const sized = Number.isInteger(item.points) && item.points >= 1 && item.points <= POINTS_MAX
  need(sized, `points are 1 to ${POINTS_MAX}`)
  need(Number.isInteger(item.priority) && item.priority >= 1, 'priority is 1 or more (1 is first)')
  return row
}

/** Backlog Refinement: upcoming goals clarified, sized and ordered for the next sprints. */
function refinement(next, meeting, record) {
  requireBa(meeting, record, 'Backlog Refinement')
  const items = record.items
  need(nonEmpty(items), 'Backlog Refinement works one upcoming goal or more')
  for (const item of items) {
    const row = checkItem(next, meeting, item)
    const { points, priority } = item
    Object.assign(row, { points, priority, refined_at: meeting.held_at })
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

/** Demo roster: Done sprint goals; bugs may appear but are not required demos. */
function parseRoster(next, meeting, roster) {
  need(Array.isArray(roster), 'the Business Analyst prepares a demo roster')
  for (const row of roster) {
    need(isAgentId(row.agent) && isGoalId(row.goal), 'roster rows name an agent and a goal')
    const kind = row.kind ?? 'feature'
    need(['feature', 'improvement', 'bug'].includes(kind),
      'roster kind is feature, improvement or bug')
    const goal = next.goals[row.goal]
    need(goal?.sprint === meeting.sprint && goal.state === 'done',
      `${row.goal} is not Done in this sprint`)
  }
  const demo = roster.filter(r => (r.kind ?? 'feature') !== 'bug').map(r => r.goal)
  for (const g of demo) {
    const row = next.goals[g]
    need(row?.sprint === meeting.sprint && row.state === 'done', `${g} is not Done in this sprint`)
  }
  return {
    roster: roster.map(r => ({
      agent: r.agent, goal: r.goal, kind: r.kind ?? 'feature',
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
  for (const g of added) {
    need(isGoalId(g.goal) && board.goals[g.goal] === undefined, `${g.goal} is not a new goal`)
  }
  let next = board
  for (const g of added) next = addGoal(next, { goal: g.goal, title: g.title, at })
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
  const { roster, demo } = parseRoster(next, meeting, record.roster ?? [])
  for (const g of (record.demo ?? demo)) {
    const row = next.goals[g]
    need(row?.sprint === meeting.sprint && row.state === 'done', `${g} is not Done in this sprint`)
  }
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
  for (const g of unfinished) {
    const was = next.goals[g].state
    // A return starts the review over: verdicts before it no longer count.
    const judgedFrom = Object.keys(next.handoffs).length
    Object.assign(next.goals[g], { sprint: '', state: 'backlog', judged_from: judgedFrom })
    delete next.goals[g].blocked_from
    next.goals[g].history.push({ at, event: 'returned', from: sprint, was, sprint: '' })
  }
  const kept = row.goals.filter(g => !unfinished.includes(g))
  Object.assign(row, { status: 'closed', closed: at, goals: kept })
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
  const ever = all.filter(h => h.payload.goal === goal)
  // Authors stay authors across a return; only verdicts start over.
  const authors = new Set(ever.filter(h => AUTHORING.has(h.payload.kind)).flatMap(h => [
    h.payload.from?.agent, ...(h.payload.kind === 'research-to-coder' ? [h.payload.to?.agent] : []),
  ]))
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
 * The team lead's sign-off that a goal is done for the team: only the lead of
 * the team that builds the goal, and only once the goal has passed security
 * (its last step). Moves the goal to done, records who signed, and files a
 * done report to Orchestration. It is not the final word: Orchestration
 * reports to the person, whose typed push-ok is the real final sign-off.
 */
export function leadSignOff(board, { sprint, goal, lead, at, mint }) {
  const next = normalizeBoard(structuredClone(board))
  openSprint(next, sprint)
  const row = allocatedTeams(next, sprint).find(t => (t.goals ?? []).includes(goal))
  need(row !== undefined, `${goal} is not built by a team in this sprint's allocation`)
  need(row.lead === lead, `only ${row.team}'s lead (${row.lead}) signs ${goal} off as done`)
  const target = next.goals[goal]
  need(target?.sprint === sprint, `${goal} is not in this sprint`)
  need(target.state === 'security', `${goal} must pass security first (it is ${target.state})`)
  checkVerdicts(next, sprint, goal)
  Object.assign(target, { state: 'done', done_by: lead, done_at: at })
  target.history.push({ at, event: 'lead_signoff', by: lead, from: 'security', to: 'done' })
  const id = mintId('report', next.reports, mint)
  next.reports[id] = {
    sprint, goal, team: row.team, lead, signed_at: at, state: 'to_orchestration',
  }
  return { id, board: next }
}

/** Done reports by where they stand: `to_orchestration` (from a lead) or `to_person`. */
export function reportsFor(board, { state } = {}) {
  return Object.entries(normalizeBoard(board).reports)
    .filter(([, r]) => state === undefined || r.state === state)
    .map(([id, r]) => ({ id, ...r }))
}

/**
 * Orchestration passes the leads' done reports on to the person, with its
 * summary. The person's typed /devops push-ok on the exact tree, after QA PASS
 * and Security CLEAR, stays the real final sign-off; this only tells them.
 */
export function forwardReports(board, { sprint, ids, summary, at }) {
  const next = normalizeBoard(structuredClone(board))
  need(next.sprints[sprint] !== undefined, `unknown sprint: ${sprint}`)
  need(Array.isArray(ids) && ids.length > 0, 'forward one done report or more')
  need(String(summary ?? '').trim() !== '', 'a report to the person needs a summary')
  for (const id of ids) {
    const row = next.reports[id]
    need(row !== undefined, `unknown report: ${id}`)
    need(row.state === 'to_orchestration', `report ${id} was already passed to the person`)
    need(row.sprint === sprint,
      `report ${id} belongs to ${row.sprint}; forward one sprint at a time`)
    Object.assign(row, { state: 'to_person', forwarded_at: at, summary: summary.trim() })
  }
  return next
}
