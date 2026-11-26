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
  'assignee', 'reviewer', 'qa', 'security', 'manager', 'server', 'human', 'coder', 'researcher',
])
/** Role names that move items as another role: a coder acts as the assignee. */
const ROLE_AS = Object.freeze({ coder: 'assignee' })

/** The roles one member holds: `roles`, or the single `role` of a board written before roles were lists. */
const rolesFrom = member => (Array.isArray(member.roles) ? member.roles : [member.role])
  .filter(Boolean)
const rolesOf = (board, caller) => {
  const member = board.members.find(m => m.agent === caller)
  return member === undefined ? [] : rolesFrom(member)
}
const notOn = (board, caller) => ({ ok: false, reason: `${caller} is not on ${board.team}` })

/** A refused action: its reason, and the record the board keeps for audit. */
function refused(caller, action, reason, detail = {}) {
  return { ok: false, reason, refusal: { action, by: caller, reason, ...detail } }
}

/**
 * Opens a team's board. The members must name a lead (a manager). A member may
 * hold several roles (`roles: ['manager', 'coder', 'researcher']`), so a lead
 * can also work as a coder or researcher; `role` alone still works.
 */
export function openBoard({ team, members }) {
  if (!Array.isArray(members) || !members.some(m => rolesFrom(m).includes(LEAD_ROLE))) {
    return { ok: false, reason: 'a team needs a manager member, its lead' }
  }
  const known = members.every(m => typeof m.agent === 'string'
    && rolesFrom(m).length > 0
    && rolesFrom(m).every(role => MEMBER_ROLES.includes(role)))
  if (!known) {
    return { ok: false, reason: 'every member needs an agent and at least one known role' }
  }
  const agents = members.map(m => m.agent)
  if (new Set(agents).size !== agents.length) {
    return { ok: false, reason: 'a member is listed twice' }
  }
  const board = {
    team,
    members: members.map(m => ({ agent: m.agent, roles: [...new Set(rolesFrom(m))] })),
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
  if (rolesOf(board, caller).length === 0) return notOn(board, caller)
  const admitted = admit(body)
  if (!admitted.ok) return refused(caller, 'intake', admitted.errors.join('; '))
  const { item } = admitted
  if (board.items.some(i => i.id === item.id)) {
    return refused(caller, 'intake', `${item.id} is already on ${board.team}`)
  }
  const placed = { ...item, team: board.team }
  return { ok: true, board: { ...board, items: [...board.items, placed] }, item: placed.id }
}

/**
 * Moves an item as one of the caller's roles: the first held role the move is
 * allowed for. Refusals are returned with their reason.
 */
export function teamMove(board, caller, { item, to }) {
  const roles = rolesOf(board, caller)
  if (roles.length === 0) return notOn(board, caller)
  const current = board.items.find(i => i.id === item)
  if (current === undefined) {
    return refused(caller, 'unknown-item', `${item} is not on ${board.team}`, { item })
  }
  let moved = { ok: false, reason: `${caller} may not move ${item} to ${to}` }
  for (const role of roles) {
    moved = transition(current, to, ROLE_AS[role] ?? role)
    if (moved.ok) break
  }
  if (!moved.ok) return refused(caller, 'move', moved.reason, { item, to })
  const items = board.items.map(i => (i.id === item ? moved.item : i))
  return { ok: true, board: { ...board, items } }
}

/** Records security's sign-off on an item in review. Only a security member may. */
export function teamSignOff(board, caller, { item }) {
  const roles = rolesOf(board, caller)
  if (roles.length === 0) return notOn(board, caller)
  const role = roles.includes('security') ? 'security' : roles[0]
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
  if (!rolesOf(board, caller).includes(LEAD_ROLE)) {
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
