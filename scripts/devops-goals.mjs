// Goal hashes and the goal memory file (see references/goal-hashes.md).
// Pure functions over a plain object: callers read and write the JSON file.
import { isTeamId, mintGoalId } from './devops-ids.mjs'

const TRAILER_RE = /^Goal:[ \t]*(goal-[0-9a-f]{6})[ \t]*$/gm
const MINT_TRIES = 16

/** Same goal text: trimmed, whitespace collapsed, case ignored. */
export function normalizeGoalText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function emptyMemory() {
  return { version: 1, goals: {}, teams: {}, agents: {}, superseded: {} }
}

/** The hash of a goal already in memory with the same text, or undefined. */
export function findGoalByText(memory, text) {
  const key = normalizeGoalText(text)
  if (key === '') return undefined
  return Object.keys(memory.goals).find(hash => normalizeGoalText(memory.goals[hash].text) === key)
}

/** Every `Goal: goal-<hex>` trailer in a commit message, without repeats. */
export function goalTrailers(message) {
  const found = new Set()
  for (const match of String(message ?? '').matchAll(TRAILER_RE)) found.add(match[1])
  return [...found]
}

function checkPod(team, judgedBy) {
  if (!isTeamId(team)) throw new Error(`not a team hash: ${team}`)
  if (!Array.isArray(judgedBy)) throw new Error('judged_by must be a list of team hashes')
  for (const pod of judgedBy) {
    if (!isTeamId(pod)) throw new Error(`not a team hash: ${pod}`)
    if (pod === team) throw new Error(`${team} cannot judge its own goal`)
  }
}

function indexTeam(memory, team, hash) {
  const row = memory.teams[team] ?? { goals: [] }
  if (!row.goals.includes(hash)) row.goals.push(hash)
  memory.teams[team] = row
}

/**
 * Adds a goal, or reuses the hash of a goal with the same text.
 * Returns { hash, reused, memory } and never changes the input.
 */
export function addGoal(memory, { text, metric = '', team, judgedBy = [], at, mint = mintGoalId }) {
  checkPod(team, judgedBy)
  const next = structuredClone(memory)
  const existing = findGoalByText(next, text)
  if (existing !== undefined) {
    const reused = assignGoal(next, { hash: existing, team, judgedBy, at, event: 'reused' })
    return { hash: existing, reused: true, memory: reused }
  }
  let hash = mint()
  for (let tries = 0; next.goals[hash] !== undefined; tries += 1) {
    if (tries >= MINT_TRIES) throw new Error('could not mint a goal hash that is not in memory')
    hash = mint()
  }
  next.goals[hash] = {
    text,
    metric,
    team,
    judged_by: [...judgedBy],
    status: 'active',
    agents: [],
    history: [{ at, event: 'minted', team }],
  }
  indexTeam(next, team, hash)
  return { hash, reused: false, memory: next }
}

/** Gives a known goal to a pod and records it in history. Returns a new memory. */
export function assignGoal(memory, { hash, team, judgedBy = [], at, event = 'assigned' }) {
  checkPod(team, judgedBy)
  const next = structuredClone(memory)
  const goal = next.goals[hash]
  if (goal === undefined) throw new Error(`unknown goal: ${hash}`)
  goal.team = team
  goal.judged_by = [...judgedBy]
  goal.history.push({ at, event, team, judged_by: [...judgedBy] })
  indexTeam(next, team, hash)
  return next
}

/**
 * Gives a changed goal a new hash (or the hash of a goal with the new
 * text) and points the old hash at it. Returns { hash, reused, memory }.
 */
export function supersedeGoal(memory, { hash, text, metric, team, judgedBy, at, mint }) {
  if (memory.goals[hash] === undefined) throw new Error(`unknown goal: ${hash}`)
  const added = addGoal(memory, { text, metric, team, judgedBy, at, mint })
  if (added.hash === hash) throw new Error('the new goal has the same hash as the old one')
  const next = added.memory
  next.goals[hash].status = 'superseded'
  next.goals[hash].history.push({ at, event: 'superseded', by: added.hash })
  next.superseded[hash] = added.hash
  return { hash: added.hash, reused: added.reused, memory: next }
}
