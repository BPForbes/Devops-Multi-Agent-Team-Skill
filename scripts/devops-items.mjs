// The work item state machine and intake (design: sections 4 and 16).
// Pure rules: a move either passes or is refused with a reason, and every
// refusal goes to the caller's onRefuse so it can be logged.

const SERVER = 'server'
const ASSIGNEE = 'assignee'
const REVIEWER = 'reviewer'
const QA = 'qa'
const SECURITY = 'security'
const HUMAN = 'human'
const MANAGER = 'manager'

// Every state the manager may escalate to blocked from (design: "any").
// Done is final, and blocked already is blocked.
const ESCALATABLE = [
  'queued', 'assigned', 'in_progress', 'failed', 'in_review', 'in_qa',
  'in_security', 'ready_for_human',
]

function withEscalation(moves) {
  const out = {}
  for (const from of Object.keys(moves)) out[from] = { ...moves[from] }
  for (const from of ESCALATABLE) {
    const held = out[from] ?? {}
    out[from] = { ...held, blocked: [...new Set([...(held.blocked ?? []), MANAGER])] }
  }
  return out
}

// From -> to -> the actors allowed to make that move.
const MOVES = Object.freeze(withEscalation({
  queued: { assigned: [SERVER] },
  assigned: { in_progress: [ASSIGNEE], queued: [SERVER], blocked: [MANAGER] },
  in_progress: {
    queued: [SERVER],
    blocked: [ASSIGNEE, MANAGER],
    failed: [ASSIGNEE],
    in_review: [ASSIGNEE],
  },
  blocked: { in_progress: [ASSIGNEE] },
  failed: { queued: [MANAGER] },
  in_review: { in_qa: [REVIEWER], in_progress: [REVIEWER] },
  in_qa: { in_security: [QA], in_progress: [QA] },
  in_security: { ready_for_human: [SECURITY], in_progress: [SECURITY] },
  ready_for_human: { done: [HUMAN] },
  done: {},
}))

const ID_SHAPE = /^item-[0-9a-f]{6}$/
const POINTS_MIN = 1
const POINTS_MAX = 13

/** The actors allowed to make one move; empty when the move is not in the table. */
export function allowedActors(from, to) {
  return [...(MOVES[from]?.[to] ?? [])]
}

function refusalReason(from, to, actor, actors) {
  if (actors.length === 0) return `${from} cannot move to ${to}`
  return `${to} from ${from} needs ${actors.join(' or ')}, not ${actor}`
}

/**
 * Moves an item to `to` if `actor` may make that move. Returns
 * { ok: true, item } or { ok: false, reason }. A refusal is passed to onRefuse.
 */
export function transition(item, to, actor, onRefuse = () => {}) {
  const actors = allowedActors(item.state, to)
  if (!actors.includes(actor)) {
    const reason = refusalReason(item.state, to, actor, actors)
    onRefuse({ item: item.id, from: item.state, to, actor, reason })
    return { ok: false, reason }
  }
  return { ok: true, item: { ...item, state: to } }
}

/** Checks a work item before it joins the board. Returns { ok, errors }. */
export function checkIntake(body) {
  const errors = []
  if (!ID_SHAPE.test(body?.item ?? '')) errors.push('item must look like item-<hex>')
  const criteria = body?.acceptance
  if (!Array.isArray(criteria) || criteria.length === 0) {
    errors.push('acceptance needs at least one criterion')
  } else if (!criteria.every(c => typeof c === 'string' && c.trim() !== '')) {
    errors.push('every acceptance criterion must be non-empty text')
  }
  const points = body?.points
  const wholeNumber = Number.isInteger(points)
  if (!wholeNumber || points < POINTS_MIN || points > POINTS_MAX) {
    errors.push(`points must be a whole number from ${POINTS_MIN} to ${POINTS_MAX}`)
  }
  return { ok: errors.length === 0, errors }
}

/** Turns an accepted work item into a queued board item. Returns { ok, item | errors }. */
export function admit(body) {
  const check = checkIntake(body)
  if (!check.ok) return { ok: false, errors: check.errors }
  const item = {
    id: body.item,
    goal: body.goal,
    job: body.job,
    state: 'queued',
    points: body.points,
    acceptance: [...body.acceptance],
  }
  return { ok: true, item }
}

/** A goal is done when all its items are done, empty with no items, else active. */
export function goalState(items) {
  if (items.length === 0) return 'empty'
  if (items.every(item => item.state === 'done')) return 'done'
  return 'active'
}
