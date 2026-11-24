// Sprint planning, review and retrospective (design: sections 5.4, 5.6, 5.7).
// Pure rules: commit work within each seat's capacity, compare committed work
// with what finished, and turn retro actions into owned backlog items.
import { openSprint } from './devops-ticks.mjs'

const RETRO_POINTS = 1

/**
 * Commits items to their owners without going over a seat's capacity.
 * Each item has an id, an owner and points; each seat has capacity_points.
 * Returns { committed, refused, load }: load is points per seat.
 */
export function planCommitments({ items, seats }) {
  const capacity = new Map(seats.map(seat => [seat.agent, seat.capacity_points]))
  const load = new Map(seats.map(seat => [seat.agent, 0]))
  const committed = []
  const refused = []
  for (const item of items) {
    if (!capacity.has(item.owner)) {
      refused.push({ id: item.id, reason: `${item.owner} is not a seat` })
      continue
    }
    const next = load.get(item.owner) + item.points
    if (next > capacity.get(item.owner)) {
      refused.push({ id: item.id, reason: `${item.owner} would be over capacity` })
      continue
    }
    load.set(item.owner, next)
    committed.push(item.id)
  }
  return { committed, refused, load: Object.fromEntries(load) }
}

/** Opens the sprint and records its commitments. Refused while one is open. */
export function startSprint({ state, sprintId, plan }) {
  return { state: openSprint(state, sprintId), plan }
}

/** The planning summary: a MeetingSummary-shaped record with its decisions. */
export function planningSummary({ sprintId, plan, nextMeetingTick }) {
  const decisions = [`sprint ${sprintId}: ${plan.committed.length} items committed`]
  for (const refusal of plan.refused) {
    decisions.push(`not committed ${refusal.id}: ${refusal.reason}`)
  }
  return { decisions, action_items: [], next_meeting_tick: nextMeetingTick, capped: false }
}

/**
 * The sprint review: committed items that finished and slipped, and per seat
 * how many committed items were done. `items` carry their current state.
 */
export function reviewSprint({ committed, items, owners }) {
  const done = new Set(items.filter(item => item.state === 'done').map(item => item.id))
  const perSeat = {}
  for (const [id, owner] of Object.entries(owners)) {
    perSeat[owner] ??= { committed: 0, done: 0 }
    if (committed.includes(id)) perSeat[owner].committed += 1
    if (committed.includes(id) && done.has(id)) perSeat[owner].done += 1
  }
  return {
    finished: committed.filter(id => done.has(id)),
    slipped: committed.filter(id => !done.has(id)),
    perSeat,
  }
}

/**
 * Turns retro actions into backlog items. An action with no owner, or no
 * text, is refused; an owned action becomes a queued item with that owner.
 */
export function retroActionItems({ actions, goal, seats }) {
  const known = new Set(seats.map(seat => seat.agent))
  const items = []
  const refused = []
  for (const action of actions) {
    if (!known.has(action.owner)) {
      refused.push({ id: action.id, reason: 'an action needs an owner who is a seat' })
    } else if (typeof action.text !== 'string' || action.text.trim() === '') {
      refused.push({ id: action.id, reason: 'an action needs text' })
    } else {
      items.push({
        id: action.id,
        goal,
        owner: action.owner,
        state: 'queued',
        points: RETRO_POINTS,
        acceptance: [action.text],
      })
    }
  }
  return { items, refused }
}
