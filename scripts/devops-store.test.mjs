import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  appendEvent, readEvents, replay, UNFENCED, updateJson, writeAtomic,
} from './devops-store.mjs'

const STORE = fileURLToPath(new URL('./devops-store.mjs', import.meta.url))

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-store-'))
}

test('a write replaces the file and leaves no temp file behind', () => {
  const dir = scratch()
  const file = path.join(dir, 'board.json')
  writeAtomic(file, '{"a":1}\n')
  writeAtomic(file, '{"a":2}\n')
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":2}\n')
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
})

test('a read-modify-write saves the change and a failing change writes nothing', () => {
  const dir = scratch()
  const file = path.join(dir, 'counter.json')
  updateJson(file, { n: 0 }, state => ({ n: state.n + 1 }), UNFENCED)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 1)
  assert.throws(
    () => updateJson(file, { n: 0 }, () => { throw new Error('refused') }, UNFENCED),
    /refused/,
  )
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 1)
  assert.equal(fs.existsSync(`${file}.lock`), false, 'the lock is released after a failure')
})

test('a lock left by a crashed writer is never broken; the error names it', () => {
  const dir = scratch()
  const file = path.join(dir, 'counter.json')
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: 999999, at: Date.now() - 60000 }))
  const held = () => updateJson(file, { n: 0 }, state => state, UNFENCED)
  assert.throws(held, /remove .*counter\.json\.lock/)
  assert.equal(fs.existsSync(`${file}.lock`), true, 'the lock is left for a person to remove')
})

function runChild(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script])
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))))
  })
}

test('three processes updating one file lose no update', async () => {
  const dir = scratch()
  const file = path.join(dir, 'counter.json')
  const script = `
    import { updateJson, UNFENCED } from ${JSON.stringify(STORE)}
    for (let i = 0; i < 25; i += 1) {
      updateJson(${JSON.stringify(file)}, { n: 0 }, s => ({ n: s.n + 1 }), UNFENCED)
    }`
  await Promise.all([runChild(script), runChild(script), runChild(script)])
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 75)
})

test('an event is appended once; the same event again is a no-op', () => {
  const dir = scratch()
  const log = path.join(dir, 'events.jsonl')
  const from = { agent: 'agent-0c0c0c', role: 'manager' }
  const event = { id: 'work-3c9e41', from, kind: 'work.item' }
  assert.equal(appendEvent(log, event, { fence: UNFENCED }).appended, true)
  assert.equal(appendEvent(log, event, { fence: UNFENCED }).appended, false)
  assert.equal(readEvents(log).length, 1)
})

test('the same (agent, id) with different content is refused as a conflict', () => {
  const dir = scratch()
  const log = path.join(dir, 'events.jsonl')
  const from = { agent: 'agent-0c0c0c', role: 'manager' }
  const first = { id: 'work-3c9e41', from, kind: 'work.item' }
  appendEvent(log, first, { fence: UNFENCED })
  const forged = { ...first, kind: 'work.accept' }
  assert.throws(() => appendEvent(log, forged, { fence: UNFENCED }), /different content/)
})

test('a corrupt line in the log is an error that names the line', () => {
  const dir = scratch()
  const log = path.join(dir, 'events.jsonl')
  fs.writeFileSync(log, '{"id":"a"}\n{not json\n')
  assert.throws(() => readEvents(log), /line 2/)
})

test('three processes appending through a link lose no event and fork no chain', async () => {
  const dir = scratch()
  const log = path.join(dir, 'events.jsonl')
  const script = `
    import { appendEvent, UNFENCED } from ${JSON.stringify(STORE)}
    const link = (prev, event) => ({ ...event, prev, chain: event.id })
    const tag = process.argv[1]
    for (let i = 0; i < 15; i += 1) {
      const event = { id: \`\${tag}-\${i}\`, from: { agent: tag }, kind: 'x' }
      appendEvent(${JSON.stringify(log)}, event, { link, fence: UNFENCED })
    }`
  await Promise.all(['a', 'b', 'c'].map(tag => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, tag])
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))))
  })))
  const events = readEvents(log)
  assert.equal(events.length, 45)
  let prev = 'genesis'
  for (const event of events) {
    assert.equal(event.prev, prev, 'each event links to the stored event before it')
    prev = event.id
  }
})

test('a fenced write is refused for a stale epoch and passes for the current one', () => {
  const dir = scratch()
  const leader = path.join(dir, 'leader.json')
  const board = path.join(dir, 'board.json')
  const log = path.join(dir, 'events.jsonl')
  fs.writeFileSync(leader, JSON.stringify({ owner: 'b', epoch: 2 }))
  const stale = { leaderFile: leader, epoch: 1 }
  const current = { leaderFile: leader, epoch: 2 }
  assert.throws(() => updateJson(board, { n: 0 }, s => ({ n: s.n + 1 }), stale), /fenced out/)
  assert.throws(() => updateJson(board, { n: 0 }, s => s), /declares its fence/)
  assert.equal(fs.existsSync(board), false, 'the stale write left the board alone')
  const fencedAppend = () => appendEvent(log, { id: 'a', from: { agent: 'x' } }, { fence: stale })
  assert.throws(fencedAppend, /fenced out/)
  assert.equal(fs.existsSync(log), false, 'the stale write appended nothing')
  updateJson(board, { n: 0 }, s => ({ n: s.n + 1 }), current)
  appendEvent(log, { id: 'a', from: { agent: 'x' } }, { fence: current })
  assert.equal(JSON.parse(fs.readFileSync(board, 'utf8')).n, 1)
  assert.equal(readEvents(log).length, 1)
})

test('replaying the same events always gives the same state', () => {
  const events = [{ n: 1 }, { n: 2 }, { n: 3 }]
  const reduce = (state, event) => ({ total: state.total + event.n })
  const first = replay(events, reduce, { total: 0 })
  const second = replay(events, reduce, { total: 0 })
  assert.deepEqual(first, second)
  assert.deepEqual(first, { total: 6 })
})
