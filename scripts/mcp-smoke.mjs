#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL = '2025-06-18'
const SERVER = 'devops-multi-agent-team'
const REPLY_TIMEOUT_MS = 30000
const KILL_GRACE_MS = 2000
const CLI_TIMEOUT_MS = 120000
const DEFAULT_CODE_COLUMNS = 100
const SHOWN_CHARS = 120
const EXPECTED_TOOLS = [
  'detect_project', 'install_devops_team', 'status', 'lint_check', 'lint_commands',
  'config_get', 'config_set', 'comment_audit',
]
const USAGE = [
  'usage: mcp-smoke [--with-claude] [--keep]',
  '  Packs this repository as npm would publish it, installs the package, sets up fresh git',
  '  projects through each install path, and talks to every MCP server over stdio.',
  '  --with-claude also checks the plugin path with the plugin CLI (no API key needed).',
].join('\n')

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

const QUIET = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
const run = (command, args, options = {}) => execFileSync(command, args, { ...QUIET, ...options })

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-smoke-')))

function gitProject(name) {
  const dir = path.join(scratch, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'app.py'), 'print("hello")\n')
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n')
  run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  run('git', ['add', '-A'], { cwd: dir })
  const who = ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.com']
  run('git', [...who, 'commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

const STATUS_ARGS = ['status', '--porcelain', '--untracked-files=all']
const gitStatus = dir => run('git', STATUS_ARGS, { cwd: dir })
const gitClean = dir => gitStatus(dir).trim() === ''

/** The package as npm would publish it, installed into its own prefix, as a person downloads it. */
function installPackage() {
  const packed = path.join(scratch, 'pack')
  fs.mkdirSync(packed)
  const listed = run('npm', ['pack', '--silent', '--pack-destination', packed], { cwd: REPO })
  const name = listed.trim().split('\n').pop()
  const prefix = path.join(scratch, 'prefix')
  run('npm', ['install', '--silent', '--global', '--prefix', prefix, path.join(packed, name)])
  const bin = path.join(prefix, 'bin')
  record('npm pack and install', fs.existsSync(path.join(bin, 'devops-setup')), name)
  return bin
}

/** Newline-delimited JSON-RPC over a child's stdio: requests by id, replies matched back. */
function rpcChannel(child) {
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
    const late = () => reject(new Error(`${method}: no reply in ${REPLY_TIMEOUT_MS} ms`))
    const timer = setTimeout(late, REPLY_TIMEOUT_MS)
    timers.add(timer)
    waiting.set(id, message => { clearTimeout(timer); timers.delete(timer); resolve(message) })
    send({ id, method, params })
  })
  const dispose = () => { for (const timer of timers) clearTimeout(timer); timers.clear() }
  return { rpc, send, dispose }
}

/** Stop a server: SIGTERM, then SIGKILL if it has not exited within the grace period. */
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const forced = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
    child.once('exit', () => { clearTimeout(forced); resolve() })
    child.kill('SIGTERM')
  })
}

/** A minimal MCP client for one server process: initialize, then call tools by name. */
async function mcpClient(command, args, env) {
  const stdio = ['pipe', 'pipe', 'pipe']
  const child = spawn(command, args, { env: { PATH: process.env.PATH, ...env }, stdio })
  const { rpc, send, dispose } = rpcChannel(child)
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
      await stopChild(child)
      dispose()
      throw error
    })
  send({ method: 'notifications/initialized' })
  return { init, rpc, call, close: () => { dispose(); return stopChild(child) } }
}

async function expectTools(label, client) {
  const listed = (await client.rpc('tools/list', {})).result?.tools?.map(t => t.name) ?? []
  const missing = EXPECTED_TOOLS.filter(name => !listed.includes(name))
  const detail = missing.length > 0 ? `missing ${missing.join(', ')}` : `${listed.length} tools`
  record(`${label}: tools/list`, missing.length === 0, detail)
}

async function projectServerChecks(client, dir) {
  await expectTools('project server', client)
  const status = await client.call('status')
  record('project server: status', status.kit && status.gitignoreOk && status.profile)
  const lineLength = await client.call('config_get', { path: 'defaults.lineLength.code' })
  const isDefault = lineLength.value === DEFAULT_CODE_COLUMNS
  record('project server: config_get', isDefault, `${lineLength.value}`)
  fs.appendFileSync(path.join(dir, 'app.py'), 'x = 7 * width\n')
  run('git', ['add', 'app.py'], { cwd: dir })
  const lint = await client.call('lint_check', { staged: true })
  const magic = lint.findings.some(f => f.rule === 'magic-number')
  record('project server: lint_check denies a magic number', lint.verdict === 'DENY' && magic)
}

