// Orchestration logic behind /devops. Each word the person types and each
// orchestration tool the MCP server offers runs one function here, so the
// behaviour lives in one place: the server's tools and the mod's /devops
// words both call runWord. State is kept beside the board in the thought
// folder; every write rewrites the dashboard.
import fs from 'node:fs'
import path from 'node:path'

import {
  AUTOPILOT_FILE, allocateAutopilot, draftAutopilot, measureTask, steerAutopilot,
} from './devops-autopilot.mjs'
import {
  BOARD_FILE, emptyBoard, mintId, normalizeBoard,
} from './devops-board.mjs'
import {
  CATALOG_FILE, catalogEnvelope, emptyLedger, entryFor, grant, sliceFor,
} from './devops-catalog.mjs'
import { writeDashboard } from './devops-dashboard.mjs'
import { batchItems, messagePolicy, MESSAGES_FILE } from './devops-messages.mjs'
import {
  LOOP_FILE, addReport, clientDecision, nextStep, pauseLoop, recordAllocation, signReport,
  sprintReport, startLoop,
} from './devops-loop.mjs'
import { buildMindMap, loadSaved } from './devops-mindmap.mjs'
import { projectPath, readJson, updateJson, UNFENCED } from './devops-store.mjs'
import { readMembers, TEAM_DIR } from './devops-teams.mjs'
import {
  addVisionNote, answerDeadlock, forwardDeadlock, openDeadlocks, raiseDeadlock, resolveDeadlock,
  stalledGoals, teamOfGoal,
} from './devops-vision.mjs'
import { argOf, isMain } from './devops-main.mjs'

const need = (ok, message) => {
  if (!ok) throw new Error(message)
}
const now = () => new Date().toISOString()
export const mintFresh = prefix => mintId(prefix, {})

/** The file `rel` in the project at `dest`, refusing symbolic links. */
const fileOf = (dest, rel) => projectPath(dest, rel)

/** The parsed state file `rel`, or `fallback` before it exists. */
export function readState(dest, rel, fallback) {
  return readJson(fileOf(dest, rel), fallback)
}

/**
 * One change to a state file under its lock, then the dashboard is rewritten.
 * `change` returns { value, ...result }: the new state, and what the caller gets.
 */
export function stateChange(dest, rel, fallback, change) {
  let result
  updateJson(fileOf(dest, rel), fallback, current => {
    const { value, ...rest } = change(current)
    result = rest
    return value
  }, UNFENCED)
  writeDashboard(dest)
  return result
}

export const readBoard = dest => normalizeBoard(readState(dest, BOARD_FILE, emptyBoard()))
export const boardChange = (dest, change) => stateChange(
  dest, BOARD_FILE, emptyBoard(), current => {
    const { board, ...rest } = change(normalizeBoard(current))
    return { value: board, ...rest }
  },
)
export const readLedger = dest => readState(dest, CATALOG_FILE, emptyLedger())
export const readLoop = dest => readState(dest, LOOP_FILE, undefined)
export const readDraft = dest => readState(dest, AUTOPILOT_FILE, undefined)
export const readMessagePolicy = dest => messagePolicy(readState(dest, MESSAGES_FILE, {}))

export const loopChange = (dest, change) => stateChange(dest, LOOP_FILE, null, current => {
  const { loop, ...rest } = change(current)
  return { value: loop, ...rest }
})
export const draftChange = (dest, change) => stateChange(dest, AUTOPILOT_FILE, null, current => {
  const { draft, ...rest } = change(current)
  return { value: draft, ...rest }
})
export const ledgerChange = (dest, change) => stateChange(
  dest, CATALOG_FILE, emptyLedger(), current => {
    const tick = (current.tick ?? 0) + 1
    const { ledger, ...rest } = change(current, tick)
    return { value: { ...ledger, tick }, ...rest }
  },
)

/** A team's own board file. */
export const teamFile = (dest, team) => {
  need(/^team-[0-9a-f]{6}$/.test(team ?? ''), 'team must look like team-<hex>')
  return fileOf(dest, path.join(TEAM_DIR, `${team}.json`))
}

