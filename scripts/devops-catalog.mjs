// Context catalogs: the slice of the mind map one seat needs for one piece of
// work, instead of the whole map (references/context-catalogs.md). Pure rules:
// the server builds the map and persists the ledger.
import { moduleHash } from './devops-mindmap.mjs'

/** The catalog ledger, relative to the project folder. */
export const CATALOG_FILE = '.devops/catalogs.json'
/** The sender of every catalog envelope: the server, which forwards the data. */
export const SERVER_FROM = Object.freeze({ agent: 'agent-000000', role: 'server' })

const ENVELOPE_VERSION = 1
const DEFAULT_DEPTH = 1
const MAX_DEPTH = 3
const MAX_SYMBOLS = 40
const MAX_DOCS = 8
const MAX_LIST = 20

const need = (ok, message) => {
  if (!ok) throw new Error(message)
}
const uniq = list => [...new Set(list)].sort()

/** The catalog index: module name to record hash, for quick lookup. */
export function catalogIndex(map) {
  const names = Object.keys(map.modules).sort()
  const hashOf = name => map.modules[name].hash ?? moduleHash(map, name)
  return Object.fromEntries(names.map(name => [name, hashOf(name)]))
}

/** The module whose record has this hash in the map, or undefined. */
export function moduleByHash(map, hash) {
  return Object.entries(catalogIndex(map)).find(([, h]) => h === hash)?.[0]
}

const modulesOfSymbol = (map, name) => Object.values(map.files)
  .filter(file => file.symbols.some(symbol => symbol.name === name))
  .map(file => file.module)

/**
 * The modules a piece of work touches: named modules, the modules of named
 * files, and the modules that declare named symbols. Names the map does not
 * know are returned in `unknown`, so the caller can say so.
 */
export function resolveScope(map, { modules = [], files = [], symbols = [] } = {}) {
  const found = []
  const unknown = []
  for (const name of modules) (map.modules[name] ? found : unknown).push(name)
  for (const rel of files) {
    if (map.files[rel]) found.push(map.files[rel].module)
    else unknown.push(rel)
  }
  for (const name of symbols) {
    const owners = modulesOfSymbol(map, name)
    if (owners.length > 0) found.push(...owners)
    else unknown.push(name)
  }
  return { modules: uniq(found), unknown }
}

const neighbours = (map, name) => [
  ...Object.keys(map.modules[name]?.dependsOn ?? {}),
  ...Object.keys(map.modules[name]?.usedBy ?? {}),
].filter(other => map.modules[other] !== undefined)

/**
 * The modules within `depth` dependency steps of the start modules, either
 * way along dependsOn and usedBy, with each one's distance from the start.
 */
export function traverse(map, start, depth = DEFAULT_DEPTH) {
  const steps = Math.min(Math.max(depth, 0), MAX_DEPTH)
  const reach = new Map(start.map(name => [name, 0]))
  let frontier = [...start]
  for (let step = 1; step <= steps; step += 1) {
    frontier = uniq(frontier.flatMap(name => neighbours(map, name))).filter(n => !reach.has(n))
    for (const name of frontier) reach.set(name, step)
  }
  return reach
}

const filesOf = (map, name) => map.modules[name]?.files ?? []
const exportsOf = (map, name) => map.modules[name]?.exports ?? []

const symbolsOf = (map, name) => filesOf(map, name)
  .flatMap(rel => (map.files[rel]?.symbols ?? []).map(symbol => ({
    name: symbol.name, kind: symbol.kind, at: `${rel}:${symbol.line}`, signature: symbol.signature,
  })))
  .slice(0, MAX_SYMBOLS)

const testsOf = (map, name) => uniq(filesOf(map, name).flatMap(rel => map.testedBy?.[rel] ?? []))

const callersOf = (map, name) => uniq(filesOf(map, name)
  .flatMap(rel => map.importedBy?.[rel] ?? [])
  .filter(rel => map.files[rel]?.module !== name)).slice(0, MAX_LIST)

const docsOf = (map, name) => {
  const own = new Set(filesOf(map, name))
  const inModule = new Set(map.modules[name]?.docs ?? [])
  const describes = doc => [...(doc.describes ?? []), ...(doc.links ?? []), ...(doc.mentions ?? [])]
  return Object.entries(map.docs ?? {})
    .filter(([rel, doc]) => inModule.has(rel) || describes(doc).some(target => own.has(target)))
    .slice(0, MAX_DOCS)
    .map(([rel, doc]) => ({ path: rel, title: doc.title, summary: doc.summary }))
}

