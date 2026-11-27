// Autopilot for the first sprint (references/autopilot.md): tasks are measured
// against the mind map, planned into one team per module, steered by the
// Business Analyst, then allocated in one step. Pure rules: the server reads
// the map and persists the draft and the board.
import { RISKS, planAllocation, spinUp } from './devops-allocation.mjs'
import { OPEN_WORK_LIMIT, assignWork, mintId } from './devops-board.mjs'
import { resolveScope } from './devops-catalog.mjs'
import { isAgentId } from './devops-ids.mjs'
import { clientFields } from './devops-scrum.mjs'
import { openBoard } from './devops-teams.mjs'

/** The draft file, relative to the project folder. */
export const AUTOPILOT_FILE = '.devops/autopilot.json'

/** At most this many coders on one module's team (the department-pods ceiling). */
const MAX_CODERS = 3
const MIN_WORD = 3
const DEFAULT_WEEKS = 2

/** Words in a task or its paths that point at a risk area. */
const RISK_WORDS = Object.freeze({
  auth: ['auth', 'login', 'logout', 'session', 'token', 'oauth', 'password'],
  security: ['security', 'crypt', 'secret', 'sanitize', 'permission', 'acl', 'xss', 'csrf'],
  gate: ['gate'],
  payments: ['payment', 'billing', 'invoice', 'checkout', 'stripe'],
  'data-migration': ['migration', 'migrate', 'schema'],
  'public-api': ['endpoint', 'public api', 'rest api', 'graphql'],
  infra: ['docker', 'terraform', 'kubernetes', 'deploy', 'pipeline', 'workflow'],
  concurrency: ['concurrency', 'mutex', 'thread', 'race', 'deadlock', 'lock'],
})

/** The job each seat of a planned team works as, besides the lead's manager role. */
const AGENT_TYPE = Object.freeze({
  coder: 'devops-coder', researcher: 'devops-researcher', reviewer: 'devops-reviewer',
  qa: 'devops-quality-engineer', security: 'devops-security-engineer',
  'business-analyst': 'devops-business-analyst',
})

const need = (ok, message) => {
  if (!ok) throw new Error(message)
}
const uniq = list => [...new Set(list)].sort()
const words = text => uniq(String(text ?? '').toLowerCase().match(/[a-z_][a-z0-9_]+/g) ?? [])
  .filter(word => word.length >= MIN_WORD)
const baseName = rel => rel.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()

/**
 * What a task's wording names in the map: files by their base name, modules
 * by their name, and exported symbols by their name.
 */
function scopeFromText(map, text) {
  const named = new Set(words(text))
  const files = Object.keys(map.files).filter(rel => named.has(baseName(rel)))
  const modules = Object.keys(map.modules).filter(name => named.has(name.split('/').pop()))
  const symbols = uniq(Object.values(map.files).flatMap(file => file.symbols)
    .filter(symbol => symbol.exported && named.has(symbol.name.toLowerCase()))
    .map(symbol => symbol.name))
  return { modules, files, symbols }
}

/** The files a scope reaches: named files, the files of named symbols, or its modules' files. */
function scopeFiles(map, scope, modules) {
  const named = (scope.files ?? []).filter(rel => map.files[rel])
  const ofSymbols = Object.entries(map.files)
    .filter(([, file]) => file.symbols.some(symbol => (scope.symbols ?? []).includes(symbol.name)))
    .map(([rel]) => rel)
  const direct = uniq([...named, ...ofSymbols])
  return direct.length > 0 ? direct : modules.flatMap(name => map.modules[name]?.files ?? [])
}

function risksOf(text, files, given = []) {
  const haystack = `${String(text).toLowerCase()} ${files.join(' ').toLowerCase()}`
  const found = Object.entries(RISK_WORDS)
    .filter(([, list]) => list.some(word => haystack.includes(word)))
    .map(([risk]) => risk)
  return uniq([...given.filter(risk => RISKS.includes(risk)), ...found])
}

