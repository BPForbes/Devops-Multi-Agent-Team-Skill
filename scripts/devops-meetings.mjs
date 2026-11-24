// Check-ins, standups and one-on-ones (design: section 5). Pure rules that
// validate check-ins, build and close meetings, and decide when a one-on-one
// is due. The caller persists and routes what this returns.

export const CHECKIN_STATUSES = Object.freeze(['ok', 'blocked', 'failed', 'done'])
export const CHECKIN_NEEDS = Object.freeze(['none', 'seat', 'manager', 'orchestrator', 'human'])
export const MAX_TURNS = 3
export const STALL_TICKS = 3
export const ONE_ON_ONE_TOPICS = Object.freeze([
  'progress', 'blockers', 'workload', 'primary/secondary mix',
])

const SKIP_NO_CHANGE = 'no seat changed state since the last standup'
const SKIP_NO_WORK = 'no seat has open work'

/** Checks a CheckIn body. Returns { ok, errors }. */
export function checkCheckIn(body) {
  const errors = []
  if (!CHECKIN_STATUSES.includes(body?.status)) {
    errors.push(`status must be one of ${CHECKIN_STATUSES.join(', ')}`)
  }
  if (!CHECKIN_NEEDS.includes(body?.needs)) {
    errors.push(`needs must be one of ${CHECKIN_NEEDS.join(', ')}`)
  }
  if (typeof body?.summary !== 'string' || body.summary.trim() === '') {
    errors.push('summary is required')
  }
  return { ok: errors.length === 0, errors }
}

/** What each seat is doing now, as sorted text. Unchanged means nothing moved. */
export function stateSignature(assignments, items) {
  const stateOf = new Map(items.map(item => [item.id, item.state]))
  return assignments
    .filter(a => a.active)
    .map(a => `${a.seat}:${a.item}:${stateOf.get(a.item) ?? 'unknown'}`)
    .sort()
    .join('|')
}

function openSeats(assignments, items) {
  const open = new Set(items.filter(item => item.state !== 'done').map(item => item.id))
  const seats = assignments.filter(a => a.active && open.has(a.item)).map(a => a.seat)
  return [...new Set(seats)].sort()
}

/**
 * Decides whether a standup runs this tick. It is skipped, with the reason
 * logged, when no seat has open work or nothing changed since the last one.
 * Returns { kind: 'skipped', reason } or { kind: 'invite', meeting }.
 */
export function openStandup({ tick, assignments, items, lastSignature }) {
  const attendees = openSeats(assignments, items)
  if (attendees.length === 0) return { kind: 'skipped', tick, reason: SKIP_NO_WORK }
  const signature = stateSignature(assignments, items)
  if (signature === lastSignature) return { kind: 'skipped', tick, reason: SKIP_NO_CHANGE }
  const meeting = {
    meeting_kind: 'standup',
    at_tick: tick,
    attendees,
    replies: {},
    updates: [],
    max_turns: MAX_TURNS,
    signature,
  }
  return { kind: 'invite', meeting }
}

/** Records a seat's MeetingUpdate. Only an invited seat replies, once. */
export function recordUpdate(meeting, { seat, did, will_do: willDo, blocked }) {
  if (!meeting.attendees.includes(seat)) return { ok: false, reason: `${seat} is not invited` }
  if (meeting.replies[seat] === true) return { ok: false, reason: `${seat} already replied` }
  const next = structuredClone(meeting)
  next.replies[seat] = true
  next.updates.push({ seat, did, will_do: willDo, blocked })
  return { ok: true, meeting: next }
}

/** True once every invited seat has replied or the turn cap is reached. */
export function standupOver(meeting) {
  const replied = meeting.attendees.every(seat => meeting.replies[seat] === true)
  return replied || meeting.updates.length >= meeting.max_turns
}

/**
 * Ends a standup with its summary. Blocked work is listed for the manager;
 * `capped` is true when the turn cap ended the meeting before every seat replied.
 */
export function closeStandup(meeting, nextTick) {
  const replied = meeting.attendees.every(seat => meeting.replies[seat] === true)
  const blocked = meeting.updates.flatMap(u => (u.blocked ?? []).map(text => ({
    seat: u.seat,
    text,
  })))
  return {
    decisions: blocked.map(b => `review ${b.seat}: ${b.text}`),
    action_items: [],
    next_meeting_tick: nextTick,
    capped: !replied,
  }
}

/** True when a seat's one-on-one is due: its lease lapsed or it stalled. */
export function oneOnOneDue({ assignment, lastChangeTick, tick }) {
  if (assignment.lease_expires_tick < tick) return { due: true, reason: 'lease expired' }
  if (tick - lastChangeTick >= STALL_TICKS) return { due: true, reason: 'stalled' }
  return { due: false, reason: 'on track' }
}

/** A one-on-one between the manager and one seat. */
export function oneOnOneInvite({ manager, seat, tick, reason }) {
  return {
    meeting_kind: 'one_on_one',
    at_tick: tick,
    attendees: [manager, seat].sort(),
    reason,
    topics: [...ONE_ON_ONE_TOPICS],
    replies: {},
    updates: [],
    max_turns: MAX_TURNS,
  }
}
