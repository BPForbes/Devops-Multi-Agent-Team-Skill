// Per-team boards (design: sections 3 and 10). Each team keeps its own board:
// an item lives on one team's board, and only that team's members can act on
// it. Items cannot be done until security signs them off. Pure rules: the
// caller persists the board.
import fs from 'node:fs'
import path from 'node:path'
import { admit, securitySignOff, transition } from './devops-items.mjs'

/** The folder of the team boards, relative to the project folder. */
export const TEAM_DIR = path.join('.devops', 'teams')

/** The seat hashes listed on a team board file, or undefined when the team has none. */
export function readMembers(file) {
  if (!fs.existsSync(file)) return undefined
  return JSON.parse(fs.readFileSync(file, 'utf8')).members?.map(m => m.agent)
}

export const LEAD_ROLE = 'manager'
export const MEMBER_ROLES = Object.freeze([
  'assignee', 'reviewer', 'qa', 'security', 'manager', 'server', 'human',
])

const roleOf = (board, caller) => board.members.find(m => m.agent === caller)?.role ?? null
const notOn = (board, caller) => ({ ok: false, reason: `${caller} is not on ${board.team}` })

/** A refused action: its reason, and the record the board keeps for audit. */
function refused(caller, action, reason, detail = {}) {
  return { ok: false, reason, refusal: { action, by: caller, reason, ...detail } }
}

/** Opens a team's board. The members must name a lead (a manager). */
export function openBoard({ team, members }) {
  if (!Array.isArray(members) || !members.some(m => m.role === LEAD_ROLE)) {
    return { ok: false, reason: 'a team needs a manager member, its lead' }
  }
  const known = members.every(m => typeof m.agent === 'string' && MEMBER_ROLES.includes(m.role))
  if (!known) return { ok: false, reason: 'every member needs an agent and a known role' }
  const agents = members.map(m => m.agent)
  if (new Set(agents).size !== agents.length) {
    return { ok: false, reason: 'a member is listed twice' }
  }
  const board = {
    team,
    members: members.map(({ agent, role }) => ({ agent, role })),
    items: [],
    refusals: [],
  }
  return { ok: true, board }
}

/** Returns the board with one refused action appended, so the refusal is kept. */
export function recordRefusal(board, refusal) {
  return { ...board, refusals: [...(board.refusals ?? []), refusal] }
}

/** Adds a work item to this team's board. The caller must be a member. */
export function teamIntake(board, caller, body) {
  if (roleOf(board, caller) === null) return notOn(board, caller)
  const admitted = admit(body)
  if (!admitted.ok) return refused(caller, 'intake', admitted.errors.join('; '))
  const { item } = admitted
  if (board.items.some(i => i.id === item.id)) {
    return refused(caller, 'intake', `${item.id} is already on ${board.team}`)
  }
  const placed = { ...item, team: board.team }
  return { ok: true, board: { ...board, items: [...board.items, placed] }, item: placed.id }
}

/** Moves an item as the caller's role. Refusals are returned with their reason. */
export function teamMove(board, caller, { item, to }) {
  const role = roleOf(board, caller)
  if (role === null) return notOn(board, caller)
  const current = board.items.find(i => i.id === item)
  if (current === undefined) {
    return refused(caller, 'unknown-item', `${item} is not on ${board.team}`, { item })
  }
  const moved = transition(current, to, role)
  if (!moved.ok) return refused(caller, 'move', moved.reason, { item, to })
  const items = board.items.map(i => (i.id === item ? moved.item : i))
  return { ok: true, board: { ...board, items } }
}

/** Records security's sign-off on an item in review. Only a security member may. */
export function teamSignOff(board, caller, { item }) {
  const role = roleOf(board, caller)
  if (role === null) return notOn(board, caller)
  const current = board.items.find(i => i.id === item)
  if (current === undefined) {
    return refused(caller, 'unknown-item', `${item} is not on ${board.team}`, { item })
  }
  const signed = securitySignOff(current, { agent: caller, role })
  if (!signed.ok) return refused(caller, 'signoff', signed.reason, { item })
  const items = board.items.map(i => (i.id === item ? signed.item : i))
  return { ok: true, board: { ...board, items } }
}

const ATTENTION = Object.freeze({
  blocked: ['blocked', 'unblock it or move it to failed'],
  failed: ['failed', 'send it back to the queue, or close it out'],
  in_security: ['awaiting_signoff', 'security must sign it off before it can be done'],
  ready_for_human: ['awaiting_lead', 'the team lead signs it off as done'],
})

/**
 * The team lead's view: what on this team's board needs a decision. Only the
 * lead may read it. Returns { ok, attention } or { ok: false, reason }.
 */
export function needsAttention(board, caller) {
  if (roleOf(board, caller) !== LEAD_ROLE) {
    return { ok: false, reason: `only the ${board.team} lead may read needs-attention` }
  }
  const attention = []
  for (const item of board.items) {
    const entry = ATTENTION[item.state]
    if (entry !== undefined) {
      attention.push({ id: item.id, kind: entry[0], state: item.state, next: entry[1] })
    }
  }
  return { ok: true, team: board.team, attention }
}
