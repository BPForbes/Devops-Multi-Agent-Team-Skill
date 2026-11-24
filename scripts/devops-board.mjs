// Goal board and handoff server state (see references/board.md).
// Pure functions over a plain object. The orchestration server (mcp/server.mjs)
// is the only writer; subagents read and act through its tools.
import crypto from 'node:crypto'
import { isAgentId, isGoalId, isItemId, isJob, isTeamId } from './devops-ids.mjs'
import { validateHandoff } from './devops-handoff.mjs'

// Forward hand-offs are judged by the receiver. Send-backs and sign-off
// are judged by the sender.
const FORWARD_JUDGING = new Set(['coder-to-review', 'review-to-qa', 'qa-to-security'])
const JUDGING = new Set([
  ...FORWARD_JUDGING, 'triage', 'review-send-back', 'security-send-back', 'security-signoff',
])
// Hand-offs that record the team that produced the work.
const AUTHORING = new Set(['coder-to-review', 'research-to-coder'])

/** Goal statuses in order. A goal moves forward one step, or to `blocked`. */
export const GOAL_STATES = Object.freeze([
  'backlog', 'ready', 'in_progress', 'review', 'qa', 'security', 'done',
])
const STATE_SET = new Set([...GOAL_STATES, 'blocked'])

const SPRINT_RE = /^sprint-[0-9a-f]{6}$/
const HANDOFF_RE = /^handoff-[0-9a-f]{6}$/

export function emptyBoard() {
  return {
    version: 1,
    sprints: {},
    goals: {},
    handoffs: {},
    blame: [],
    threads: {},
    exceptions: [],
    assignments: {},
    reads: {},
    meetings: {},
    allocations: {},
    reports: {},
  }
}

/** A board saved before blame and threads existed still loads with empty ones. */
export function normalizeBoard(board) {
  return {
    blame: [], threads: {}, exceptions: [], assignments: {}, reads: {},
    meetings: {}, allocations: {}, reports: {},
    ...board,
  }
}

const MINT_TRIES = 16
const HEX_BYTES = 3

export function mintId(prefix, existing, mint) {
  const hex = () => crypto.randomBytes(HEX_BYTES).toString('hex')
  let id = `${prefix}-${(mint ?? hex)()}`
  for (let tries = 0; existing[id] !== undefined; tries += 1) {
    if (tries >= MINT_TRIES) {
      throw new Error(`could not mint a ${prefix} id that is not on the board`)
    }
    id = `${prefix}-${(mint ?? hex)()}`
  }
  return id
}

export function need(condition, message) {
  if (!condition) throw new Error(message)
}

/** The longest sprint, in weeks; Scrum sprints run one month at most. */
export const MAX_SPRINT_WEEKS = 4

/** Opens a sprint. Returns { id, board }. */
export function createSprint(board, { name, at, mint, weeks = 1 }) {
  need(typeof name === 'string' && name.trim() !== '', 'a sprint needs a name')
  const runs = Number.isInteger(weeks) && weeks >= 1 && weeks <= MAX_SPRINT_WEEKS
  need(runs, `a sprint runs 1 to ${MAX_SPRINT_WEEKS} weeks`)
  const next = structuredClone(board)
  const id = mintId('sprint', next.sprints, mint)
  need(SPRINT_RE.test(id), 'bad sprint id')
  next.sprints[id] = { name: name.trim(), status: 'active', opened: at, weeks, goals: [] }
  return { id, board: next }
}

/**
 * Puts a goal from goal memory on the board and in a sprint (or the backlog
 * when sprint is empty). A goal already on the board moves to the new sprint.
 */
/** True when `allocation` lists `goal`, built or judged there. */
const listsGoal = (allocation, goal) => allocation.teams
  .some(t => (t.goals ?? []).includes(goal) || (t.judged_goals ?? []).includes(goal))

/** The open sprint whose allocation lists `goal`, or undefined; it holds the goal. */
export function allocatedSprintOf(board, goal) {
  return Object.entries(board.allocations ?? {})
    .find(([sprint, allocation]) => board.sprints?.[sprint]?.status !== 'closed'
      && listsGoal(allocation, goal))?.[0]
}

/** True when any allocation, open or closed, has listed `goal`: it is done only by sign-off. */
export function everAllocated(board, goal) {
  return Object.values(board.allocations ?? {}).some(allocation => listsGoal(allocation, goal))
}

