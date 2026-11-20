import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mcpClient } from './mcp-stdio-client.mjs'

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const STUCK_MS = 8000

test('a stuck server is killed when initialize times out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-'))
  const pidFile = path.join(dir, 'pid')
  const stub = path.join(dir, 'stub.mjs')
  fs.writeFileSync(stub, [
    "import fs from 'node:fs'",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
    "process.on('SIGTERM', () => {})",
    'setInterval(() => {}, 1000)',
  ].join('\n'))
  const options = { replyTimeoutMs: 200, killGraceMs: 200 }
  const pending = mcpClient(process.execPath, [stub], {}, options)
    .then(() => 'resolved', error => error)
  const stuck = new Promise(resolve => setTimeout(() => resolve('stuck'), STUCK_MS))
  const outcome = await Promise.race([pending, stuck])
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  const survived = alive(pid)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
  assert.notEqual(outcome, 'stuck', 'initialize did not settle: the child kept the client waiting')
  const message = outcome instanceof Error ? outcome.message : String(outcome)
  assert.match(message, /initialize: no reply in 200 ms/)
  assert.equal(survived, false, 'no child remains after the failed initialize')
})