/** One team-board change: `change` returns { board, error }; an error is thrown. */
export function teamAction(dest, team, change) {
  let result
  updateJson(teamFile(dest, team), null, current => {
    const { board, ...rest } = change(current)
    result = rest
    return board
  }, UNFENCED)
  if (result.error !== undefined) throw new Error(result.error)
  return result
}

/** The project's mind map: the saved one, or one built now when none is saved. */
export function currentMap(dest, roots) {
  return loadSaved(dest) ?? buildMindMap(dest, { roots }).map
}

export const goalOf = (board, goal) => ({ id: goal, title: board.goals[goal]?.title ?? goal })

export function workRow(dest, work) {
  const row = readBoard(dest).assignments[work]
  if (row === undefined) throw new Error(`unknown work: ${work}`)
  return row
}

/** The files of a slice's modules, each with its hash in the map. */
export function filesWithHashes(map, slice) {
  return slice.entries
    .filter(entry => entry.detail === 'full')
    .flatMap(entry => (map.modules[entry.module]?.files ?? []).map(rel => ({
      path: rel, hash: map.files[rel]?.hash ?? null, module: entry.module,
    })))
}

/** Puts one catalog (batched as the setting says) in the seat's inbox; records what it holds. */
export function deliver(dest, roots, { work, row, slice }) {
  const goal = goalOf(readBoard(dest), row.goal)
  const policy = readMessagePolicy(dest)
  const files = filesWithHashes(currentMap(dest, roots), slice)
  return ledgerChange(dest, (ledger, tick) => {
    const envelopes = batchItems(slice.entries, policy).map(({ items, batch }) => catalogEnvelope({
      id: mintFresh('catalog'), tick, work, agent: row.agent, goal,
      slice: { ...slice, entries: items }, batch,
    }))
    let next = ledger
    for (const envelope of envelopes) {
      next = grant(next, { agent: row.agent, work, envelope, at: now() })
    }
    next = { ...next, works: { ...next.works, [work]: { ...next.works[work], files } } }
    return {
      ledger: next,
      catalog: envelopes.map(envelope => envelope.id),
      messages: envelopes.length,
      modules: slice.entries.map(entry => entry.module),
      files: files.length,
      unknown: slice.unknown,
    }
  })
}

/** Delivers each piece of allocated work its catalog from the mind map. */
export function deliverAllocated(dest, roots, given) {
  const map = currentMap(dest, roots)
  return given.map(({ work, scope }) => {
    const row = workRow(dest, work)
    const slice = sliceFor(map, { job: row.job, scope })
    return { work, ...deliver(dest, roots, { work, row, slice }) }
  })
}

/** Gives a seat one more module for its work, as a catalog of that module alone. */
export function deliverModule(dest, roots, { work, module }) {
  const row = workRow(dest, work)
  const entry = entryFor(currentMap(dest, roots), module, row.job, 0)
  return deliver(dest, roots, { work, row, slice: { job: row.job, unknown: [], entries: [entry] } })
}

/** The team lead named in the allocation for `team`, or undefined. */
export function teamLeadOf(board, team) {
  for (const allocation of Object.values(board.allocations ?? {})) {
    const row = allocation.teams.find(t => t.team === team)
    if (row !== undefined) return row.lead
  }
  return undefined
}

/** The Business Analyst of the loop, or of the draft before it. */
export const analystOf = dest => readLoop(dest)?.ba ?? readDraft(dest)?.ba

function draftView(draft) {
  const { tasks, plan, ...rest } = draft
  const summary = tasks.map(({ id, title, owner, deferred, priority, measure }) => ({
    id, title, owner, deferred, priority, modules: measure.modules, risks: measure.risks,
  }))
  return { ...rest, tasks: summary, totals: plan?.totals ?? null, plan: plan ?? null }
}

/** The part of a drafted task the next draft takes as input. */
const taskInput = task => ({ ...task, scope: task.measure.scope })

function openTeamBoards(dest, boards) {
  for (const board of boards) {
    teamAction(dest, board.team, current => {
      if (current !== null) return { board: current, error: `${board.team} already has a board` }
      return { board }
    })
  }
}

/** Gives each carried team its seats for this sprint, keeping its items. */
function updateTeamMembers(dest, updates) {
  for (const { team, members } of updates) {
    teamAction(dest, team, current => ({
      board: current === null
        ? { team, members, items: [], refusals: [] }
        : { ...current, members },
    }))
  }
}