export function addGoal(board, { goal, title, sprint = '', state = 'backlog', at }) {
  need(isGoalId(goal), `not a goal hash: ${goal}`)
  const starts = STATE_SET.has(state) && state !== 'blocked' && state !== 'done'
  need(starts, `bad starting state: ${state}`)
  const allocated = allocatedSprintOf(board, goal)
  need(allocated === undefined || sprint === allocated,
    `${goal} belongs to sprint ${allocated}'s allocation; it stays there`)
  const next = structuredClone(board)
  if (sprint !== '') need(next.sprints[sprint] !== undefined, `unknown sprint: ${sprint}`)
  for (const row of Object.values(next.sprints)) {
    row.goals = row.goals.filter(g => g !== goal)
  }
  if (sprint !== '') next.sprints[sprint].goals.push(goal)
  const existing = next.goals[goal]
  // Keep everything the goal already carries: its authors, team and history.
  next.goals[goal] = {
    ...(existing ?? {}),
    title: title ?? existing?.title ?? goal,
    state: existing?.state ?? state,
    sprint,
    history: [...(existing?.history ?? []), { at, event: existing ? 'moved' : 'added', sprint }],
  }
  return next
}

/** Moves a goal to a new state. Forward by one step, or to `blocked`, or back from `blocked`. */
export function moveGoal(board, { goal, state, at }) {
  need(isGoalId(goal) && board.goals[goal] !== undefined, `goal is not on the board: ${goal}`)
  need(state !== 'done' || !everAllocated(board, goal),
    `${goal} is in a sprint's allocation: only its team lead's sign-off marks it done`)
  need(STATE_SET.has(state), `unknown state: ${state}`)
  const row = board.goals[goal]
  const from = row.state
  const next = structuredClone(board)
  const target = next.goals[goal]
  if (from === 'blocked') {
    need(state === row.blocked_from, `a blocked goal resumes at ${row.blocked_from}, not ${state}`)
  } else if (state === 'blocked') {
    need(from !== 'done', `${goal} is done: only a lead's sign-off makes it done, and it stays done`)
    target.blocked_from = from
  } else {
    const forward = GOAL_STATES.indexOf(state) === GOAL_STATES.indexOf(from) + 1
    need(forward, `a goal moves one step at a time: ${from} -> ${state} is not allowed`)
  }
  target.state = state
  target.history.push({ at, event: 'state', from, to: state })
  return next
}

/** Goals on the board that belong to no sprint. */
export function backlogView(board) {
  return Object.entries(normalizeBoard(board).goals)
    .filter(([, g]) => !g.sprint)
    .map(([goal, g]) => ({ goal, title: g.title, state: g.state }))
}

/** The job that judges the item in each judging hand-off. */
const JUDGE_JOB = Object.freeze({
  'coder-to-review': 'reviewer', 'review-to-qa': 'qa', 'qa-to-security': 'security',
  'triage': 'qa', 'review-send-back': 'reviewer', 'security-send-back': 'security',
  'security-signoff': 'security',
})

/** Who judges this hand-off's item: team, seat, job and item; team and seat '' if unnamed. */
function judgeOf(payload) {
  const review = { job: JUDGE_JOB[payload.kind] ?? '', item: payload.item }
  const side = FORWARD_JUDGING.has(payload.kind) ? payload.to
    : JUDGING.has(payload.kind) ? payload.from : { team: '', agent: '' }
  return { team: side.team, agent: side.agent, ...review }
}

/** True when the exception was used by this same seat, in this same job, on this same item. */
function sameReview(e, judge) {
  return judge.agent !== '' && e.judge === judge.agent && e.job === judge.job
    && (e.item === undefined || judge.item === undefined || e.item === judge.item)
}

/** The exception that lets `judge` judge `goal`: an unused one, or the one this review used. */
function exceptionFor(board, goal, judge) {
  if (judge.team === '') return undefined
  return normalizeBoard(board).exceptions
    .find(e => e.goal === goal && e.team === judge.team && (!e.used_at || sameReview(e, judge)))
}

function isExempt(board, goal, judge) {
  return exceptionFor(board, goal, judge) !== undefined
}

/**
 * Binds the exception, in `next`, to one review: the first seat of the authoring
 * team that judges through it, in that job, on that item. That seat may finish
 * the review (receive the work, pass it on or send it back); any other seat,
 * job or item needs a new allowance. An unrouted hand-off names no seat yet, so
 * it uses nothing.
 */
