// Goal board and handoff server state (see references/board.md).
// Pure functions over a plain object. The orchestration server (mcp/server.mjs)
// is the only writer; subagents read and act through its tools.
import crypto from 'node:crypto'
import { isAgentId, isGoalId, isItemId, isTeamId } from './devops-ids.mjs'
import { validateHandoff } from './devops-handoff.mjs'

// Forward hand-offs judge the item with the receiving seat; send-backs and sign-off judge with the sender.
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
    version: 1, sprints: {}, goals: {}, handoffs: {}, blame: [], threads: {}, exceptions: [],
  }
}

/** A board saved before blame and threads existed still loads with empty ones. */
export function normalizeBoard(board) {
  return { blame: [], threads: {}, exceptions: [], ...board }
}

const MINT_TRIES = 16
const HEX_BYTES = 3

function mintId(prefix, existing, mint) {
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

function need(condition, message) {
  if (!condition) throw new Error(message)
}

/** Opens a sprint. Returns { id, board }. */
export function createSprint(board, { name, at, mint }) {
  need(typeof name === 'string' && name.trim() !== '', 'a sprint needs a name')
  const next = structuredClone(board)
  const id = mintId('sprint', next.sprints, mint)
  need(SPRINT_RE.test(id), 'bad sprint id')
  next.sprints[id] = { name: name.trim(), status: 'active', opened: at, goals: [] }
  return { id, board: next }
}

/**
 * Puts a goal from goal memory on the board and in a sprint (or the backlog
 * when sprint is empty). A goal already on the board moves to the new sprint.
 */
export function addGoal(board, { goal, title, sprint = '', state = 'backlog', at }) {
  need(isGoalId(goal), `not a goal hash: ${goal}`)
  need(STATE_SET.has(state) && state !== 'blocked', `bad starting state: ${state}`)
  const next = structuredClone(board)
  if (sprint !== '') need(next.sprints[sprint] !== undefined, `unknown sprint: ${sprint}`)
  for (const row of Object.values(next.sprints)) {
    row.goals = row.goals.filter(g => g !== goal)
  }
  if (sprint !== '') next.sprints[sprint].goals.push(goal)
  const existing = next.goals[goal]
  next.goals[goal] = {
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
  need(STATE_SET.has(state), `unknown state: ${state}`)
  const row = board.goals[goal]
  const from = row.state
  const forward = GOAL_STATES.indexOf(state) === GOAL_STATES.indexOf(from) + 1
  const unblock = from === 'blocked' && GOAL_STATES.includes(state)
  need(
    forward || state === 'blocked' || unblock,
    `a goal moves one step at a time: ${from} -> ${state} is not allowed`,
  )
  const next = structuredClone(board)
  next.goals[goal].state = state
  next.goals[goal].history.push({ at, event: 'state', from, to: state })
  return next
}

/**
 * Accepts a handoff from the seat that signed it. The payload must pass
 * validateHandoff and name a goal on the board. Returns { id, board }.
 */
/** The team that judges this hand-off's item: '' when no judge is named yet. */
function judgeTeamOf(payload) {
  if (FORWARD_JUDGING.has(payload.kind)) return payload.to.team
  if (JUDGING.has(payload.kind)) return payload.from.team
  return ''
}

function isExempt(board, goal, team) {
  return team !== '' && normalizeBoard(board).exceptions.some(e => e.goal === goal && e.team === team)
}

/** Refuses a judge from a team that authored this goal, unless Orchestration allowed it. */
function assertIndependent(board, payload, judge) {
  if (judge === '' || isExempt(board, payload.goal, judge)) return
  const authors = normalizeBoard(board).goals[payload.goal]?.authors ?? []
  need(
    !authors.includes(judge),
    `team ${judge} authored this goal: another team must judge it, or Orchestration allows a same-team review`,
  )
}

export function sendHandoff(board, { payload, caller, at, mint }) {
  need(caller === payload.from.agent, 'only the sending seat can send its handoff')
  need(board.goals[payload.goal] !== undefined, `goal is not on the board: ${payload.goal}`)
  const judge = judgeTeamOf(payload)
  assertIndependent(board, payload, judge)
  const check = validateHandoff(payload, { allowSameTeam: isExempt(board, payload.goal, judge) })
  need(check.ok, `handoff refused: ${check.errors.join('; ')}`)
  const next = normalizeBoard(structuredClone(board))
  if (AUTHORING.has(payload.kind)) {
    const goal = next.goals[payload.goal]
    goal.authors = [...new Set([...(goal.authors ?? []), payload.from.team])]
  }
  const id = mintId('handoff', next.handoffs, mint)
  need(HANDOFF_RE.test(id), 'bad handoff id')
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
  const judge = judgeTeamOf(payload)
  assertIndependent(board, payload, judge)
  const check = validateHandoff(payload, { allowSameTeam: isExempt(board, payload.goal, judge) })
  need(check.ok, `handoff refused: ${check.errors.join('; ')}`)
  const next = structuredClone(board)
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
  const next = normalizeBoard(structuredClone(board))
  const id = mintId('thread', next.threads, mint)
  next.threads[id] = {
    goal,
    item,
    topic: topic.trim(),
    state: 'open',
    opened_by: { agent, team },
    opened_at: at,
    messages: [{ agent, team, at, body: body.trim() }],
  }
  return { id, board: next }
}

/** Any seat may reply to an open thread. */
export function replyThread(board, { thread, agent, team, body, at }) {
  const row = normalizeBoard(board).threads[thread]
  need(row !== undefined, `unknown thread: ${thread}`)
  need(row.state === 'open', `thread ${thread} is resolved`)
  need(String(body ?? '').trim() !== '', 'a reply needs a message')
  const next = normalizeBoard(structuredClone(board))
  next.threads[thread].messages.push({ agent, team, at, body: body.trim() })
  return next
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
