import { spawn } from 'node:child_process'

const PROTOCOL = '2025-06-18'
export const REPLY_TIMEOUT_MS = 30000
export const KILL_GRACE_MS = 2000
export const SHOWN_CHARS = 120

/** Newline-delimited JSON-RPC over a child's stdio: requests by id, replies matched back. */
function rpcChannel(child, replyTimeoutMs) {
  const waiting = new Map()
  const timers = new Set()
  let buffer = ''
  let next = 0
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
    }
  })
  const send = message => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++next
    const late = () => reject(new Error(`${method}: no reply in ${replyTimeoutMs} ms`))
    const timer = setTimeout(late, replyTimeoutMs)
    timers.add(timer)
    waiting.set(id, message => { clearTimeout(timer); timers.delete(timer); resolve(message) })
    send({ id, method, params })
  })
  const dispose = () => { for (const timer of timers) clearTimeout(timer); timers.clear() }
  return { rpc, send, dispose }
}

/** Stop a server: SIGTERM, then SIGKILL if it has not exited within the grace period. */
export function stopChild(child, killGraceMs = KILL_GRACE_MS) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const forced = setTimeout(() => child.kill('SIGKILL'), killGraceMs)
    child.once('exit', () => { clearTimeout(forced); resolve() })
    child.kill('SIGTERM')
  })
}

/** A minimal MCP client for one server process: initialize, then call tools by name. */
export async function mcpClient(command, args, env, options = {}) {
  const { replyTimeoutMs = REPLY_TIMEOUT_MS, killGraceMs = KILL_GRACE_MS } = options
  const stdio = ['pipe', 'pipe', 'pipe']
  const child = spawn(command, args, { env: { PATH: process.env.PATH, ...env }, stdio })
  const { rpc, send, dispose } = rpcChannel(child, replyTimeoutMs)
  const call = async (name, input = {}) => {
    const reply = await rpc('tools/call', { name, arguments: input })
    const text = reply.result?.content?.[0]?.text ?? JSON.stringify(reply.error ?? {})
    const failed = reply.error || reply.result?.isError
    if (failed) throw new Error(`${name}: ${text.slice(0, SHOWN_CHARS)}`)
    return JSON.parse(text)
  }
  const clientInfo = { name: 'mcp-smoke', version: '1' }
  const init = await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo })
    .catch(async error => {
      await stopChild(child, killGraceMs)
      dispose()
      throw error
    })
  send({ method: 'notifications/initialized' })
  return { init, rpc, call, close: () => { dispose(); return stopChild(child, killGraceMs) } }
}