/** The module a task changes most, by its files there; the suggestion when it spans several. */
function mostTouched(map, files, modules) {
  const count = name => files.filter(rel => map.files[rel]?.module === name).length
  return [...modules].sort((a, b) => count(b) - count(a) || a.localeCompare(b))[0]
}

/**
 * Measures one task against the map: its scope (given, or matched from its
 * wording), files, modules, languages and risks. A task in one module is
 * owned by that module's team; one that spans several waits for the
 * Business Analyst to choose.
 */
export function measureTask(map, task) {
  const text = `${task.title} ${task.description ?? ''}`
  const given = task.scope ?? {}
  const asked = [given.modules, given.files, given.symbols].some(list => (list ?? []).length > 0)
  const scope = asked ? given : scopeFromText(map, text)
  const { modules, unknown } = resolveScope(map, scope)
  const files = scopeFiles(map, scope, modules)
  const languages = uniq(files.map(rel => map.files[rel]?.language).filter(Boolean))
  const owner = modules.length === 1 ? modules[0] : null
  return {
    scope: { modules, files: scope.files ?? [], symbols: scope.symbols ?? [] },
    matchedBy: asked ? 'scope' : 'wording',
    unknown,
    files: files.length,
    modules,
    languages: languages.length,
    risks: risksOf(text, files, task.risks),
    owner,
    suggestedOwner: owner ?? (modules.length > 0 ? mostTouched(map, files, modules) : null),
  }
}

/** The questions the Business Analyst answers before seats are allocated. */
export function openQuestions(draft) {
  const live = draft.tasks.filter(task => !task.deferred)
  return [
    ...live.filter(task => task.measure.modules.length === 0)
      .map(task => ({ task: task.id, ask: 'scope', why: 'the mind map names no module for it' })),
    ...live.filter(task => task.measure.modules.length > 0 && task.owner === null)
      .map(task => ({
        task: task.id, ask: 'owner', why: `it spans ${task.measure.modules.join(', ')}`,
        suggested: task.measure.suggestedOwner,
      })),
  ]
}

/** The allocation research for the plan: one stream a task, grouped by its owning module. */
function streamsOf(draft) {
  const live = draft.tasks.filter(task => !task.deferred && task.owner !== null)
  const firstOf = new Map()
  return live.map(task => {
    const first = firstOf.get(task.owner)
    if (first === undefined) firstOf.set(task.owner, task.id)
    return {
      name: task.id,
      files: task.measure.files,
      modules: task.measure.modules.length,
      languages: task.measure.languages,
      risks: task.measure.risks,
      unknowns: task.unknowns === true,
      newSurface: task.newSurface === true,
      dependsOn: first === undefined ? [] : [first],
    }
  })
}

/** The module an authoring team of the plan works on. */
const moduleOfTeam = (draft, team) => draft.tasks
  .find(task => task.id === team.authors.streams[0]).owner

/** Applies the Business Analyst's coder cap for a module: review seats follow the coders. */
function capTeam(plan, draft) {
  for (const team of plan.teams.filter(t => t.authors)) {
    const cap = draft.caps?.[moduleOfTeam(draft, team)]
    if (cap === undefined) continue
    team.authors.coder = Math.max(1, Math.min(team.authors.coder, cap))
    for (const other of plan.teams) {
      for (const judge of other.judges.filter(j => j.of.includes(team.name) && j.reviewer > 0)) {
        judge.reviewer = Math.min(judge.reviewer, team.authors.coder)
      }
    }
  }
  return plan
}

/**
 * The plan for the draft: planAllocation over one stream per task, so each
 * module's tasks share one authoring team, with one coder per task up to the
 * cap, review seats from another team, and final QA and Security on teams
 * that author nothing. Undefined while no task has an owner.
 */
export function planDraft(draft) {
  const streams = streamsOf(draft)
  if (streams.length === 0) return undefined
  const plan = capTeam(planAllocation({ task: draft.title, streams }), draft)
  for (const team of plan.teams.filter(t => t.authors)) team.module = moduleOfTeam(draft, team)
  return plan
}

