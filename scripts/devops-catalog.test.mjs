import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  catalogEnvelope, catalogIndex, catalogInbox, decideRequest, emptyLedger, grant,
  moduleByHash, pendingRequests, pull, release, requestModule, resolveScope, sliceFor,
  traverse, updateEnvelope,
} from './devops-catalog.mjs'
import { validateEnvelope } from './devops-envelopes.mjs'
import { buildMindMap } from './devops-mindmap.mjs'

const FILES = {
  'core/util.ts': 'export function slugify(text: string) {\n  return text.toLowerCase()\n}\n',
  'core/util.test.ts': "import { slugify } from './util'\nslugify('A')\n",
  'api/routes.ts': "import { slugify } from '../core/util'\n"
    + "export function routeFor(name: string) {\n  return '/' + slugify(name)\n}\n",
  'docs/core.md': '# Core\n\nThe `core/util.ts` module holds `slugify`.\n',
}

function project(files = FILES) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-catalog-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

const GOAL = { id: 'goal-7f0a12', title: 'Slugs for every route' }
const CODER = 'agent-0a0a0a'
const OTHER = 'agent-0b0b0b'
let minted = 0
const mint = prefix => {
  minted += 1
  return `${prefix}-${minted.toString(16).padStart(6, '0')}`
}

/** A ledger where CODER and OTHER both hold the core module from one map. */
function twoHolders(map) {
  const slice = sliceFor(map, { job: 'coder', scope: { modules: ['core'] }, depth: 0 })
  const envelope = work => catalogEnvelope({
    id: mint('catalog'), tick: 1, work, agent: CODER, goal: GOAL, slice,
  })
  const given = (agent, work) => ({ agent, work, envelope: envelope(work), at: 't' })
  const ledger = grant(emptyLedger(), given(CODER, 'work-00000a'))
  return grant(ledger, given(OTHER, 'work-00000b'))
}

test('every module has a record hash in the map, and the index finds it both ways', () => {
  const map = buildMindMap(project()).map
  const index = catalogIndex(map)
  assert.deepEqual(Object.keys(index), ['api', 'core'])
  assert.match(index.core, /^[0-9a-f]{12}$/)
  assert.equal(map.modules.core.hash, index.core)
  assert.equal(moduleByHash(map, index.core), 'core')
})

test('a module hash changes when one of its files changes, and only its own', () => {
  const dir = project()
  const before = catalogIndex(buildMindMap(dir).map)
  fs.appendFileSync(path.join(dir, 'core/util.ts'), 'export const MAX_SLUG = 40\n')
  const after = catalogIndex(buildMindMap(dir).map)
  assert.notEqual(after.core, before.core)
  assert.equal(after.api, before.api)
})

test('a scope names modules by module, file or symbol, and reports what it does not know', () => {
  const map = buildMindMap(project()).map
  const scope = resolveScope(map, { files: ['api/routes.ts'], symbols: ['slugify', 'nope'] })
  assert.deepEqual(scope.modules, ['api', 'core'])
  assert.deepEqual(scope.unknown, ['nope'])
})

test('the traversal reaches neighbours one step out by default, and none at depth 0', () => {
  const map = buildMindMap(project()).map
  assert.deepEqual([...traverse(map, ['core'])], [['core', 0], ['api', 1]])
  assert.deepEqual([...traverse(map, ['core'], 0)], [['core', 0]])
})

test('the slice is shaped for the job: full for named modules, a reference for neighbours', () => {
  const map = buildMindMap(project()).map
  const coder = sliceFor(map, { job: 'coder', scope: { modules: ['core'] } })
  const [core, api] = coder.entries
  assert.equal(core.detail, 'full')
  assert.equal(core.symbols[0].at, 'core/util.ts:1')
  assert.deepEqual(core.tests, ['core/util.test.ts'])
  assert.equal(api.detail, 'reference')
  assert.equal(api.symbols, undefined)
  const reviewer = sliceFor(map, { job: 'reviewer', scope: { modules: ['core'] } }).entries[0]
  assert.deepEqual(reviewer.callers, ['api/routes.ts'])
  const researcher = sliceFor(map, { job: 'researcher', scope: { modules: ['core'] } }).entries[0]
  assert.deepEqual(researcher.docs.map(doc => doc.path), ['docs/core.md'])
})