function useException(next, goal, judge, { at, by }) {
  if (judge.agent === '' || !(next.goals[goal]?.authors ?? []).includes(judge.team)) return
  const row = exceptionFor(next, goal, judge)
  if (row === undefined) return
  if (!row.used_at) {
    Object.assign(row, { used_at: at, used_by: by, judge: judge.agent, job: judge.job })
  }
  if (row.item === undefined && judge.item !== undefined) row.item = judge.item
}

/** Refuses a judge from a team that authored this goal, unless Orchestration allowed it. */
function assertIndependent(board, payload, judge) {
  if (judge.team === '' || isExempt(board, payload.goal, judge)) return
  const authors = normalizeBoard(board).goals[payload.goal]?.authors ?? []
  need(
    !authors.includes(judge.team),
    `team ${judge.team} authored this goal: another team must judge it, `
      + 'unless Orchestration allows it',
  )
}

/**
 * Accepts a handoff from the seat that signed it. The payload must pass
 * validateHandoff and name a goal on the board. Returns { id, board }.
 */
export function sendHandoff(board, { payload, caller, at, mint }) {
  need(caller === payload.from.agent, 'only the sending seat can send its handoff')
  need(
    !JUDGING.has(payload.kind) || payload.to.agent !== payload.from.agent,
    'a seat cannot hand judging work to itself',
  )
  need(board.goals[payload.goal] !== undefined, `goal is not on the board: ${payload.goal}`)
  const judge = judgeOf(payload)
  assertIndependent(board, payload, judge)
  const check = validateHandoff(payload, { allowSameTeam: isExempt(board, payload.goal, judge) })
  need(check.ok, `handoff refused: ${check.errors.join('; ')}`)
  const next = normalizeBoard(structuredClone(board))
  if (AUTHORING.has(payload.kind)) {
    const goal = next.goals[payload.goal]
    goal.authors = [...new Set([...(goal.authors ?? []), payload.from.team])]
    goal.author_agents = [...new Set([...(goal.author_agents ?? []), payload.from.agent])]
  }
  const id = mintId('handoff', next.handoffs, mint)
  need(HANDOFF_RE.test(id), 'bad handoff id')
  useException(next, payload.goal, judge, { at, by: id })
  if (payload.blame) {
    next.blame.push({
      at, goal: payload.goal, item: payload.item, kind: payload.kind,
      blamed: payload.blame, by: caller, reason: payload.reason, handoff: id,
    })
    next.goals[payload.goal].history.push({
      at, event: 'sent_back', by: caller, blamed: payload.blame.agent, handoff: id,
    })
  }
  next.handoffs[id] = {
    payload,
    state: payload.to.agent === '' ? 'unrouted' : 'sent',
    sent_at: at,
    ack_at: null,
    done_at: null,
  }
  return { id, board: next }
}

/** The orchestrator picks the receiving seat for an unrouted handoff. */
export function routeHandoff(board, { id, agent, team, at }) {
  need(board.handoffs[id] !== undefined, `unknown handoff: ${id}`)
  need(board.handoffs[id].state === 'unrouted', `handoff ${id} is already routed`)
  need(isAgentId(agent), `not an agent hash: ${agent}`)
  need(isTeamId(team), `not a team hash: ${team}`)
  const payload = structuredClone(board.handoffs[id].payload)
  payload.to.agent = agent
  payload.to.team = team
  need(payload.to.agent !== payload.from.agent, 'a seat cannot hand judging work to itself')
  const judge = judgeOf(payload)
  assertIndependent(board, payload, judge)
  const check = validateHandoff(payload, { allowSameTeam: isExempt(board, payload.goal, judge) })
  need(check.ok, `handoff refused: ${check.errors.join('; ')}`)
  const next = normalizeBoard(structuredClone(board))
  useException(next, payload.goal, judge, { at, by: id })
  next.handoffs[id].payload = payload
  next.handoffs[id].payload.to.agent = agent
  next.handoffs[id].state = 'sent'
  next.handoffs[id].sent_at = at
  return next
}

/** The handoffs a seat should read: addressed to it and not yet done. */
export function inboxFor(board, agent) {
  return Object.entries(board.handoffs)
    .filter(([, h]) => h.payload.to.agent === agent && h.state !== 'done')
    .map(([id, h]) => ({ id, state: h.state, payload: h.payload }))
}

