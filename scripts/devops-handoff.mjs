// Handoff payloads: the JSON bodies Orchestration routes between seats
// (see references/handoff-payloads.md). Pure functions, no file access.
import { isAgentId, isItemId, isJob, isTeamId } from './devops-ids.mjs'
import { isGoalId } from './devops-goals.mjs'

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

/** Shared fields every payload carries, in the order the spec lists them. */
export function makeHandoff(kind, fields) {
  const rule = HANDOFF_KINDS[kind]
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

function isEmptyOr(value, check) {
  return value === '' || check(value)
}

/** Returns { ok, errors } for a payload. An empty `to.agent` is allowed. */
export function validateHandoff(payload) {
  const errors = []
  const rule = HANDOFF_KINDS[payload?.kind]
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
  if (rule.needsReason && String(payload.reason ?? '').trim() === '') {
    errors.push('reason is required: say in one line why it was resent')
  }
  if (rule.mustDiffer && payload.to?.team !== '' && payload.to?.team === payload.from?.team) {
    errors.push('the receiving team must differ from the sending team')
  }
  if (payload.kind === 'security-signoff' && !SIGN_OFFS.includes(payload.result)) {
    errors.push('result must be clear or blocked')
  }
  if (!isJob(payload.from?.job)) errors.push('from.job is not a known job')
  return { ok: errors.length === 0, errors }
}
