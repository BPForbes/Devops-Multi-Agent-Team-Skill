// The server's tick counter (design: sections 1, 9 and 16.6). Pure rules over
// a state object; the caller persists it with devops-store.mjs.
import { updateJson } from './devops-store.mjs'

const ITEMS_PER_TICK = 3
const MINUTES_PER_TICK = 15
const TICKS_PER_SPRINT = 10

export const TICK_CONFIG = Object.freeze({
  itemsPerTick: ITEMS_PER_TICK,
  minutesPerTick: MINUTES_PER_TICK,
  ticksPerSprint: TICKS_PER_SPRINT,
})

const MINUTE_MS = 60000

/** A fresh tick state, with no sprint open, starting tick 0 at `nowMs`. */
export function initialTicks(nowMs = 0) {
  return {
    tick: 0,
    sprint: null,
    sprint_tick: 0,
    sprint_status: 'closed',
    completed_since_tick: 0,
    tick_started_ms: { 0: nowMs },
  }
}

/**
 * Counts one completed item and advances the tick when the item count or the
 * elapsed minutes reach their limit. Returns { state, ticked }.
 */
export function recordCompletion(state, { nowMs, config = TICK_CONFIG }) {
  const next = structuredClone(state)
  next.completed_since_tick += 1
  const lastMs = next.tick_started_ms[String(next.tick)] ?? nowMs
  const due = next.completed_since_tick >= config.itemsPerTick
    || nowMs - lastMs >= config.minutesPerTick * MINUTE_MS
  if (!due) return { state: next, ticked: false }
  return { state: advanceTick(next, nowMs, config), ticked: true }
}

/** Advances one tick unconditionally; rolls the sprint over at its last tick. */
export function advanceTick(state, nowMs, config = TICK_CONFIG) {
  const next = structuredClone(state)
  next.tick += 1
  next.completed_since_tick = 0
  next.tick_started_ms[String(next.tick)] = nowMs
  if (next.sprint_status === 'open') {
    next.sprint_tick += 1
    if (next.sprint_tick >= config.ticksPerSprint) next.sprint_status = 'closed'
  }
  return next
}

/** Opens a sprint at the current tick. Refused while another sprint is open. */
export function openSprint(state, sprintId) {
  if (state.sprint_status === 'open') throw new Error(`sprint ${state.sprint} is still open`)
  const next = structuredClone(state)
  next.sprint = sprintId
  next.sprint_tick = 0
  next.sprint_status = 'open'
  return next
}

/** The wall-clock time a tick started, or null when it is unknown. */
export function wallClockOf(state, tick) {
  const ms = state.tick_started_ms[String(tick)]
  return ms === undefined ? null : new Date(ms).toISOString()
}

/** Assignments whose lease ended before `tick`. */
export function expiredLeases(assignments, tick) {
  return assignments.filter(a => a.lease_expires_tick < tick)
}

/** Persists a completion under the store's lock. Returns { state, ticked }. */
export function recordCompletionAt(file, { nowMs, config = TICK_CONFIG }) {
  let ticked = false
  const state = updateJson(file, initialTicks(nowMs), current => {
    const result = recordCompletion(current, { nowMs, config })
    ticked = result.ticked
    return result.state
  })
  return { state, ticked }
}

/**
 * The leader lease is wall-clock time, so a paused leader can expire
 * (ticks only move while a leader runs). Returns { acquired, epoch }.
 * A takeover increments the epoch; the store refuses writes from an older epoch.
 */
export function acquireLeader(file, owner, nowMs, leaseMs) {
  let result
  updateJson(file, { owner: null, epoch: 0, expires_ms: 0 }, current => {
    const held = current.owner !== null && current.expires_ms > nowMs
    if (held && current.owner !== owner) {
      result = { acquired: false, epoch: current.epoch }
      return current
    }
    const epoch = current.owner === owner ? current.epoch : current.epoch + 1
    result = { acquired: true, epoch }
    return { owner, epoch, expires_ms: nowMs + leaseMs }
  })
  return result
}

/** True when `epoch` is still the leader epoch. An older leader must not write. */
export function fenceOk(file, epoch) {
  let ok = false
  updateJson(file, { owner: null, epoch: 0, expires_ms: 0 }, current => {
    ok = current.epoch === epoch
    return current
  })
  return ok
}