/**
 * What each job reads in a catalog entry, beyond the record every entry has.
 * A job not listed gets the record alone.
 */
export const TRANSFORMERS = Object.freeze({
  coder: (map, name) => ({ symbols: symbolsOf(map, name), tests: testsOf(map, name) }),
  reviewer: (map, name) => ({
    exports: exportsOf(map, name), callers: callersOf(map, name), tests: testsOf(map, name),
  }),
  qa: (map, name) => ({ tests: testsOf(map, name), callers: callersOf(map, name) }),
  researcher: (map, name) => ({ docs: docsOf(map, name), exports: exportsOf(map, name) }),
  'business-analyst': (map, name) => ({ docs: docsOf(map, name) }),
})

/** The record every entry carries: what the module is and its hash. */
function recordOf(map, name) {
  const mod = map.modules[name]
  return {
    module: name,
    hash: mod.hash ?? moduleHash(map, name),
    ...(mod.doc ? { doc: mod.doc } : {}),
    files: filesOf(map, name).slice(0, MAX_LIST),
    dependsOn: Object.keys(mod.dependsOn ?? {}).sort(),
    usedBy: Object.keys(mod.usedBy ?? {}).sort(),
    libraries: mod.libraries ?? [],
  }
}

/**
 * One catalog entry. A module the work names gets the full shape for the
 * job; a neighbour gets the record only, as a reference.
 */
export function entryFor(map, name, job, distance = 0) {
  const record = recordOf(map, name)
  if (distance > 0) return { ...record, detail: 'reference', distance }
  return { ...record, detail: 'full', distance, ...(TRANSFORMERS[job]?.(map, name) ?? {}) }
}

/** The slice of the map for one piece of work: the entries a seat in `job` needs. */
export function sliceFor(map, { job, scope, depth = DEFAULT_DEPTH }) {
  const { modules, unknown } = resolveScope(map, scope)
  const reach = traverse(map, modules, depth)
  const entries = [...reach].map(([name, distance]) => entryFor(map, name, job, distance))
  return { job, modules, unknown, entries }
}

/** The empty ledger: holdings by seat, update notices by seat, scope by work, requests by id. */
export const emptyLedger = () => ({
  holdings: {}, notices: {}, works: {}, requests: {}, catalogs: {},
})

const normalize = ledger => ({ ...emptyLedger(), ...(ledger ?? {}) })

/**
 * Records a delivered slice: the seat now holds each entry at its hash, the
 * work keeps the modules it may use, and the envelope waits in the inbox.
 */
export function grant(ledger, { agent, work, envelope, at }) {
  const next = structuredClone(normalize(ledger))
  const held = next.holdings[agent] ?? {}
  for (const entry of envelope.body.entries) {
    const { hash, distance } = entry
    held[entry.module] = { hash, work, job: envelope.body.job, distance, at }
  }
  next.holdings[agent] = held
  const before = next.works[work]?.modules ?? []
  const added = envelope.body.entries.map(e => e.module)
  next.works[work] = { agent, modules: uniq([...before, ...added]) }
  next.catalogs[agent] = [...(next.catalogs[agent] ?? []), envelope]
  return next
}

/** The seats that hold `module` at a hash other than `hash`, besides `except`. */
export function staleHolders(ledger, module, hash, except) {
  return Object.entries(normalize(ledger).holdings)
    .filter(([agent, held]) => agent !== except && held[module] !== undefined)
    .filter(([, held]) => held[module].hash !== hash)
    .map(([agent]) => agent)
    .sort()
}

/** A context.update envelope: the module changed, and its new entry can be pulled. */
export function updateEnvelope({ id, tick, module, oldHash, newHash, by }) {
  return {
    v: ENVELOPE_VERSION, kind: 'context.update', id, from: SERVER_FROM, sent_tick: tick,
    body: { module, old_hash: oldHash, new_hash: newHash, changed_by: by, recommended: true },
  }
}

/** A context.catalog envelope: the slice of the map for one piece of work. */
export function catalogEnvelope({ id, tick, work, agent, goal, slice }) {
  return {
    v: ENVELOPE_VERSION, kind: 'context.catalog', id, from: SERVER_FROM, sent_tick: tick,
    body: { work, seat: agent, goal, job: slice.job, entries: slice.entries },
  }
}

