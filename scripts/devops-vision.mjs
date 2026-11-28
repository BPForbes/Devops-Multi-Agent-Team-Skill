// Client vision and deadlocks (references/deadlock.md). Pure rules; the server
// and the mod persist the board.
import { BOARD_FILE, emptyBoard, mintId } from './devops-board.mjs'
import { isMain } from './devops-main.mjs'
import { UNFENCED, projectPath, updateJson } from './devops-store.mjs'

/** Standups a goal may go unchanged across before it is stalled. */
export const STALL_STANDUPS = 2
/** Send-backs a goal may take before it is stalled. */
export const SEND_BACKS = 2
export const VISION_SOURCES = Object.freeze(['client', 'ba', 'lead'])

const need = (ok, message) => {
  if (!ok) throw new Error(message)
}
const filled = text => typeof text === 'string' && text.trim() !== ''
const timeOf = at => Date.parse(at ?? '') || 0

/** The newest vision note on a goal, or undefined. */
export const latestVision = goal => (goal?.vision ?? []).at(-1)

/** Adds a vision note: the client's words, or the BA's or lead's reading of them. */
export function addVisionNote(board, { goal, text, source, by, at }) {
  const next = structuredClone(board)
  const row = next.goals[goal]
  need(row !== undefined, `goal is not on the board: ${goal}`)
  need(VISION_SOURCES.includes(source), `vision source is one of ${VISION_SOURCES.join(', ')}`)
  need(filled(text), 'a vision note needs its text')
  row.vision = [...(row.vision ?? []), { text: text.trim(), source, by, at }]
  row.history = [...(row.history ?? []), { at, event: 'vision', by, source }]
  return next
}

/** The last time anything changed on a goal: its newest history entry. */
export function lastChangeOf(goal) {
  const times = (goal.history ?? []).map(event => event.at).filter(Boolean)
  return times.length === 0 ? '' : times.reduce((a, b) => (timeOf(b) > timeOf(a) ? b : a))
}

/** The team an allocated goal is built by, or undefined. */
export function teamOfGoal(board, goal) {
  for (const allocation of Object.values(board.allocations ?? {})) {
    const team = allocation.teams.find(t => (t.goals ?? []).includes(goal))
    if (team !== undefined) return team.team
  }
  return undefined
}

/** Held standups of one team held after a time. */
function standupsAfter(board, team, at) {
  return Object.values(board.meetings ?? {}).filter(m => m.team === team && m.kind === 'daily'
    && m.state === 'held' && timeOf(m.held_at) > timeOf(at)).length
}

/**
 * The goals that have stopped moving: unchanged across `standups` held
 * standups of their team, or sent back `sendBacks` times. A goal with an
 * open deadlock is not listed again.
 */
export function stalledGoals(board, { standups = STALL_STANDUPS, sendBacks = SEND_BACKS } = {}) {
  const open = new Set(Object.values(board.deadlocks ?? {})
    .filter(d => d.state !== 'forwarded').map(d => d.goal))
  const found = []
  for (const [goal, row] of Object.entries(board.goals)) {
    if (row.state === 'done' || open.has(goal)) continue
    const team = teamOfGoal(board, goal)
    const reasons = []
    const since = lastChangeOf(row)
    if (team !== undefined && standupsAfter(board, team, since) >= standups) {
      reasons.push(`unchanged across ${standups} standups`)
    }
    const returns = (row.history ?? []).filter(e => e.event === 'returned').length
    if (returns >= sendBacks) reasons.push(`sent back ${returns} times`)
    if (reasons.length > 0) found.push({ goal, team: team ?? null, reasons })
  }
  return found
}

/**
 * The team lead raises a stalled goal. The lead notes whether the goal already
 * has a vision the lead can read; the BA decides from it.
 */
export function raiseDeadlock(board, { goal, team, lead, reason, at, mint }) {
  const next = structuredClone(board)
  need(next.goals[goal] !== undefined, `goal is not on the board: ${goal}`)
  need(filled(reason), 'a deadlock needs a reason')
  const deadlocks = next.deadlocks ?? {}
  const open = Object.values(deadlocks).find(d => d.goal === goal && d.state !== 'forwarded')
  need(open === undefined, `${goal} already has an open deadlock: ${open?.id}`)
  const id = mintId('deadlock', deadlocks, mint)
  const vision = latestVision(next.goals[goal])
  const record = {
    id, goal, team, raised_by: lead, reason: reason.trim(), state: 'raised', at,
    vision_found: vision !== undefined, vision: vision?.text ?? null,
    history: [{ at, event: 'raised', by: lead }],
  }
  next.deadlocks = { ...deadlocks, [id]: record }
  return { board: next, id }
}

