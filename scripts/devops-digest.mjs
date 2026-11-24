// Human communication (design: section 6). Pure rules: the human is interrupted
// only for a gate, a human-only decision, or a failure past its retries; all
// else goes into one digest per sprint; a human reply answers a question by id.

export const INTERRUPT_KINDS = Object.freeze(['gate', 'human_decision', 'failure'])
export const MAX_ASK_LENGTH = 200

/** True when this event must interrupt the human now. */
export function shouldInterrupt({ kind, retriesUsed, retryLimit }) {
  if (kind === 'failure') return retriesUsed >= retryLimit
  return INTERRUPT_KINDS.includes(kind)
}

/** One short interrupt with one clear ask. Returns { ok, message | reason }. */
export function interruptMessage({ kind, ask }) {
  if (!INTERRUPT_KINDS.includes(kind)) return { ok: false, reason: `unknown kind ${kind}` }
  if (typeof ask !== 'string' || ask.trim() === '') {
    return { ok: false, reason: 'an interrupt needs one ask' }
  }
  if (ask.includes('\n') || ask.length > MAX_ASK_LENGTH) {
    return { ok: false, reason: `an interrupt is one line of at most ${MAX_ASK_LENGTH} characters` }
  }
  return { ok: true, message: { kind, ask } }
}

/** The sprint digest: done, slipped, decisions needed and retro actions. */
export function buildDigest({ sprint, finished, slipped, decisions, retroActions }) {
  return {
    sprint,
    done: [...finished],
    slipped: [...slipped],
    decisions_needed: [...decisions],
    retro_actions: [...retroActions],
  }
}

/** A sprint gets exactly one digest. Returns { due } with the reason. */
export function digestDue({ sprint, sentSprints }) {
  if (sentSprints.includes(sprint)) return { due: false, reason: `${sprint} already has a digest` }
  return { due: true, reason: 'end of sprint' }
}

/** A HumanAnswer must answer an open question by id; slash commands are refused. */
export function checkHumanAnswer({ question, text, openQuestions }) {
  if (!openQuestions.includes(question)) {
    return { ok: false, reason: `${question} is not an open question` }
  }
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'an answer needs text' }
  }
  if (text.trim().startsWith('/')) {
    return { ok: false, reason: 'answer in plain words, not a gate command' }
  }
  return { ok: true }
}