/** A draft: the tasks measured and an id each, the plan, and what the BA still has to answer. */
export function draftAutopilot(map, { title, tasks, weeks = DEFAULT_WEEKS, ba, mint }) {
  need(Array.isArray(tasks) && tasks.length > 0, 'autopilot needs one task or more')
  need(isAgentId(ba), `the Business Analyst is an agent hash: ${ba}`)
  const taken = {}
  const measured = tasks.map(task => {
    need(String(task.title ?? '').trim() !== '', 'every task needs a title')
    const id = mintId('task', taken, mint)
    taken[id] = true
    const measure = measureTask(map, task)
    const { objective, acceptance, priority } = task
    const fields = clientFields({ objective, acceptance, priority })
    return { ...task, ...fields, id, measure, owner: measure.owner, deferred: false }
  })
  const name = String(title ?? 'Sprint 1')
  const draft = { title: name, weeks, ba, state: 'steering', tasks: measured }
  return withPlan(draft)
}

function withPlan(draft) {
  const next = { ...draft, plan: planDraft(draft) }
  return { ...next, questions: openQuestions(next) }
}

const STEERABLE = ['objective', 'acceptance', 'priority', 'risks', 'unknowns', 'newSurface']

/** One decision on one task: who owns it, its client fields, whether it waits. */
function steerTask(task, decision) {
  const next = { ...task }
  if (decision.owner !== undefined) {
    need(task.measure.modules.includes(decision.owner),
      `${task.id} touches ${task.measure.modules.join(', ')}, not ${decision.owner}`)
    next.owner = decision.owner
  }
  if (decision.defer !== undefined) next.deferred = decision.defer === true
  for (const key of STEERABLE) if (decision[key] !== undefined) next[key] = decision[key]
  const { objective, acceptance, priority } = next
  Object.assign(next, clientFields({ objective, acceptance, priority }))
  if (decision.risks !== undefined) {
    const unknown = decision.risks.filter(risk => !RISKS.includes(risk))
    need(unknown.length === 0, `unknown risk: ${unknown.join(', ')}`)
    next.measure = { ...next.measure, risks: uniq(decision.risks) }
  }
  return next
}

/**
 * The Business Analyst steers the draft: owners for tasks that span modules,
 * the client's objective and acceptance criteria, priority, risk flags,
 * deferring a task, and a coder cap per module. `rescope` holds tasks whose
 * new scope the caller measured again. Only the draft's BA steers, and only
 * before seats are allocated.
 */
export function steerAutopilot(draft, { by, decisions = [], caps = {}, rescope = {} }) {
  need(draft.state === 'steering', `the draft is ${draft.state}; steering ends at allocation`)
  need(by === draft.ba, `only the Business Analyst (${draft.ba}) steers autopilot`)
  for (const [module, cap] of Object.entries(caps)) {
    need(Number.isInteger(cap) && cap >= 1 && cap <= MAX_CODERS,
      `the coder cap for ${module} is 1 to ${MAX_CODERS}`)
  }
  const tasks = draft.tasks.map(task => {
    const fresh = rescope[task.id]
    const base = fresh ? { ...task, measure: fresh, owner: fresh.owner } : task
    const decision = decisions.find(d => d.task === task.id)
    return decision ? steerTask(base, decision) : base
  })
  const unknown = decisions.filter(d => !draft.tasks.some(task => task.id === d.task))
  need(unknown.length === 0, `no such task: ${unknown.map(d => d.task).join(', ')}`)
  return withPlan({ ...draft, tasks, caps: { ...(draft.caps ?? {}), ...caps } })
}

/**
 * The seats of one planned team: its coders and researchers when it
 * authors, and the review, QA and Security seats it holds for other teams'
 * work. The lead comes first, holding manager and the team's main job.
 */
