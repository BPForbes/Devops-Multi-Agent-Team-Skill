// Handoff payloads: the JSON bodies Orchestration routes between seats
// (see references/handoff-payloads.md). Pure functions, no file access.
import { isAgentId, isGoalId, isItemId, isJob, isTeamId } from './devops-ids.mjs'

/** kind → the seat that signs it, the seat it goes to, and whether teams must differ. */
export const HANDOFF_KINDS = Object.freeze({
  'triage': { from: 'qa', to: 'coder', mustDiffer: true, needsReason: true },
  'research-to-coder': { from: 'researcher', to: 'coder', mustDiffer: false, needsReason: false },
  'coder-to-review': { from: 'coder', to: 'reviewer', mustDiffer: true, needsReason: false },
  'review-to-qa': { from: 'reviewer', to: 'qa', mustDiffer: true, needsReason: false },
  'qa-to-security': { from: 'qa', to: 'security', mustDiffer: true, needsReason: false },
  'security-signoff': {
    from: 'security', to: 'orchestrator', mustDiffer: false, needsReason: false,
  },
})

const SIGN_OFFS = Object.freeze(['clear', 'blocked'])

/** The rule for a kind, or undefined; inherited keys such as `constructor` are not kinds. */
function ruleFor(kind) {
  return Object.hasOwn(HANDOFF_KINDS, kind) ? HANDOFF_KINDS[kind] : undefined
}

/** Shared fields every payload carries, in the order the spec lists them. */
export function makeHandoff(kind, fields) {
  const rule = ruleFor(kind)
  if (rule === undefined) throw new Error(`unknown handoff kind: ${kind}`)
  const payload = {
    kind,
    item: fields.item,
    goal: fields.goal,
    signed_by: fields.signedBy,
    from: { job: rule.from, agent: fields.fromAgent, team: fields.fromTeam },
    to: {
      job: rule.to,
      agent: fields.toAgent ?? '',
      team: fields.toTeam ?? '',
    },
    reason: fields.reason ?? '',
    created: fields.created,
  }
  if (kind === 'security-signoff') payload.result = fields.result
  return payload
}

/** A judging hand-off names a receiving team that differs from the sender. */
function judgeTeamErrors(payload, rule) {
  if (!rule.mustDiffer) return []
  if (!isTeamId(payload.to?.team)) return ['a judging hand-off must name the receiving team']
  if (payload.to.team === payload.from?.team) return ['the receiving team must differ from the sending team']
  return []
}

function timestampErrors(payload) {
  return isTimestamp(payload.created) ? [] : ['created must be a UTC timestamp, ending in Z']
}

const UTC_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** True for an ISO UTC timestamp, such as 2026-11-23T10:00:00Z. */
function isTimestamp(value) {
  return typeof value === 'string' && UTC_STAMP.test(value) && !Number.isNaN(Date.parse(value))
}

function isEmptyOr(value, check) {
  return value === '' || check(value)
}

export function validateHandoff(payload) {
  const errors = []
  const rule = ruleFor(payload?.kind)
  if (rule === undefined) return { ok: false, errors: ['kind is not a handoff kind'] }
  if (!isItemId(payload.item)) errors.push('item must be an item hash')
  if (!isGoalId(payload.goal)) errors.push('goal must be a goal hash')
  if (!isAgentId(payload.signed_by)) errors.push('signed_by must be an agent hash')
  if (payload.from?.job !== rule.from) errors.push(`from.job must be ${rule.from}`)
  if (!isAgentId(payload.from?.agent)) errors.push('from.agent must be an agent hash')
  if (!isTeamId(payload.from?.team)) errors.push('from.team must be a team hash')
  if (payload.signed_by !== payload.from?.agent) {
    errors.push('signed_by must be the sending agent')
  }
  if (payload.to?.job !== rule.to) errors.push(`to.job must be ${rule.to}`)
  if (!isEmptyOr(payload.to?.agent, isAgentId)) {
    errors.push('to.agent must be an agent hash or empty')
  }
  if (!isEmptyOr(payload.to?.team, isTeamId)) errors.push('to.team must be a team hash or empty')
  errors.push(...timestampErrors(payload))
  if (rule.needsReason && String(payload.reason ?? '').trim() === '') {
    errors.push('reason is required: say in one line why it was resent')
  }
  errors.push(...judgeTeamErrors(payload, rule))
  if (payload.kind === 'security-signoff' && !SIGN_OFFS.includes(payload.result)) {
    errors.push('result must be clear or blocked')
  }
  if (!isJob(payload.from?.job)) errors.push('from.job is not a known job')
  return { ok: errors.length === 0, errors }
}