/** Path 1: `devops-setup init` from the installed package, then the project's own copy of the server. */
async function projectInstall(bin) {
  const dir = gitProject('project-install')
  const report = JSON.parse(run(path.join(bin, 'devops-setup'), ['init', '--dest', dir, '--json']))
  record('init: tools copied into the project', (report.installed.kit?.files ?? 0) > 0)
  record('init: git status stays clean', gitClean(dir))
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'))
  const args = config.mcpServers[SERVER].args.map(a => a.replace('${CLAUDE_PROJECT_DIR:-.}', dir))
  const client = await mcpClient('node', args, { CLAUDE_PROJECT_DIR: dir })
  try {
    await projectServerChecks(client, dir)
  } finally {
    client.close()
  }
}

/** Path 2: setup through chat with the installed package's server, as an assistant calls it. */
async function chatInstall(bin) {
  const dir = gitProject('chat-install')
  const server = path.join(bin, 'devops-multi-agent-team-mcp')
  const client = await mcpClient(server, [], { DEVOPS_MCP_ROOTS: dir })
  try {
    const instructions = client.init.result?.instructions ?? ''
    record('package server: initialize', instructions.includes('SETUP SCRIPT'))
    await expectTools('package server', client)
    const detected = await client.call('detect_project')
    record('chat: detect_project', detected.detectedLanguages.includes('python'))
    const plan = await client.call('install_devops_team', { target: 'claude' })
    record('chat: plan writes nothing', plan.dryRun && !fs.existsSync(path.join(dir, '.devops')))
    await client.call('install_devops_team', { target: 'claude', apply: true })
    const status = await client.call('status')
    record('chat: install applied', status.claude && status.profile && status.gitignoreOk)
    record('chat: git status stays clean', gitClean(dir))
  } finally {
    client.close()
  }
}

/** Path 3: the editor plugin supplies the skill and server; the project gets only .devops/. */
function pluginInstall(bin) {
  const dir = gitProject('plugin-install')
  run(path.join(bin, 'devops-setup'), ['init', '--plugin', '--dest', dir, '--json'])
  const copies = ['.claude', '.cursor', 'devops-skill/kit']
  const wrote = copies.filter(rel => fs.existsSync(path.join(dir, rel)))
  record('plugin mode: only .devops/ and thought folders', wrote.length === 0, wrote.join(', '))
  record('plugin mode: git status stays clean', gitClean(dir))
  return dir
}

const cli = (args, options = {}) => spawnSync('claude', args, { encoding: 'utf8', ...options })

/** The plugin as the CLI loads it: manifest checks, the mod's tests, and the server it starts. */
function pluginChecks(dir) {
  if (cli(['--version']).status !== 0) {
    return record('plugin CLI', false, 'not installed (npm i -g @anthropic-ai/claude-code)')
  }
  record('plugin validate', cli(['plugin', 'validate', REPO]).status === 0)
  const tests = cli(['plugin', 'test', REPO])
  record('plugin test (the mod)', tests.status === 0, (tests.stdout.match(/\d+ fail/) ?? [''])[0])
  const listed = cli(['--plugin-dir', REPO, 'mcp', 'list'], { cwd: dir, timeout: CLI_TIMEOUT_MS })
  const line = `${listed.stdout}`.split('\n').find(l => l.includes(SERVER)) ?? ''
  record('plugin MCP server connects', /Connected/.test(line), line.trim().slice(0, SHOWN_CHARS))
}

async function main(argv) {
  if (argv.includes('--help')) return console.log(USAGE)
  const bin = installPackage()
  await projectInstall(bin)
  await chatInstall(bin)
  const pluginProject = pluginInstall(bin)
  if (argv.includes('--with-claude')) pluginChecks(pluginProject)
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
  if (!argv.includes('--keep')) fs.rmSync(scratch, { recursive: true, force: true })
  process.exitCode = failed.length > 0 ? 1 : 0
}

main(process.argv.slice(2)).catch(error => {
  console.error(`mcp-smoke: ${error.message}`)
  process.exitCode = 2
})
