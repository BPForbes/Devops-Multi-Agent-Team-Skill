// Allocation research: turn what the research seats found about a task into
// teams and seats (see references/allocation-research.md). Pure functions.
import fs from 'node:fs'

import { addGoal, createSprint, normalizeBoard } from './devops-board.mjs'
import { isAgentId, isGoalId, isTeamId } from './devops-ids.mjs'
import { isMain } from './devops-main.mjs'
import { scheduleMeeting } from './devops-scrum.mjs'

/** At most this many seats per job on one team (the department-pods ceiling). */
const CEILING = 3
/** A stream at or above this many points gets its own research seat. */
const RESEARCH_FROM = 3
/** A group at or above this many points gets a second coder. */
const PAIR_FROM = 6

/** Risk areas that raise a stream's points: a mistake there costs more than the change. */
export const RISKS = Object.freeze([
  'auth', 'security', 'gate', 'payments', 'data-migration', 'public-api', 'infra', 'concurrency',
])
/** Risks Security must look at closely: each such stream adds a Security seat. */
const SECURITY_RISKS = new Set(['auth', 'security', 'gate', 'payments'])

/** The most files for 0, 1, 2 and 3 points; more files than the last step score one more. */
const FILE_STEPS = Object.freeze([1, 5, 15, 40])

const capped = count => Math.min(CEILING, count)
const because = reasons => (reasons.length > 0 ? ` (${reasons.join('; ')})` : '')

function filePoints(files) {
  const step = FILE_STEPS.findIndex(most => files <= most)
  return step === -1 ? FILE_STEPS.length : step
}

/** A stream's points from what the research measured, with the reason for each. */
export function streamPoints(stream) {
  const parts = [[filePoints(stream.files ?? 1), `${stream.files ?? 1} file(s)`]]
  const spread = Math.max(stream.modules ?? 1, stream.languages ?? 1) - 1
  if (spread > 0) parts.push([Math.min(spread, 2), `${spread + 1} modules or languages`])
  const risks = stream.risks ?? []
  if (risks.length > 0) parts.push([Math.min(risks.length, 2), `risk: ${risks.join(', ')}`])
  if (stream.unknowns) parts.push([1, 'cause or repro not known yet'])
  if (stream.newSurface) parts.push([1, 'new module, service or public surface'])
  return {
    points: parts.reduce((sum, [points]) => sum + points, 0),
    reasons: parts.filter(([points]) => points > 0).map(([points, why]) => `+${points} ${why}`),
  }
}

/** Refuses research the plan cannot use: no streams, a repeated name, a bad risk or dependency. */
export function checkResearch(research) {
  const streams = research?.streams
  const fail = message => { throw new Error(message) }
  if (!Array.isArray(streams) || streams.length === 0) fail('research needs one stream or more')
  const names = streams.map(s => s?.name)
  if (names.some(n => typeof n !== 'string' || n.trim() === '')) fail('every stream needs a name')
  if (new Set(names).size !== names.length) fail('stream names must be unique')
  for (const stream of streams) {
    const unknown = (stream.risks ?? []).filter(risk => !RISKS.includes(risk))
    if (unknown.length > 0) fail(`unknown risk in ${stream.name}: ${unknown.join(', ')}`)
    const missing = (stream.dependsOn ?? []).filter(dep => !names.includes(dep))
    if (missing.length > 0) fail(`${stream.name} depends on unknown stream: ${missing.join(', ')}`)
  }
}

/** Streams that depend on each other, directly or through others, grouped for one team each. */
export function groupStreams(streams) {
  const parent = new Map(streams.map(s => [s.name, s.name]))
  const root = name => (parent.get(name) === name ? name : root(parent.get(name)))
  for (const stream of streams) {
    for (const dep of stream.dependsOn ?? []) parent.set(root(dep), root(stream.name))
  }
  const groups = new Map()
  for (const stream of streams) {
    const key = root(stream.name)
    groups.set(key, [...(groups.get(key) ?? []), stream])
  }
  return [...groups.values()]
}