/** Allocates the saved draft as `by` (its Business Analyst), then records the sprint in the loop. */
function allocateDraft(dest, roots, by) {
  const draft = readDraft(dest)
  if (draft === undefined) throw new Error('no autopilot draft: autopilot_draft starts one')
  const versions = { node: process.versions.node, schema: '1' }
  const carry = readLoop(dest)?.carry
  const out = boardChange(dest, board => allocateAutopilot(board, draft, {
    by, at: now(), versions, carry,
  }))
  openTeamBoards(dest, out.teamBoards)
  updateTeamMembers(dest, out.teamUpdates)
  const catalogs = deliverAllocated(dest, roots, out.given)
  draftChange(dest, current => ({
    draft: { ...current, state: 'allocated', sprint: out.sprint, launch: out.launch, at: now() },
  }))
  const scopes = Object.fromEntries(out.given.map(({ goal, scope }) => [goal, scope]))
  const deferred = draft.tasks.filter(task => task.deferred).map(taskInput)
  loopChange(dest, loop => ({
    loop: recordAllocation(loop ?? startLoop({
      ba: draft.ba, limit: draft.sprintLimit, at: now(),
    }), { sprint: out.sprint, carry: out.carry, scopes, deferred }),
  }))
  const { launch, overflow } = out
  return { sprint: out.sprint, launch, overflow, catalogs: catalogs.length }
}

/** Files the report on a closed sprint into the loop, once. Undefined otherwise. */
function reportSprint(dest, sprint) {
  const board = readBoard(dest)
  const loop = readLoop(dest)
  const inLoop = loop !== undefined && loop.state === 'running' && loop.sprints.includes(sprint)
  if (!inLoop || loop.reports[sprint] !== undefined) return undefined
  if (board.sprints[sprint]?.status !== 'closed') return undefined
  const report = sprintReport(board, { sprint, at: now() })
  loopChange(dest, current => ({ loop: addReport(current, report) }))
  return report
}

/**
 * Moves the loop on: pauses it at the sprint limit or when nothing is left, or
 * drafts the next sprint from the backlog and, with no question for the BA,
 * allocates it at once.
 */
function advanceLoop(dest, roots) {
  const first = readLoop(dest)
  need(first !== undefined, 'no sprint loop: it starts when the first sprint is allocated')
  reportSprint(dest, first.sprints.at(-1))
  const loop = readLoop(dest)
  const step = nextStep(loop, readBoard(dest))
  if (step.action === 'pause') {
    loopChange(dest, current => ({ loop: pauseLoop(current, step.reason) }))
    return { action: 'paused', reason: step.reason }
  }
  if (step.action !== 'draft') return step
  const weeks = readDraft(dest)?.weeks
  const draft = draftAutopilot(currentMap(dest, roots), {
    title: step.title, tasks: step.tasks, weeks, ba: loop.ba,
  })
  draftChange(dest, () => ({ draft: { ...draft, sprintLimit: loop.limit } }))
  if (draft.questions.length > 0) {
    return { action: 'steer', questions: draft.questions, ...draftView(draft) }
  }
  return { action: 'allocated', ...allocateDraft(dest, roots, loop.ba) }
}

export const reportClosed = (dest, meeting) => {
  const sprint = readBoard(dest).meetings[meeting]?.sprint
  const loop = readLoop(dest)
  const inLoop = loop !== undefined && loop.state === 'running' && loop.sprints.includes(sprint)
  return inLoop ? reportSprint(dest, sprint) : undefined
}

