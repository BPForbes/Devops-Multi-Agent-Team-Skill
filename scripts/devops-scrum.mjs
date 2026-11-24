// Scrum meetings on the goal board (see references/scrum-meetings.md): each
// team's Sprint Planning, Daily Scrums, Backlog Refinement, Sprint Review and
// Sprint Retrospective, run by the team lead the sprint's allocation names
// (Orchestration schedules each Sprint Planning at spin-up). Pure functions
// over the board.
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

/** Refuses a meeting out of order: planning first, review once after it, retro once at the end. */
function checkOrder(kinds, kind) {
  const has = k => kinds.includes(k)
  if (kind === 'planning') need(!has('planning'), 'this team already held its Sprint Planning')
  else need(has('planning'), 'hold Sprint Planning first')
  if (kind === 'daily' || kind === 'refinement') need(!has('review'), 'the sprint is in review')
  if (kind === 'review') need(!has('review'), 'this team already held its Sprint Review')
  if (kind === 'retro') {
    need(has('review') && !has('retro'), 'the retrospective comes once, after the review')
  }
}

/** The authoring teams the sprint's allocation names, with their leads. */
function allocatedTeams(next, sprint) {
  const allocation = next.allocations[sprint]
  need(allocation !== undefined, `sprint ${sprint} has no allocation; spin up the board first`)
  return allocation.teams.filter(t => t.authors !== null)
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
  need(row !== undefined, `team ${team} has no work in this sprint's allocation`)
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
  const own = allocatedTeams(next, meeting.sprint).find(t => t.team === meeting.team).goals ?? []
  for (const g of chosen) {
    need(isGoalId(g) && next.goals[g]?.sprint === '', `${g} is not a backlog goal`)
    need(own.includes(g), `${g} is another team's stream; plan this team's own goals`)
  }
  checkTasks(record.tasks, chosen)
  let board = next
  const { sprint, held_at: at } = meeting
  for (const goal of chosen) board = addGoal(board, { goal, sprint, at })
  const sprintGoal = record.sprintGoal.trim()
  const row = board.sprints[meeting.sprint]
  row.team_goals = { ...(row.team_goals ?? {}), [meeting.team]: sprintGoal }
  const tasks = record.tasks.map(t => ({ goal: t.goal, job: t.job, title: t.title.trim() }))
  return { board, record: { sprintGoal, goals: [...chosen], tasks } }
}

/** Daily Scrum: what each developer did, plans today, and any blocker. */
function daily(next, meeting, record) {
  const updates = record.updates
  need(nonEmpty(updates), 'a Daily Scrum has an update from each developer')
  for (const u of updates) {
    need(meeting.attendees.includes(u.agent), `${u.agent} is not in this Daily Scrum`)
    need(filled(u.done) && filled(u.today), 'an update says what was done and what is next')
  }
  const blockers = updates.flatMap(u => texts(u.blockers ?? [], 'blockers')
    .map(blocker => ({ agent: u.agent, blocker })))
  const notes = updates.map(u => ({ agent: u.agent, done: u.done.trim(), today: u.today.trim() }))
  return { board: next, record: { updates: notes, blockers } }
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
  const items = record.items
  need(nonEmpty(items), 'Backlog Refinement works one upcoming goal or more')
  for (const item of items) {
    const row = checkItem(next, meeting, item)
    const { points, priority } = item
    Object.assign(row, { points, priority, refined_at: meeting.held_at })
    if (filled(item.notes)) row.notes = String(item.notes).trim()
  }
  const refined = items.map(i => ({ goal: i.goal, points: i.points, priority: i.priority }))
  return { board: next, record: { items: refined } }
}

/** Sprint Review: the Done goals shown, the feedback, and new goals for the backlog. */
function review(next, meeting, record) {
  const demo = record.demo ?? []
  for (const g of demo) {
    const row = next.goals[g]
    need(row?.sprint === meeting.sprint && row.state === 'done', `${g} is not Done in this sprint`)
  }
  const feedback = texts(record.feedback ?? [], 'feedback')
  const added = record.newGoals ?? []
  for (const g of added) {
    need(isGoalId(g.goal) && next.goals[g.goal] === undefined, `${g.goal} is not a new goal`)
  }
  let board = next
  const at = meeting.held_at
  for (const g of added) board = addGoal(board, { goal: g.goal, title: g.title, at })
  return { board, record: { demo: [...demo], feedback, newGoals: added.map(g => g.goal) } }
}

/** True when every authoring team in the allocation has held its retrospective (this one counts). */
function allRetrosHeld(next, meeting) {
  return allocatedTeams(next, meeting.sprint)
    .every(t => t.team === meeting.team || held(next, meeting.sprint, t.team).includes('retro'))
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
  if (allRetrosHeld(next, meeting)) {
    Object.assign(next.sprints[meeting.sprint], { status: 'closed', closed: meeting.held_at })
  }
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
  checkOrder(held(next, meeting.sprint, meeting.team), meeting.kind)
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
