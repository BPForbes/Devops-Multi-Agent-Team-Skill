// Help ladder, closing answers and question routing (design: sections 3b, 7).
// Pure rules. A seat asks the cheapest source first. An answer is usable only
// when a different seat closed it with evidence on the current tree.

export const LADDER = Object.freeze([
  'project docs', 'tool docs', 'online', 'teammate', 'team lead', 'other team',
])
const TEAMMATE_STEP = 4
const LEAD_STEP = 5
const MIN_TEAM_FOR_TEAMMATE = 2
export const MAX_REQUESTS_PER_ITEM = 3
const VERDICTS = Object.freeze(['PASS', 'BLOCKED'])
const TREE_SHAPE = /^[0-9a-f]{40}$/
const EVIDENCE_FIELDS = Object.freeze([
  ['command', 'exit_code'],
  ['source', 'line'],
  ['reproduction'],
  ['docs', 'version'],
])

const blank = text => typeof text !== 'string' || text.trim() === ''

/** The next ladder step after `step`, skipping steps that cannot apply. */
export function nextStep({ step, teamSize, askerIsLead }) {
  for (let next = step + 1; next <= LADDER.length; next += 1) {
    if (next === TEAMMATE_STEP && teamSize < MIN_TEAM_FOR_TEAMMATE) continue
    if (next === LEAD_STEP && askerIsLead) continue
    return next
  }
  return null
}

/**
 * Opens a HelpRequest. Every request carries an online query. After the
 * item's third request the seat is escalated to the manager instead.
 */
export function openRequest({ item, seat, step, question, onlineQuery, prior }) {
  if (!Number.isInteger(step) || step < 1 || step > LADDER.length) {
    return { ok: false, reason: `step must be 1 to ${LADDER.length}` }
  }
  if (blank(question) || blank(onlineQuery)) {
    return { ok: false, reason: 'a question and an online query are required' }
  }
  if (prior.some(r => r.item === item && r.question === question)) {
    return { ok: false, reason: 'this question was already asked; see the earlier request' }
  }
  const mine = prior.filter(r => r.item === item && r.seat === seat).length
  if (mine >= MAX_REQUESTS_PER_ITEM) {
    return { ok: false, escalate: 'manager', reason: `${seat} has used its requests on ${item}` }
  }
  return { ok: true, request: { item, seat, step, question, online_query: onlineQuery } }
}

function validEvidence(evidence) {
  if (evidence === null || typeof evidence !== 'object') return false
  const matches = EVIDENCE_FIELDS.filter(fields => fields.every(f => evidence[f] !== undefined))
  return matches.length === 1 && Object.keys(evidence).length === matches[0].length
}

/**
 * Closes an answer. The verifier must not be the author, the verdict is PASS
 * or BLOCKED, and the evidence is exactly one kind. Returns { ok, answer | errors }.
 */
export function closeAnswer({ request, text, author, verifier, verdict, evidence, tree, tick }) {
  const errors = []
  if (!VERDICTS.includes(verdict)) errors.push('verdict must be PASS or BLOCKED')
  if (blank(verifier)) errors.push('a verifier is required')
  if (verifier === author) errors.push('the author may not verify its own answer')
  if (!TREE_SHAPE.test(tree ?? '')) errors.push('tree must be a 40-character hash')
  if (!validEvidence(evidence)) errors.push('evidence must be exactly one kind')
  if (errors.length > 0) return { ok: false, errors }
  const answer = {
    request: request.item,
    text,
    verdict,
    verifier,
    evidence,
    tree,
    closed_tick: tick,
  }
  return { ok: true, answer }
}

/** An answer is relied on only if it PASSed on the tree now checked out. */
export function usable(answer, currentTree) {
  return answer.verdict === 'PASS' && answer.tree === currentTree
}

/** Only the server routes a question to a human; a seat may not. */
export function routeQuestion({ fromRole, route }) {
  if (route === 'human' && fromRole !== 'server') {
    return { ok: false, reason: 'only the server routes a question to a human' }
  }
  return { ok: true, route }
}
