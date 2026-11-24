// Store for board state and the append-only event log (see
// docs/orchestrator-design.md, sections 4.3 and 9).
//   - Writes go to a temp file and are renamed over the target, so nothing
//     reads a half-written file.
//   - Read-modify-write takes an exclusive lock file. A lock older than the
//     stale limit is broken, so a crashed writer cannot block forever.
//   - The event log is JSON Lines. Replaying an event with the same
//     (from.agent, id) is a no-op; the same key with different content is
//     refused as a conflict.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOCK_WAIT_MS = 5000
const LOCK_STALE_MS = 10000
const RETRY_MS = 20

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Writes text to a temp file beside `file`, then renames it over `file`. */
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
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

/** Runs fn while holding the lock file for `file`. Throws if the lock stays busy. */
export function withLock(file, fn) {
  const lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      fs.closeSync(fd)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (isStale(lock)) {
        fs.rmSync(lock, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error(`the lock for ${file} is busy`)
      sleep(RETRY_MS)
    }
  }
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

/**
 * Appends an event unless the log already holds it. Returns { appended }.
 * The same (from.agent, id) with different content is refused.
 */
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

/** Folds events into state. The same events always give the same state. */
export function replay(events, reduce, initial) {
  return events.reduce((state, event) => reduce(state, event), structuredClone(initial))
}