/** The addressee acknowledges a handoff it has read. */
export function ackHandoff(board, { id, agent, at }) {
  const row = board.handoffs[id]
  need(row !== undefined, `unknown handoff: ${id}`)
  need(row.payload.to.agent === agent, 'only the addressee can acknowledge a handoff')
  need(row.state === 'sent', `handoff ${id} is ${row.state}, not sent`)
  const next = structuredClone(board)
  next.handoffs[id].state = 'acked'
  next.handoffs[id].ack_at = at
  return next
}

/** The addressee marks a handoff done once its work is finished. */
export function closeHandoff(board, { id, agent, at }) {
  const row = board.handoffs[id]
  need(row !== undefined, `unknown handoff: ${id}`)
  need(row.payload.to.agent === agent, 'only the addressee can close a handoff')
  need(row.state === 'acked', `handoff ${id} must be acknowledged before it is closed`)
  const next = structuredClone(board)
  next.handoffs[id].state = 'done'
  next.handoffs[id].done_at = at
  return next
}

/** A sprint's goals with their states, for a board view. */
export function sprintView(board, sprint) {
  need(board.sprints[sprint] !== undefined, `unknown sprint: ${sprint}`)
  return board.sprints[sprint].goals.map(goal => ({
    goal,
    title: board.goals[goal].title,
    state: board.goals[goal].state,
  }))
}

/** Blame entries for a goal, or for every goal when none is given. */
export function blameFor(board, { goal } = {}) {
  const entries = normalizeBoard(board).blame
  return goal === undefined ? entries : entries.filter(entry => entry.goal === goal)
}

export function blameCounts(board) {
  const counts = {}
  for (const entry of normalizeBoard(board).blame) {
    counts[entry.blamed.agent] = (counts[entry.blamed.agent] ?? 0) + 1
  }
  return counts
}

/**
 * Opens a virtual PR thread on a goal's item: a question or review point
 * that the seats answer in turn. Returns { id, board }.
 */
export function openThread(board, { goal, item, topic, agent, team, body, at, mint }) {
  need(board.goals[goal] !== undefined, `goal is not on the board: ${goal}`)
  need(isItemId(item), `not an item hash: ${item}`)
  need(String(topic ?? '').trim() !== '', 'a thread needs a topic')
  need(String(body ?? '').trim() !== '', 'a thread needs a first message')
  need(isAgentId(agent), `not an agent hash: ${agent}`)
  need(isTeamId(team), `not a team hash: ${team}`)
  const next = normalizeBoard(structuredClone(board))
  const id = mintId('thread', next.threads, mint)
  const participants = [...new Set([agent, ...(next.goals[goal].author_agents ?? [])])]
  next.threads[id] = {
    goal,
    item,
    topic: topic.trim(),
    state: 'open',
    opened_by: { agent, team },
    opened_at: at,
    participants,
    messages: [{ agent, team, at, body: body.trim() }],
  }
  next.reads[agent] = { ...(next.reads[agent] ?? {}), [id]: 1 }
  return { id, board: next }
}

/** Any seat may reply to an open thread. */
export function replyThread(board, { thread, agent, team, body, at }) {
  const row = normalizeBoard(board).threads[thread]
  need(row !== undefined, `unknown thread: ${thread}`)
  need(row.state === 'open', `thread ${thread} is resolved`)
  need(String(body ?? '').trim() !== '', 'a reply needs a message')
  need(isAgentId(agent), `not an agent hash: ${agent}`)
  need(isTeamId(team), `not a team hash: ${team}`)
  const next = normalizeBoard(structuredClone(board))
  const row2 = next.threads[thread]
  row2.messages.push({ agent, team, at, body: body.trim() })
  row2.participants = [...new Set([...row2.participants, agent])]
  next.reads[agent] = { ...(next.reads[agent] ?? {}), [thread]: row2.messages.length }
  return next
}

/** The seat has read a thread up to its latest message. */
export function markThreadRead(board, { thread, agent }) {
  const row = normalizeBoard(board).threads[thread]
  need(row !== undefined, `unknown thread: ${thread}`)
  need(row.participants.includes(agent), 'only a participant can read a thread')
  const next = normalizeBoard(structuredClone(board))
  next.reads[agent] = { ...(next.reads[agent] ?? {}), [thread]: row.messages.length }
  return next
}