test('catalog and update envelopes pass the envelope schema', () => {
  const map = buildMindMap(project()).map
  const slice = sliceFor(map, { job: 'coder', scope: { modules: ['core'] } })
  const catalog = catalogEnvelope({
    id: 'catalog-0000c1', tick: 3, work: 'work-00000a', agent: CODER, goal: GOAL, slice,
  })
  assert.deepEqual(validateEnvelope(catalog).errors, [])
  const update = updateEnvelope({
    id: 'update-0000d1', tick: 4, module: 'core',
    oldHash: 'a'.repeat(12), newHash: 'b'.repeat(12), by: CODER,
  })
  assert.deepEqual(validateEnvelope(update).errors, [])
})

test('a release rehashes, tells the other holder of an update, then drops the entry', () => {
  const dir = project()
  const ledger = twoHolders(buildMindMap(dir).map)
  fs.appendFileSync(path.join(dir, 'core/util.ts'), 'export const MAX_SLUG = 40\n')
  const fresh = buildMindMap(dir).map
  const newHash = fresh.modules.core.hash
  const released = release(ledger, { agent: CODER, module: 'core', newHash, tick: 5, mint })
  assert.equal(released.changed, true)
  assert.deepEqual(released.notified, [OTHER])
  assert.equal(released.ledger.holdings[CODER].core, undefined)
  assert.deepEqual(catalogInbox(released.ledger, CODER).catalogs, [])
  const notice = catalogInbox(released.ledger, OTHER).updates[0]
  assert.equal(notice.kind, 'context.update')
  assert.equal(notice.body.new_hash, fresh.modules.core.hash)
  const entry = sliceFor(fresh, { job: 'coder', scope: { modules: ['core'] }, depth: 0 }).entries[0]
  const pulled = pull(released.ledger, { agent: OTHER, module: 'core', entry, at: 't2' })
  assert.equal(pulled.holdings[OTHER].core.hash, fresh.modules.core.hash)
  assert.deepEqual(catalogInbox(pulled, OTHER).updates, [])
})

test('a release with no change notifies no one', () => {
  const map = buildMindMap(project()).map
  const released = release(twoHolders(map), {
    agent: CODER, module: 'core', newHash: map.modules.core.hash, tick: 5, mint,
  })
  assert.equal(released.changed, false)
  assert.deepEqual(released.notified, [])
  assert.deepEqual(catalogInbox(released.ledger, OTHER).updates, [])
})

test('a module outside the work waits for the lead; inside it is granted', () => {
  const map = buildMindMap(project()).map
  const ledger = twoHolders(map)
  const ask = module => ({ agent: CODER, work: 'work-00000a', module, at: 't', mint })
  const inside = requestModule(ledger, ask('core'))
  assert.equal(inside.granted, true)
  const outside = requestModule(ledger, ask('api'))
  assert.equal(outside.granted, false)
  assert.equal(pendingRequests(outside.ledger, [CODER]).length, 1)
  const refusal = { id: outside.request, lead: 'agent-0c0c0c', approve: false }
  assert.throws(() => decideRequest(outside.ledger, refusal))
  const approved = decideRequest(outside.ledger, {
    id: outside.request, lead: 'agent-0c0c0c', approve: true, at: 't',
  })
  assert.ok(approved.works['work-00000a'].modules.includes('api'))
  assert.equal(pendingRequests(approved, [CODER]).length, 0)
})

test('only the seat that holds the work may ask for more of it', () => {
  const ledger = twoHolders(buildMindMap(project()).map)
  const foreign = { agent: OTHER, work: 'work-00000a', module: 'api', at: 't', mint }
  assert.throws(() => requestModule(ledger, foreign))
})