function seatsOf(team, mintAgent) {
  const judging = job => team.judges.reduce((n, judge) => n + judge[job], 0)
  const counts = [
    ['coder', team.authors?.coder ?? 0], ['researcher', team.authors?.researcher ?? 0],
    ['reviewer', judging('reviewer')], ['qa', judging('qa')], ['security', judging('security')],
  ]
  const jobs = counts.flatMap(([job, count]) => Array.from({ length: count }, () => job))
  return jobs.map((job, i) => ({
    agent: mintAgent(), job, roles: i === 0 ? ['manager', job] : [job],
  }))
}

/** The goals a team builds, in the BA's priority order (unranked last, then by task order). */
function rankedGoals(team, draft, goals) {
  const tasks = team.authors.streams.map(id => draft.tasks.find(task => task.id === id))
  const rank = task => task.priority ?? Number.MAX_SAFE_INTEGER
  const order = (a, b) => rank(a.task) - rank(b.task) || a.i - b.i
  return tasks.map((task, i) => ({ task, i })).sort(order)
    .map(({ task }) => ({ task, goal: goals[task.id] }))
}

/** The client's specification for a goal, as the team lead reads it. */
function specLine(task) {
  const acceptance = [task.acceptance ?? []].flat().join('; ')
  return [`${task.title}`, task.objective ? `objective: ${task.objective}` : '',
    acceptance ? `acceptance: ${acceptance}` : ''].filter(Boolean).join(' | ')
}

/**
 * Hands a team's goals to its coders in priority order, a goal each in turn,
 * without giving any coder more than the open-work limit. Goals past the
 * team's capacity stay on the backlog for the lead and the BA.
 */
function assignTeam(board, { team, seats, ranked, at, mint }) {
  const coders = seats.filter(seat => seat.job === 'coder')
  const capacity = coders.length * OPEN_WORK_LIMIT
  let next = board
  const given = []
  ranked.slice(0, capacity).forEach(({ task, goal }, i) => {
    const seat = coders[i % coders.length]
    const lead = seat.roles.includes('manager')
    const description = lead ? `Lead and code ${specLine(task)}` : `Code ${specLine(task)}`
    const made = assignWork(next, {
      goal, job: 'coder', agent: seat.agent, team, description, by: 'orchestration', at, mint,
    })
    next = made.board
    given.push({ work: made.id, agent: seat.agent, goal, task: task.id, scope: task.measure.scope })
  })
  return { board: next, given, overflow: ranked.slice(capacity).map(({ task }) => task.id) }
}

/** Researchers take the team's tasks that need research first: unknowns or a new surface. */
function assignResearch(board, { team, seats, ranked, at, mint }) {
  const researchers = seats.filter(seat => seat.job === 'researcher')
  const needsResearch = task => task.unknowns || task.newSurface || task.measure.risks.length > 0
  const deep = ranked.filter(({ task }) => needsResearch(task))
  let next = board
  const given = []
  deep.slice(0, researchers.length * OPEN_WORK_LIMIT).forEach(({ task, goal }, i) => {
    const seat = researchers[i % researchers.length]
    const made = assignWork(next, {
      goal, job: 'researcher', agent: seat.agent, team, description: `Research ${specLine(task)}`,
      by: 'orchestration', at, mint,
    })
    next = made.board
    given.push({ work: made.id, agent: seat.agent, goal, task: task.id, scope: task.measure.scope })
  })
  return { board: next, given }
}

/** The team hash, lead and seats for every planned team. */
function mintTeams(plan, mintHash) {
  return Object.fromEntries(plan.teams.map(team => {
    const seats = seatsOf(team, () => mintHash('agent'))
    const module = team.module ?? null
    const record = { team: mintHash('team'), lead: seats[0].agent, seats, module }
    return [team.name, record]
  }))
}

/** Records each goal's title and the BA's client fields, owned by its team. */
function recordSpecs(board, { draft, plan, goals, teams }) {
  const next = structuredClone(board)
  for (const team of plan.teams.filter(t => t.authors)) {
    for (const id of team.authors.streams) {
      const task = draft.tasks.find(t => t.id === id)
      const fields = clientFields({ ...task, owner: teams[team.name].team })
      Object.assign(next.goals[goals[id]], { title: task.title }, fields)
    }
  }
  return next
}