/** The research and coding seats one team needs for its streams, each with its reason. */
function authorSeats(group) {
  const scored = group.map(stream => ({ stream, ...streamPoints(stream) }))
  const total = scored.reduce((sum, s) => sum + s.points, 0)
  const deep = scored
    .filter(s => s.points >= RESEARCH_FROM || s.stream.unknowns || s.stream.newSurface)
  const coder = capped(Math.max(group.length, total >= PAIR_FROM ? 2 : 1))
  return {
    streams: group.map(s => s.name),
    points: total,
    researcher: capped(deep.length),
    coder,
    reasons: [
      ...scored.map(s => `${s.stream.name}: ${s.points} point(s)${because(s.reasons)}`),
      `researcher ${capped(deep.length)}: one per stream with unknowns, a new surface`
        + ` or ${RESEARCH_FROM}+ points`,
      `coder ${coder}: one per stream, two when the team has ${PAIR_FROM}+ points`,
    ],
  }
}

/** The judging seats for one team's streams, each with its reason. */
function judgeSeats(group, authors) {
  const unknown = group.filter(s => s.unknowns).length
  const sensitive = group.filter(s => (s.risks ?? []).some(r => SECURITY_RISKS.has(r))).length
  const seats = {
    reviewer: capped(authors.coder), qa: capped(1 + unknown), security: capped(1 + sensitive),
  }
  return {
    ...seats,
    reasons: [
      `reviewer ${seats.reviewer}: one per coder, so each item is reviewed as its diff lands`,
      `qa ${seats.qa}: one, plus one per stream whose cause is not known yet`,
      `security ${seats.security}: one, plus one per stream that touches auth, security,`
        + ' the gate or payments',
    ],
  }
}

/**
 * Plans teams and seats from allocation research: { task, streams: [{ name,
 * files, modules, languages, risks, unknowns, newSurface, dependsOn }] }.
 * Each group of dependent streams gets one authoring team. Another authoring
 * team reviews its items (R1, a team that authors nothing, when there is only
 * one); Q1 gives the final QA and S1 the final Security on the combined tree,
 * each a team that authored nothing. Returns { teams, totals, parallel }.
 */
export function planAllocation(research) {
  checkResearch(research)
  const groups = groupStreams(research.streams)
  const authoring = groups.map((group, i) => {
    const authors = authorSeats(group)
    return { name: `A${i + 1}`, authors, group, seats: judgeSeats(group, authors) }
  })
  const teams = authoring.map(({ name, authors }) => ({ name, authors, judges: [] }))
  const review = ({ name, seats }) => ({
    of: [name], reviewer: seats.reviewer, qa: 0, security: 0, reasons: seats.reasons.slice(0, 1),
  })
  if (authoring.length === 1) {
    teams.push({ name: 'R1', authors: null, judges: [review(authoring[0])] })
  } else {
    authoring.forEach((team, i) => teams[(i + 1) % authoring.length].judges.push(review(team)))
  }
  teams.push({ name: 'Q1', authors: null, judges: [finalCheck(authoring, 'qa')] })
  teams.push({ name: 'S1', authors: null, judges: [finalCheck(authoring, 'security')] })
  const task = String(research.task ?? '')
  return { task, teams, totals: totalsOf(teams), parallel: parallelPlan() }
}

/** Where each final check's reason sits in judgeSeats' reasons. */
const REASON_AT = Object.freeze({ qa: 1, security: 2 })

/**
 * The final QA (Q1) or Security (S1) seats for every team's work. Both are
 * given on the combined tree, which every authoring team wrote, so each comes
 * from its own team that authored nothing, and QA hands over to Security
 * across a team boundary, as every judging hand-off must.
 */
function finalCheck(authoring, job) {
  const seats = capped(authoring.reduce((n, a) => n + a.seats[job], 0))
  const team = job === 'qa' ? 'Q1' : 'S1'
  return {
    of: authoring.map(a => a.name),
    reviewer: 0,
    qa: job === 'qa' ? seats : 0,
    security: job === 'security' ? seats : 0,
    reasons: [
      `${team} gives the final ${job === 'qa' ? 'QA PASS' : 'Security CLEAR'} on the combined tree`,
      ...authoring.map(a => `${a.name} ${a.seats.reasons[REASON_AT[job]]}`),
    ],
  }
}