/** The word table: each /devops word and the function that runs it. */
const WORDS = {
  draft({ dest, roots, input }) {
    const map = currentMap(dest, roots)
    return draftChange(dest, current => {
      if (current !== null && (current.state !== 'steering' || !input.replace)) {
        throw new Error(`a draft is already ${current.state}; pass replace while it is steering`)
      }
      const drafted = draftAutopilot(map, {
        title: input.title, tasks: input.tasks, weeks: input.weeks, ba: input.ba,
      })
      const limit = input.sprintLimit === undefined ? {} : { sprintLimit: input.sprintLimit }
      const draft = { ...drafted, ...limit }
      return { draft, ...draftView(draft) }
    })
  },
  steer({ dest, roots, input }) {
    const map = currentMap(dest, roots)
    return draftChange(dest, current => {
      need(current !== null, 'no autopilot draft: autopilot_draft starts one')
      const rescope = {}
      for (const decision of (input.decisions ?? []).filter(d => d.scope !== undefined)) {
        const task = current.tasks.find(t => t.id === decision.task)
        if (task) rescope[task.id] = measureTask(map, { ...task, scope: decision.scope })
      }
      const decisions = (input.decisions ?? []).map(({ scope, ...rest }) => rest)
      const draft = steerAutopilot(current, {
        by: input.caller, decisions, caps: input.caps ?? {}, rescope,
      })
      return { draft, ...draftView(draft) }
    })
  },
  allocate({ dest, roots, input }) {
    const draft = readDraft(dest)
    need(draft !== undefined, 'no autopilot draft: autopilot_draft starts one')
    return allocateDraft(dest, roots, input.caller)
  },
  status({ dest }) {
    const draft = readDraft(dest)
    return draft === undefined ? { state: 'none' } : draftView(draft)
  },
  'loop-status'({ dest }) {
    const loop = readLoop(dest)
    if (loop === undefined) return { state: 'none' }
    const { carry, scopes, ...shown } = loop
    return { ...shown, next: nextStep(loop, readBoard(dest)) }
  },
  'loop-sign'({ dest, roots, input }) {
    loopChange(dest, loop => {
      need(loop !== null, 'no sprint loop yet')
      return {
        loop: signReport(loop, {
          sprint: input.sprint, by: input.caller, notes: input.notes,
          askClient: input.askClient, at: now(),
        }),
      }
    })
    return { signed: input.sprint, next: advanceLoop(dest, roots) }
  },
  'loop-advance'({ dest, roots }) {
    const draft = readDraft(dest)
    if (draft?.state === 'steering' && draft.questions.length === 0 && readLoop(dest)) {
      return { action: 'allocated', ...allocateDraft(dest, roots, draft.ba) }
    }
    return advanceLoop(dest, roots)
  },
  'deadlock-scan'({ dest }) {
    return { stalled: stalledGoals(readBoard(dest)) }
  },
  'deadlock-raise'({ dest, input }) {
    const board = readBoard(dest)
    const team = teamOfGoal(board, input.goal)
    const lead = teamLeadOf(board, team)
    need(lead !== undefined && lead === input.caller,
      `only the lead of the goal's team (${lead ?? 'none'}) raises a deadlock`)
    return boardChange(dest, current => raiseDeadlock(current, {
      goal: input.goal, team, lead: input.caller, reason: input.reason, at: now(), mint: mintFresh,
    }))
  },
  'deadlock-resolve'({ dest, input }) {
    return boardChange(dest, board => ({
      board: resolveDeadlock(board, {
        id: input.id, ba: input.caller, analyst: analystOf(dest), vision: input.vision,
        question: input.question, at: now(),
      }),
    }))
  },
  'deadlock-forward'({ dest, input }) {
    const board = readBoard(dest)
    const record = board.deadlocks?.[input.id]
    need(record !== undefined, `unknown deadlock: ${input.id}`)
    const lead = teamLeadOf(board, record.team)
    const members = (readMembers(teamFile(dest, record.team)) ?? []).filter(m => m !== lead)
    return boardChange(dest, current => ({
      board: forwardDeadlock(current, {
        id: input.id, lead: input.caller, teamLead: lead, members: [...members, lead],
        meeting: input.meeting, at: now(),
      }),
    }))
  },
  'goal-vision'({ dest, input }) {
    return boardChange(dest, board => {
      const next = addVisionNote(board, {
        goal: input.goal, text: input.text, source: input.source, by: input.caller, at: now(),
      })
      return { board: next, goal: input.goal, notes: next.goals[input.goal].vision.length }
    })
  },
  open({ dest }) {
    return { deadlocks: openDeadlocks(readBoard(dest)).map(d => d.id) }
  },
  // The person's words: the client's own voice, and the sign-offs.
  vision({ dest, input }) {
    return boardChange(dest, board => {
      const next = addVisionNote(board, {
        goal: input.goal, text: input.text, source: 'client', by: 'client', at: now(),
      })
      return { board: next, goal: input.goal, notes: next.goals[input.goal].vision.length }
    })
  },
  answer({ dest, input }) {
    return boardChange(dest, board => ({
      board: answerDeadlock(board, { id: input.id, answer: input.text, at: now() }),
    }))
  },
  satisfied({ dest, input }) {
    return loopSignOff(dest, 'satisfied', input)
  },
  continue({ dest, input }) {
    return loopSignOff(dest, 'continue', input)
  },
  messages({ dest, input }) {
    const file = fileOf(dest, MESSAGES_FILE)
    const current = readJson(file, {})
    if (input.action === undefined || input.action === 'show') return messagePolicy(current)
    const modes = ['default', 'batches']
    need(modes.includes(input.action), 'messages is show, default or batches')
    const batchSize = input.size === undefined ? {} : { batchSize: input.size }
    const next = messagePolicy({ ...current, batching: input.action, ...batchSize })
    updateJson(file, null, () => next, UNFENCED)
    writeDashboard(dest)
    return next
  },
}