/**
 * Allocates the steered draft in one step: a team hash, lead and seats per
 * planned team; the sprint, its goals with the client's fields and each
 * team's Sprint Planning (spinUp); each team's board with its members; the
 * authoring work, spread so no seat passes the open-work limit. Returns the
 * board, the team boards to open, the work given (with each task's scope, for
 * its catalog), the overflow per team and the launch list.
 */
export function allocateAutopilot(board, draft, { by, at, mint, versions }) {
  need(by === draft.ba, `only the Business Analyst (${draft.ba}) allocates`)
  need(draft.state === 'steering', `the draft is already ${draft.state}`)
  need(draft.questions.length === 0,
    `answer first: ${draft.questions.map(q => `${q.task} (${q.ask})`).join(', ')}`)
  need(draft.plan !== undefined, 'no task is ready to allocate')
  const taken = {}
  const mintHash = prefix => {
    const id = mintId(prefix, taken, mint)
    taken[id] = true
    return id
  }
  const teams = mintTeams(draft.plan, mintHash)
  const goals = Object.fromEntries(draft.plan.teams.filter(t => t.authors)
    .flatMap(t => t.authors.streams).map(id => [id, mintHash('goal')]))
  const leads = Object.fromEntries(Object.entries(teams)
    .map(([name, t]) => [name, { team: t.team, lead: t.lead }]))
  const spun = spinUp(board, draft.plan, {
    name: draft.title, weeks: draft.weeks, goals, teams: leads, at, mint, versions,
  })
  return finishAllocation(spun, { draft, teams, goals, at, mint })
}

function finishAllocation(spun, { draft, teams, goals, at, mint }) {
  let next = recordSpecs(spun.board, { draft, plan: draft.plan, goals, teams })
  const given = []
  const overflow = {}
  for (const team of draft.plan.teams.filter(t => t.authors)) {
    const { team: id, seats } = teams[team.name]
    const ranked = rankedGoals(team, draft, goals)
    const coded = assignTeam(next, { team: id, seats, ranked, at, mint })
    const researched = assignResearch(coded.board, { team: id, seats, ranked, at, mint })
    next = researched.board
    given.push(...coded.given, ...researched.given)
    if (coded.overflow.length > 0) overflow[team.name] = coded.overflow
  }
  const teamBoards = Object.values(teams).map(t => openBoard({
    team: t.team, members: t.seats.map(seat => ({ agent: seat.agent, roles: seat.roles })),
  }).board)
  return {
    sprint: spun.sprint, board: next, teamBoards, given, overflow, goals,
    launch: launchList({ draft, teams, given, goals, sprint: spun.sprint }),
  }
}

/**
 * Who to start and how: every seat with its team, roles, the subagent type
 * that plays its job, the settings that bind it, and the work it was given;
 * each lead with the client's specification for its goals; the BA.
 */
export function launchList({ draft, teams, given, goals, sprint }) {
  const seats = Object.entries(teams).flatMap(([name, t]) => t.seats.map(seat => ({
    agent: seat.agent, team: t.team, teamName: name, module: t.module, roles: seat.roles,
    subagent: `devops-multi-agent-team:${AGENT_TYPE[seat.job]}`,
    env: { DEVOPS_SEAT: seat.agent, DEVOPS_TEAM: t.team },
    work: given.filter(g => g.agent === seat.agent).map(g => g.work),
  })))
  const briefs = Object.entries(teams).filter(([, t]) => t.module !== null).map(([name, t]) => ({
    lead: t.lead, team: t.team, teamName: name, module: t.module,
    goals: draft.tasks.filter(task => task.owner === t.module && goals[task.id])
      .map(task => ({ goal: goals[task.id], spec: specLine(task) })),
  }))
  const analyst = AGENT_TYPE['business-analyst']
  const ba = { agent: draft.ba, subagent: `devops-multi-agent-team:${analyst}` }
  return { sprint, ba, seats, briefs }
}