function totalsOf(teams) {
  const sum = (pick) => teams.reduce((n, t) => n + pick(t), 0)
  const judges = job => sum(t => t.judges.reduce((n, j) => n + j[job], 0))
  return {
    teams: teams.length,
    researcher: sum(t => t.authors?.researcher ?? 0),
    coder: sum(t => t.authors?.coder ?? 0),
    reviewer: judges('reviewer'),
    qa: judges('qa'),
    security: judges('security'),
  }
}

/** What runs at the same time, and the verdicts that stay in order on one tree. */
export function parallelPlan() {
  return {
    together: [
      'teams work their streams at once, each in its own detached worktrees',
      'inside a team, research, repro (the failing check) and the security baseline start together',
      'each item goes to review as soon as its diff lands, not when every item is done',
      'QA prepares (sandbox, test plan, CI) and Security scans the candidate tree during review',
      'lint, the comment audit and the tests run at once, not one after another',
    ],
    inOrder: [
      'Reviewer Satisfied on the diff',
      'QA PASS on the final HEAD^{tree}',
      'Security CLEAR on that same tree, after QA (a change voids both)',
      'the person types /devops push-ok on that tree',
    ],
  }
}

/** Refuses a spin-up whose streams have no goal hash or whose teams have no team hash and lead. */
function checkSpinUp(plan, { goals, teams }) {
  for (const t of plan.teams) {
    for (const stream of t.authors?.streams ?? []) {
      if (!isGoalId(goals?.[stream])) throw new Error(`stream ${stream} needs a goal hash`)
    }
    const seat = teams?.[t.name]
    if (!isTeamId(seat?.team) || !isAgentId(seat?.lead)) {
      throw new Error(`team ${t.name} needs a team hash and a lead`)
    }
  }
  const hashes = plan.teams.map(t => teams[t.name].team)
  if (new Set(hashes).size !== hashes.length) throw new Error('each team needs its own team hash')
}

/** What the board keeps of a plan: each team's hash and lead, the goals it builds and judges. */
function allocationRecord(plan, { goals, teams }) {
  const streamsOf = name => plan.teams.find(p => p.name === name).authors.streams
  const goalsFor = (t, job) => t.judges.filter(j => j[job] > 0)
    .flatMap(j => j.of).flatMap(streamsOf).map(stream => goals[stream])
  return {
    task: plan.task,
    teams: plan.teams.map(t => ({
      name: t.name,
      ...teams[t.name],
      goals: (t.authors?.streams ?? []).map(stream => goals[stream]),
      judged_goals: t.judges.flatMap(j => j.of).flatMap(streamsOf).map(stream => goals[stream]),
      review_goals: goalsFor(t, 'reviewer'),
      qa_goals: goalsFor(t, 'qa'),
      security_goals: goalsFor(t, 'security'),
      authors: t.authors,
      judges: t.judges,
    })),
  }
}

/**
 * Spins up the board from a plan: opens the sprint, puts each stream on the
 * backlog as a goal, records the allocation, and hands every team's lead, the
 * judging team's too, its Sprint Planning (scheduled, for the lead to hold). `goals` maps a
 * stream to its goal hash; `teams` maps a plan team (A1, Q1, ...) to { team, lead }.
 * Returns { sprint, meetings, board }.
 */
export function spinUp(board, plan, options) {
  const { name, weeks, goals, teams, at, mint } = options
  checkSpinUp(plan, { goals, teams })
  const opened = createSprint(normalizeBoard(board), { name, weeks, at, mint })
  let next = opened.board
  for (const t of plan.teams) {
    for (const stream of t.authors?.streams ?? []) {
      next = addGoal(next, { goal: goals[stream], title: stream, at })
    }
  }
  next.allocations[opened.id] = allocationRecord(plan, { goals, teams })
  const meetings = []
  for (const t of plan.teams) {
    const { team, lead } = teams[t.name]
    const planning = { sprint: opened.id, team, kind: 'planning', lead, at, mint }
    const made = scheduleMeeting(next, planning)
    next = made.board
    meetings.push({ id: made.id, team, lead })
  }
  return { sprint: opened.id, meetings, board: next }
}

function main(argv) {
  if (argv[0] !== 'plan' || argv[1] === undefined) {
    console.error('Usage: devops-allocation plan RESEARCH.json')
    return 1
  }
  const research = JSON.parse(fs.readFileSync(argv[1], 'utf8'))
  console.log(JSON.stringify(planAllocation(research), null, 2))
  return 0
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))