/** The client's sign-off on the loop; `continue` may allow more sprints past the limit. */
function loopSignOff(dest, decision, input) {
  const next = updateJson(fileOf(dest, LOOP_FILE), null, loop => {
    need(loop !== null, 'no sprint loop yet: it starts when the first sprint is allocated')
    return clientDecision(loop, { decision, note: input.note ?? '', more: input.more, at: now() })
  }, UNFENCED)
  writeDashboard(dest)
  return { state: next.state, limit: next.limit }
}

/**
 * The input a /devops word takes from what is typed after it. Words with a
 * structured input (draft, steer) read it from --input FILE instead.
 */
export function wordInput(word, words) {
  const [first, ...rest] = words
  switch (word) {
    case 'vision': return { goal: first, text: rest.join(' ') }
    case 'answer': return { id: first, text: rest.join(' ') }
    case 'satisfied': return { note: words.join(' ') }
    case 'continue': {
      const more = argOf(words, '--more')
      const note = words.filter((w, i) => w !== '--more' && words[i - 1] !== '--more').join(' ')
      return { note, more: more === undefined ? undefined : Number(more) }
    }
    case 'messages': {
      const size = rest[0] === undefined ? undefined : Number(rest[0])
      return { action: first, size }
    }
    case 'sign': return { sprint: first, notes: rest.join(' ') }
    case 'raise': return { goal: first, reason: rest.join(' ') }
    case 'resolve': {
      const at = rest.indexOf('--question')
      return at === -1
        ? { id: first, vision: rest.join(' ') }
        : { id: first, question: rest.slice(at + 1).join(' ') }
    }
    case 'forward': return { id: first, meeting: argOf(words, '--meeting') }
    case 'goal-vision': return { goal: first, source: rest[0], text: rest.slice(1).join(' ') }
    default: return {}
  }
}

/** The command line: WORD, --dest DIR, then the word's arguments. */
function main(argv) {
  const [word, ...rest] = argv
  const dest = argOf(argv, '--dest')
  const usage = 'usage: devops-orchestrate WORD --dest DIR [--as AGENT] [--input FILE] [args]'
  need(word !== undefined && dest !== undefined, usage)
  const inputFile = argOf(argv, '--input')
  const typed = rest.filter((w, i) => !['--dest', '--as', '--input', '--meeting'].includes(w)
    && !['--dest', '--as', '--input', '--meeting'].includes(rest[i - 1]))
  const input = inputFile === undefined
    ? wordInput(word, typed)
    : JSON.parse(fs.readFileSync(inputFile, 'utf8'))
  const as = argOf(argv, '--as')
  if (as !== undefined) input.caller = as
  const meeting = argOf(argv, '--meeting')
  if (meeting !== undefined) input.meeting = meeting
  console.log(JSON.stringify(runWord(dest, word, input)))
  return 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-orchestrate: ${error.message}`)
    process.exitCode = 2
  }
}


/**
 * Runs one /devops word on the project at `dest`. `input` holds the word's
 * arguments, `caller` the seat or person acting, and `roots` the allowed folders.
 * Returns the word's result.
 */
export function runWord(dest, word, input = {}, roots) {
  const run = WORDS[word]
  need(run !== undefined, `unknown /devops word: ${word}`)
  return run({ dest, roots, input })
}
