// Atomic writes, locks and an idempotent event log (design: sections 4.3, 9).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOCK_WAIT_MS = 5000
const LOCK_STALE_MS = 10000
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

function isStale(lock) {
  try {
    const { at } = JSON.parse(fs.readFileSync(lock, 'utf8'))
    return Date.now() - at > LOCK_STALE_MS
  } catch {
    return true
  }
}

/** Takes the lock file, waiting up to LOCK_WAIT_MS and breaking a stale lock. */
function acquire(lock, file) {
  const deadline = Date.now() + LOCK_WAIT_MS
  while (!tryCreate(lock)) {
    if (isStale(lock)) fs.rmSync(lock, { force: true })
    else if (Date.now() > deadline) throw new Error(`the lock for ${file} is busy`)
    else sleep(RETRY_MS)
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
 * Reads a JSON file (or `fallback` when it does not exist), passes a copy to
 * `change`, and writes the result back under the lock. If `change` throws,
 * nothing is written.
 */
export function updateJson(file, fallback, change) {
  return withLock(file, () => {
    const current = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : structuredClone(fallback)
    const next = change(structuredClone(current))
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
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

/** Appends an event unless the log already holds it. Returns { appended }. */
export function appendEvent(logFile, event) {
  return withLock(logFile, () => {
    const key = keyOf(event)
    const existing = readEvents(logFile).find(e => keyOf(e) === key)
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(event)) return { appended: false }
      throw new Error(`event ${key} already exists with different content`)
    }
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`)
    return { appended: true }
  })
}

/** Folds events into state with a pure reducer. */
export function replay(events, reduce, initial) {
  return events.reduce((state, event) => reduce(state, event), structuredClone(initial))
}