/** Open threads this seat takes part in that have messages it has not read. */
export function unreadThreads(board, agent) {
  const b = normalizeBoard(board)
  return Object.entries(b.threads)
    .filter(([id, t]) => t.state === 'open' && t.participants.includes(agent)
      && t.messages.length > (b.reads[agent]?.[id] ?? 0))
    .map(([id, t]) => {
      const seen = b.reads[agent]?.[id] ?? 0
      return { id, goal: t.goal, topic: t.topic, unread: t.messages.length - seen }
    })
}

/** Only the seat that opened a thread resolves it. */
export function resolveThread(board, { thread, agent, at }) {
  const row = normalizeBoard(board).threads[thread]
  need(row !== undefined, `unknown thread: ${thread}`)
  need(row.opened_by.agent === agent, 'only the seat that opened a thread can resolve it')
  need(row.state === 'open', `thread ${thread} is already resolved`)
  const next = normalizeBoard(structuredClone(board))
  next.threads[thread].state = 'resolved'
  next.threads[thread].resolved_at = at
  return next
}

/** The threads on a goal, or on every goal when none is given. */
export function threadsFor(board, { goal } = {}) {
  return Object.entries(normalizeBoard(board).threads)
    .filter(([, t]) => goal === undefined || t.goal === goal)
    .map(([id, t]) => ({ id, ...t }))
}

/**
 * Orchestration allows one same-team review: `team` may judge `goal` even
 * though it authored it. The reason is kept on the board. Returns a new board.
 */
export function allowSameTeam(board, { goal, team, reason, at }) {
  need(board.goals[goal] !== undefined, `goal is not on the board: ${goal}`)
  need(isTeamId(team), `not a team hash: ${team}`)
  need(String(reason ?? '').trim() !== '', 'a same-team review needs a reason')
  const next = normalizeBoard(structuredClone(board))
  next.exceptions.push({ goal, team, reason: reason.trim(), at })
  return next
}

// Judging jobs may not be given to a team that authored the goal.
const JUDGING_JOBS = new Set(['reviewer', 'qa', 'security'])

/** Gives a seat a piece of work on a goal, with what it has to do. */
export function assignWork(board, { goal, job, agent, team, description, by, at, mint }) {
  need(board.goals[goal] !== undefined, `goal is not on the board: ${goal}`)
  need(isJob(job), `not a job: ${job}`)
  need(isAgentId(agent), `not an agent hash: ${agent}`)
  need(isTeamId(team), `not a team hash: ${team}`)
  need(String(description ?? '').trim() !== '', 'assigned work needs a description')
  need(
    by === 'orchestration' || isAgentId(by),
    `assigned_by must be orchestration or an agent hash: ${by}`,
  )
  if (JUDGING_JOBS.has(job) && !isExempt(board, goal, { team, agent, job })) {
    const authors = normalizeBoard(board).goals[goal].authors ?? []
    need(!authors.includes(team), `team ${team} authored this goal and cannot judge it`)
  }
  const next = normalizeBoard(structuredClone(board))
  const id = mintId('work', next.assignments, mint)
  if (JUDGING_JOBS.has(job)) useException(next, goal, { team, agent, job }, { at, by: id })
  next.assignments[id] = {
    goal, job, agent, team, description: description.trim(), state: 'assigned',
    assigned_by: by, assigned_at: at, accepted_at: null, done_at: null,
  }
  return { id, board: next }
}

/** The work a seat has been given and has not finished. */
export function workInbox(board, agent) {
  return Object.entries(normalizeBoard(board).assignments)
    .filter(([, w]) => w.agent === agent && (w.state === 'assigned' || w.state === 'accepted'))
    .map(([id, w]) => ({ id, ...w }))
}

function ownWork(board, id, agent) {
  const row = normalizeBoard(board).assignments[id]
  need(row !== undefined, `unknown work: ${id}`)
  need(row.agent === agent, 'only the assigned seat can change its work')
  return row
}

/** The assigned seat accepts the work it was given. */
export function acceptWork(board, { id, agent, at }) {
  const row = ownWork(board, id, agent)
  need(row.state === 'assigned', `work ${id} is ${row.state}, not assigned`)
  const next = normalizeBoard(structuredClone(board))
  next.assignments[id].state = 'accepted'
  next.assignments[id].accepted_at = at
  return next
}

/** The assigned seat reports the work done. */
export function completeWork(board, { id, agent, at }) {
  const row = ownWork(board, id, agent)
  need(row.state === 'accepted', `work ${id} must be accepted before it is done`)
  const next = normalizeBoard(structuredClone(board))
  next.assignments[id].state = 'done'
  next.assignments[id].done_at = at
  return next
}