function notify(next, { module, oldHash, newHash, by, tick, mint }) {
  const notified = staleHolders(next, module, newHash, by)
  for (const agent of notified) {
    const kept = (next.notices[agent] ?? []).filter(notice => notice.body.module !== module)
    const id = mint('update')
    next.notices[agent] = [...kept, updateEnvelope({ id, tick, module, oldHash, newHash, by })]
  }
  return notified
}

/**
 * A seat is done with a module. Its entry is rehashed against the current
 * map; if the hash changed, every other holder of an older hash is told an
 * update is available; then the seat's holding is dropped. The caller saves
 * the whole map before this returns to the seat.
 */
export function release(ledger, { agent, work, module, newHash, tick, mint }) {
  const next = structuredClone(normalize(ledger))
  const held = next.holdings[agent]?.[module]
  need(held !== undefined, `${agent} does not hold ${module}`)
  need(
    work === undefined || held.work === work,
    `${agent} holds ${module} for ${held.work}, not ${work}`,
  )
  const changed = held.hash !== newHash
  const notified = changed
    ? notify(next, { module, oldHash: held.hash, newHash, by: agent, tick, mint })
    : []
  delete next.holdings[agent][module]
  const still = next.holdings[agent]
  next.catalogs[agent] = (next.catalogs[agent] ?? [])
    .filter(({ body }) => body.entries.some(e => still[e.module]?.work === body.work))
  return { ledger: next, changed, oldHash: held.hash, newHash, notified }
}

/**
 * A seat takes the current entry for a module it holds: the holding moves to
 * the new hash, the entry in its catalog is replaced, and its notice for that
 * module is cleared.
 */
export function pull(ledger, { agent, module, entry, at }) {
  const next = structuredClone(normalize(ledger))
  const held = next.holdings[agent]?.[module]
  need(held !== undefined, `${agent} does not hold ${module}`)
  next.holdings[agent][module] = { ...held, hash: entry.hash, at }
  const replace = envelope => ({
    ...envelope,
    body: {
      ...envelope.body,
      entries: envelope.body.entries.map(e => (e.module === module ? entry : e)),
    },
  })
  next.catalogs[agent] = (next.catalogs[agent] ?? []).map(replace)
  next.notices[agent] = (next.notices[agent] ?? []).filter(notice => notice.body.module !== module)
  return next
}

/**
 * A seat asks for a module its work's slice did not include. It is granted
 * at once when the work already reaches the module; otherwise it is held for
 * the team lead, who keeps the team on course.
 */
export function requestModule(ledger, { agent, work, module, at, mint }) {
  const next = structuredClone(normalize(ledger))
  const scope = next.works[work]
  need(scope !== undefined && scope.agent === agent, `${work} is not ${agent}'s work`)
  if (scope.modules.includes(module)) return { ledger: next, granted: true }
  const id = mint('request')
  next.requests[id] = { agent, work, module, state: 'pending', at }
  return { ledger: next, granted: false, request: id }
}

/** The team lead decides a held request; an approved module joins the work's scope. */
export function decideRequest(ledger, { id, lead, approve, reason, at }) {
  const next = structuredClone(normalize(ledger))
  const request = next.requests[id]
  need(request !== undefined, `unknown request: ${id}`)
  need(request.state === 'pending', `${id} is already ${request.state}`)
  need(approve || String(reason ?? '').trim() !== '', 'a refusal needs a reason')
  const state = approve ? 'approved' : 'refused'
  next.requests[id] = { ...request, state, by: lead, reason, decided_at: at }
  if (approve) next.works[request.work].modules.push(request.module)
  return next
}

/** What a seat's inbox shows from the ledger: its catalogs, its update notices, what it holds. */
export function catalogInbox(ledger, agent) {
  const now = normalize(ledger)
  return {
    catalogs: now.catalogs[agent] ?? [],
    updates: now.notices[agent] ?? [],
    holding: now.holdings[agent] ?? {},
  }
}

/** The held requests a team lead decides, for the seats on that lead's team. */
export function pendingRequests(ledger, members) {
  return Object.entries(normalize(ledger).requests)
    .filter(([, request]) => request.state === 'pending' && members.includes(request.agent))
    .map(([id, request]) => ({ id, ...request }))
}
