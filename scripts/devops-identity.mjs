// Identity, sender and path rules (design: section 10 and 10.1). Pure checks.
// Not built yet: server-issued credentials. Until they exist, a seat's
// identity is the one the server bound at seat start, and checks against it
// are advisory.
import crypto from 'node:crypto'
import path from 'node:path'

const SEATS = Object.freeze(['researcher', 'coder', 'reviewer', 'qa', 'security', 'manager'])

// Which roles may send each envelope kind. Any seat may send the work it
// reports (checkins, updates, handoffs, help and questions).
const SENDERS = Object.freeze({
  'server.tick': ['server'],
  'seat.profile': ['server'],
  'run.record': ['server'],
  'work.item': ['manager'],
  'work.assignment': ['manager'],
  'meeting.invite': ['manager'],
  'human.digest': ['manager'],
  'human.answer': ['human'],
  'run.authorize': ['human'],
})

const SEAT_WORK = Object.freeze([
  'work.checkin', 'work.heartbeat', 'work.accept', 'work.estimate',
  'meeting.update', 'meeting.summary', 'question.ask', 'question.answer',
  'help.request', 'help.answer', 'handoff.triage', 'handoff.send-back',
])

/** The roles allowed to send a kind. Unknown kinds are allowed to no one. */
export function sendersOf(kind) {
  if (SENDERS[kind]) return SENDERS[kind]
  if (SEAT_WORK.includes(kind) || kind.startsWith('handoff.')) return SEATS
  return []
}

/**
 * Refuses an envelope whose `from` is not the identity the server bound (the
 * seat, and the team hash when one is bound), or whose kind the sender's role
 * may not send. Returns { ok, reason }.
 */
export function checkSender({ boundSeat, boundRole, boundTeam, envelope }) {
  if (boundSeat === undefined) return { ok: false, reason: 'no seat is bound' }
  if (envelope.from?.agent !== boundSeat) {
    return { ok: false, reason: `envelope says ${envelope.from?.agent}, not ${boundSeat}` }
  }
  if (boundTeam !== undefined && envelope.from?.team !== boundTeam) {
    return { ok: false, reason: `envelope says ${envelope.from?.team}, not ${boundTeam}` }
  }
  if (!sendersOf(envelope.kind).includes(boundRole)) {
    return { ok: false, reason: `a ${boundRole} may not send ${envelope.kind}` }
  }
  return { ok: true }
}

const ROLE_DENIED = Object.freeze({
  manager: ['push', 'approve', 'gate'],
})

/** Whether a role may use a tool. The manager cannot push, approve or change gates. */
export function roleMayUse(role, tool) {
  return !(ROLE_DENIED[role] ?? []).includes(tool)
}

/** A seat may not route a question to a human; only the server may. */
export function checkRoute({ boundRole, route }) {
  if (route === 'human' && boundRole !== 'server') {
    return { ok: false, reason: 'only the server routes to a human' }
  }
  return { ok: true }
}

const PROTECTED = Object.freeze(['.devops/standards.json', 'scripts/devops-lint-rules.mjs'])

/**
 * Artifact paths must stay inside the repo root and may not name a protected
 * file. The check is lexical; the caller resolves symlinks before it.
 */
export function checkArtifactPath({ repoRoot, artifact }) {
  if (path.isAbsolute(artifact)) return { ok: false, reason: 'artifact paths are relative' }
  const resolved = path.resolve(repoRoot, artifact)
  const root = path.resolve(repoRoot)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { ok: false, reason: 'artifact path leaves the repo root' }
  }
  const relative = path.relative(root, resolved).split(path.sep).join('/')
  if (PROTECTED.includes(relative)) return { ok: false, reason: 'artifact names a protected file' }
  return { ok: true }
}

const chainOf = (key, prev, event) => crypto.createHmac('sha256', key)
  .update(`${prev}\n${JSON.stringify(event)}`)
  .digest('hex')

/**
 * A link function for appendEvent: (previousLink, event) => the stored event
 * with its chain link. The store calls it under the log's lock.
 */
export function chainLinker(key) {
  return (prev, event) => ({ ...event, chain: chainOf(key, prev, event) })
}

/** Adds a hash-chain link to each event, keyed by the server's secret. */
export function chainEvents(events, key) {
  let prev = 'genesis'
  return events.map(event => {
    const link = chainOf(key, prev, event)
    prev = link
    return { ...event, chain: link }
  })
}

/** True when every event's link matches; a tampered or reordered log fails. */
export function verifyChain(events, key) {
  let prev = 'genesis'
  return events.every(event => {
    const { chain, ...rest } = event
    const expected = chainOf(key, prev, rest)
    prev = chain
    return chain === expected
  })
}
