// Atomic writes, locks and an idempotent event log (design: sections 4.3, 9).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOCK_WAIT_MS = 5000
const RETRY_MS = 20
const UUID_BYTES = 4
const INT32_BYTES = 4

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, ms)
}

/** Writes text to a temp file beside `file`, then renames it over `file`. */
export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(UUID_BYTES).toString('hex')}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

/**
 * Takes the lock by exclusive create. A lock is never broken automatically:
 * a second writer waits, and if the lock is still held after LOCK_WAIT_MS it
 * fails with the lock path, so a person can remove it once no writer runs.
 */
function acquire(lock, file) {
  const deadline = Date.now() + LOCK_WAIT_MS
  while (!tryCreate(lock)) {
    if (Date.now() > deadline) {
      throw new Error(`the lock for ${file} is held; if no writer runs, remove ${lock}`)
    }
    sleep(RETRY_MS)
  }
}

function tryCreate(lock) {
  try {
    const fd = fs.openSync(lock, 'wx')
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
    fs.closeSync(fd)
    return true
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  }
}

/** Runs fn while holding the lock file for `file`. */
export function withLock(file, fn) {
  const lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  acquire(lock, file)
  try {
    return fn()
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

/**
 * Runs fn under a fence: the leader file's lock is held across fn, and fn runs
 * only while that file's epoch is still `fence.epoch`. A takeover takes the same
 * lock, so it cannot land between the check and the write. With no fence, fn
 * just runs.
 */
export function withFence(fence, fn) {
  if (!fence) return fn()
  return withLock(fence.leaderFile, () => {
    const held = fs.existsSync(fence.leaderFile)
      ? JSON.parse(fs.readFileSync(fence.leaderFile, 'utf8')).epoch
      : 0
    if (held !== fence.epoch) {
      throw new Error(`epoch ${fence.epoch} is fenced out (leader is ${held})`)
    }
    return fn()
  })
}

/**
 * Reads a JSON file (or `fallback` when it does not exist), passes a copy to
 * `change`, and writes the result back under the lock. If `change` throws,
 * nothing is written. With `fence`, the write is refused unless the fence holds.
 */
export function updateJson(file, fallback, change, fence = null) {
  return withFence(fence, () => withLock(file, () => {
    const current = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : structuredClone(fallback)
    const next = change(structuredClone(current))
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    return next
  }))
}

/** Reads a JSON Lines event log. A bad line is an error, with its number. */
export function readEvents(logFile) {
  if (!fs.existsSync(logFile)) return []
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(line => line.trim() !== '')
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch {
        throw new Error(`event log ${logFile} line ${index + 1} is not JSON`)
      }
    })
}

const keyOf = event => `${event.from?.agent}/${event.id}`

const bare = ({ chain, ...rest }) => rest
const lastLink = events => (events.length === 0 ? 'genesis' : events.at(-1).chain ?? 'genesis')

/**
 * Appends an event unless the log already holds it. With `link`, the stored
 * event is link(previousLink, event): the link is computed under the lock, from
 * the last stored link, so concurrent writers cannot fork a chain. Returns
 * { appended }.
 */
export function appendEvent(logFile, event, { link = null, fence = null } = {}) {
  return withFence(fence, () => withLock(logFile, () => {
    const key = keyOf(event)
    const events = readEvents(logFile)
    const existing = events.find(e => keyOf(e) === key)
    if (existing !== undefined) {
      if (JSON.stringify(bare(existing)) === JSON.stringify(event)) return { appended: false }
      throw new Error(`event ${key} already exists with different content`)
    }
    const stored = link ? link(lastLink(events), event) : event
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, `${JSON.stringify(stored)}\n`)
    return { appended: true }
  }))
}

/** Folds events into state with a pure reducer. */
export function replay(events, reduce, initial) {
  return events.reduce((state, event) => reduce(state, event), structuredClone(initial))
}