function stepDeadlock(board, id, { from, to, event, by, at, extra = {} }) {
  const next = structuredClone(board)
  const record = next.deadlocks?.[id]
  need(record !== undefined, `unknown deadlock: ${id}`)
  need(from.includes(record.state), `${id} is ${record.state}, not ${from.join(' or ')}`)
  Object.assign(record, extra, { state: to })
  record.history = [...record.history, { at, event, by }]
  return next
}

/**
 * The BA reads the vision and either gives it (`vision`), which goes back to the
 * lead as feedback, or asks the client (`question`), which pauses the item until
 * the person answers.
 */
export function resolveDeadlock(board, { id, ba, analyst, vision, question, at }) {
  need(ba === analyst, `only the Business Analyst (${analyst}) resolves a deadlock`)
  const from = ['raised']
  if (filled(question)) {
    return stepDeadlock(board, id, {
      from, to: 'with_client', event: 'asked_client', by: ba, at,
      extra: { question: question.trim() },
    })
  }
  need(filled(vision), 'the BA gives the vision, or a question for the client')
  const next = addVisionNote(board, {
    goal: board.deadlocks[id]?.goal, text: vision, source: 'ba', by: ba, at,
  })
  return stepDeadlock(next, id, {
    from, to: 'feedback', event: 'ba_feedback', by: ba, at,
    extra: { feedback: vision.trim() },
  })
}

/** The person's answer to the BA's question: it becomes the goal's client vision. */
export function answerDeadlock(board, { id, answer, at }) {
  need(filled(answer), 'the answer is the client\'s words')
  const record = board.deadlocks?.[id]
  need(record !== undefined, `unknown deadlock: ${id}`)
  const withVision = addVisionNote(board, {
    goal: record.goal, text: answer, source: 'client', by: 'client', at,
  })
  return stepDeadlock(withVision, id, {
    from: ['with_client'], to: 'feedback', event: 'client_answer', by: 'client', at,
    extra: { answer: answer.trim() },
  })
}

/**
 * The team lead forwards the BA's feedback to the members, at standup or
 * refinement (`meeting`). Closes the deadlock.
 */
export function forwardDeadlock(board, { id, lead, teamLead, members, meeting, at }) {
  need(lead === teamLead, `only the team lead (${teamLead}) forwards feedback`)
  need(Array.isArray(members) && members.length > 0, 'forward to at least one member')
  return stepDeadlock(board, id, {
    from: ['feedback'], to: 'forwarded', event: 'forwarded', by: lead, at,
    extra: { forwarded_to: [...new Set(members)].sort(), meeting: meeting ?? null },
  })
}

/** The deadlocks still open, oldest first. */
export function openDeadlocks(board) {
  return Object.values(board.deadlocks ?? {})
    .filter(d => d.state !== 'forwarded')
    .sort((a, b) => timeOf(a.at) - timeOf(b.at))
}

const USAGE = [
  'usage: devops-vision vision GOAL TEXT --dest DIR',
  '       devops-vision answer DEADLOCK TEXT --dest DIR',
].join('\n')

/** The person's words: a vision note on a goal, or the answer to a deadlock's question. */
function main(argv) {
  const at = argv.indexOf('--dest')
  const dest = at === -1 ? undefined : argv[at + 1]
  const rest = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)]
  const [command, target, ...words] = rest
  const text = words.join(' ')
  if (dest === undefined || target === undefined || !filled(text)) {
    console.error(USAGE)
    return 1
  }
  const file = projectPath(dest, BOARD_FILE)
  const when = new Date().toISOString()
  updateJson(file, emptyBoard(), board => {
    if (command === 'vision') {
      return addVisionNote(board, { goal: target, text, source: 'client', by: 'client', at: when })
    }
    if (command === 'answer') return answerDeadlock(board, { id: target, answer: text, at: when })
    throw new Error(USAGE)
  }, UNFENCED)
  console.log(command === 'vision'
    ? `Vision noted on ${target}.`
    : `Answer recorded for ${target}; the BA gives feedback to the team lead next.`)
  return 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-vision: ${error.message}`)
    process.exitCode = 2
  }
}
