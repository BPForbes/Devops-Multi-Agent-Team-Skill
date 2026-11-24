import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkArtifactPath, checkRoute, checkSender, chainEvents, chainLinker, roleMayUse,
  verifyChain,
} from './devops-identity.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendEvent, readEvents } from './devops-store.mjs'

const KEY = 'server-secret'
const envelope = (kind, agent) => ({ kind, from: { agent, role: 'manager' } })

test('an envelope must name the seat the server bound, and a role may send its kinds', () => {
  const ok = checkSender({
    boundSeat: 'agent-m', boundRole: 'manager', envelope: envelope('work.item', 'agent-m'),
  })
  assert.equal(ok.ok, true)
  const spoof = checkSender({
    boundSeat: 'agent-b', boundRole: 'coder', envelope: envelope('work.checkin', 'agent-m'),
  })
  assert.equal(spoof.ok, false)
  const notAllowed = checkSender({
    boundSeat: 'agent-b', boundRole: 'coder', envelope: envelope('work.item', 'agent-b'),
  })
  assert.equal(notAllowed.ok, false)
})

test('a seat may send its own work, the human channel only sends human answers', () => {
  assert.equal(checkSender({
    boundSeat: 'agent-b', boundRole: 'coder', envelope: envelope('help.request', 'agent-b'),
  }).ok, true)
  assert.equal(checkSender({
    boundSeat: 'agent-b', boundRole: 'coder', envelope: envelope('human.answer', 'agent-b'),
  }).ok, false)
})

test('the manager cannot push, approve or change gates', () => {
  assert.equal(roleMayUse('manager', 'push'), false)
  assert.equal(roleMayUse('manager', 'approve'), false)
  assert.equal(roleMayUse('manager', 'gate'), false)
  assert.equal(roleMayUse('manager', 'board'), true)
})

test('a seat may not route to a human', () => {
  assert.equal(checkRoute({ boundRole: 'coder', route: 'human' }).ok, false)
  assert.equal(checkRoute({ boundRole: 'server', route: 'human' }).ok, true)
})

test('an artifact path must stay in the repo and may not name a protected file', () => {
  assert.equal(checkArtifactPath({ repoRoot: '/repo', artifact: 'src/a.mjs' }).ok, true)
  assert.equal(checkArtifactPath({ repoRoot: '/repo', artifact: '../secrets' }).ok, false)
  assert.equal(checkArtifactPath({ repoRoot: '/repo', artifact: '/etc/passwd' }).ok, false)
  const standards = '.devops/standards.json'
  assert.equal(checkArtifactPath({ repoRoot: '/repo', artifact: standards }).ok, false)
})

test('a chained log verifies, and a tampered or reordered log fails', () => {
  const log = chainEvents([{ id: 'a' }, { id: 'b' }, { id: 'c' }], KEY)
  assert.equal(verifyChain(log, KEY), true)
  const edited = log.map(e => (e.id === 'b' ? { ...e, id: 'x' } : e))
  assert.equal(verifyChain(edited, KEY), false)
  const reordered = [log[1], log[0], log[2]]
  assert.equal(verifyChain(reordered, KEY), false)
  assert.equal(verifyChain(log, 'other-key'), false)
})

test('events appended under the log lock through the linker form one verifiable chain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-chain-'))
  const log = path.join(dir, 'events.jsonl')
  for (let i = 0; i < 5; i += 1) {
    const event = { id: `ev-${i}`, from: { agent: 'agent-m' }, kind: 'x' }
    appendEvent(log, event, { link: chainLinker(KEY) })
  }
  assert.equal(verifyChain(readEvents(log), KEY), true)
})
