// Assignment and leases (design: sections 4 and 16). Pure rules: the server
// picks a seat for an item, grants a lease, and returns lapsed items to the
// queue. Persistence is the caller's job (devops-store.mjs).
import { expiredLeases } from './devops-ticks.mjs'
import { transition } from './devops-items.mjs'

export const LEASE_TICKS = 3
export const MAX_TASKS = 2

const PRIMARY = 'primary'
const SECONDARY = 'secondary'
const REQUEUE_FROM = ['assigned', 'in_progress']

/** A seat's active load: how many tasks it holds and their points. */
export function loadOf(seat, assignments) {
  const mine = assignments.filter(a => a.active && a.seat === seat.agent)
  return {
    tasks: mine.length,
    points: mine.reduce((sum, a) => sum + a.points, 0),
  }
}

/** True when the seat is active, does this job, and has room for the item. */
export function eligible(seat, item, assignments) {
  if (seat.status !== 'active' || !seat.jobs.includes(item.job)) return false
  const load = loadOf(seat, assignments)
  if (load.tasks >= MAX_TASKS) return false
  return load.points + item.points <= seat.capacity_points
}

/** The least-loaded eligible seat not in `exclude`; ties go to the lower id. */
export function pickSeat(item, seats, assignments, exclude = []) {
  const ranked = seats
    .filter(seat => !exclude.includes(seat.agent) && eligible(seat, item, assignments))
    .map(seat => ({ seat, points: loadOf(seat, assignments).points }))
    .sort((a, b) => a.points - b.points || a.seat.agent.localeCompare(b.seat.agent))
  return ranked[0]?.seat ?? null
}

function grant({ item, seat, role, tick, lease }) {
  return {
    item: item.id,
    seat: seat.agent,
    job: item.job,
    role,
    points: item.points,
    lease_id: lease,
    lease_expires_tick: tick + LEASE_TICKS,
    active: true,
  }
}

/**
 * Gives a queued item its primary seat and moves it to assigned (server move).
 * Returns { ok, item, assignment } or { ok: false, reason }.
 */
export function assignPrimary({ item, seats, assignments, tick, lease, onRefuse }) {
  const seat = pickSeat(item, seats, assignments)
  if (seat === null) return { ok: false, reason: `no seat can take ${item.id} at tick ${tick}` }
  const moved = transition(item, 'assigned', 'server', onRefuse)
  if (!moved.ok) return { ok: false, reason: moved.reason }
  const assignment = grant({ item, seat, role: PRIMARY, tick, lease })
  return { ok: true, item: moved.item, assignment }
}

/** Adds a secondary seat to an item that already has one active holder. */
export function assignSecondary({ item, seats, assignments, tick, lease }) {
  const holders = assignments.filter(a => a.active && a.item === item.id).map(a => a.seat)
  if (holders.length === 0) return { ok: false, reason: `${item.id} has no primary seat` }
  const seat = pickSeat(item, seats, assignments, holders)
  if (seat === null) return { ok: false, reason: `no second seat can take ${item.id}` }
  return { ok: true, assignment: grant({ item, seat, role: SECONDARY, tick, lease }) }
}

/** Extends a live lease from a heartbeat. A lapsed lease cannot be renewed. */
export function renewLease(assignment, tick) {
  if (!assignment.active || assignment.lease_expires_tick < tick) {
    return { ok: false, reason: `lease ${assignment.lease_id} has ended` }
  }
  return { ok: true, assignment: { ...assignment, lease_expires_tick: tick + LEASE_TICKS } }
}

const holdsLapsed = (item, lapsed) => lapsed.some(a => a.item === item.id)
const stillHeld = (item, assignments) => assignments.some(a => a.active && a.item === item.id)

function requeueIfLost(item, lapsed, assignments, onRefuse) {
  if (!holdsLapsed(item, lapsed) || stillHeld(item, assignments)) return item
  if (!REQUEUE_FROM.includes(item.state)) return item
  const moved = transition(item, 'queued', 'server', onRefuse)
  return moved.ok ? moved.item : item
}

/**
 * Ends every lease that lapsed before `tick`. An item that loses its last
 * active seat goes back to the queue; one still held keeps its state.
 * Returns { items, assignments }.
 */
export function releaseExpired(items, assignments, tick, onRefuse = () => {}) {
  const lapsed = expiredLeases(assignments, tick)
  const lapsedIds = new Set(lapsed.map(a => a.lease_id))
  const next = assignments.map(a => (lapsedIds.has(a.lease_id) ? { ...a, active: false } : a))
  const nextItems = items.map(item => requeueIfLost(item, lapsed, next, onRefuse))
  return { items: nextItems, assignments: next }
}
