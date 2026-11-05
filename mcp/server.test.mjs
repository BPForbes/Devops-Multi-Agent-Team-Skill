import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs')

function tmp(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-mcp-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

/** A client for one server process. `onRequest` answers requests the server makes (roots/list). */
function client({ env = {}, cwd = os.tmpdir(), capabilities = {}, onRequest } = {}) {
  const child = spawn('node', [SERVER], { cwd, env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let buffer = ''
  let id = 0
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, i))
      buffer = buffer.slice(i + 1)
      if (message.method && message.id !== undefined) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: onRequest?.(message) ?? {} }) + '\n')
      } else if (waiting.has(message.id)) {
        waiting.get(message.id)(message)
        waiting.delete(message.id)
      }
    }
  })
  const rpc = (method, params) => new Promise(resolve => {
    const mine = ++id
    waiting.set(mine, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mine, method, params }) + '\n')
  })
  const call = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args })
    const text = response.result?.content?.[0]?.text ?? ''
    return { isError: response.result?.isError === true, text, json: () => JSON.parse(text), response }
  }
  const ready = async () => {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities, clientInfo: { name: 'test', version: '0' } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    return { rpc, call, close: () => child.kill() }
  }
  return ready()
}

test('initialize negotiates, lists 12 tools, prompts and resources', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const tools = (await c.rpc('tools/list')).result.tools.map(t => t.name)
    for (const name of ['detect_project', 'install_devops_team', 'ensure_gitignore', 'add_language', 'check_toolchain', 'sandbox_plan', 'list_languages', 'list_services']) assert.ok(tools.includes(name), name)
    assert.equal(tools.length, 12)
    const writers = (await c.rpc('tools/list')).result.tools.filter(t => t.name === 'install_devops_team')
    assert.equal(writers[0].annotations.destructiveHint, false)
    assert.ok((await c.rpc('prompts/list')).result.prompts.some(p => p.name === 'setup_project'))
    const prompt = await c.rpc('prompts/get', { name: 'setup_project', arguments: { services: 'docker,ollama' } })
    assert.match(prompt.result.messages[0].content.text, /apply=false/)
    const languages = await c.rpc('resources/read', { uri: 'devops://languages' })
    assert.ok(JSON.parse(languages.result.contents[0].text).languages.length >= 39)
    assert.equal((await c.rpc('nope/method')).error.code, -32601)
  } finally { c.close() }
})

test('chat flow: detect, plan writes nothing, apply writes, gitignore is in place', async () => {
  const root = tmp({ 'Cargo.toml': '[package]\n', 'src/lib.rs': '', 'Dockerfile': 'FROM scratch\n' })
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const detected = (await c.call('detect_project')).json()
    assert.ok(detected.languages.some(l => l.id === 'rust'))
    assert.ok(detected.services.some(s => s.id === 'docker'))
    assert.equal(detected.gitignoreOk, false)

    const plan = (await c.call('install_devops_team', { target: 'claude' })).json()
    assert.equal(plan.dryRun, true)
    assert.ok(plan.created.length > 20)
    assert.ok(!fs.existsSync(path.join(root, '.devops')), 'a plan writes nothing')

    const applied = (await c.call('install_devops_team', { target: 'claude', apply: true })).json()
    assert.equal(applied.dryRun, false)
    assert.ok(fs.existsSync(path.join(root, '.devops/project.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude/skills/devops-multi-agent-team/SKILL.md')))
    assert.ok(!fs.existsSync(path.join(root, '.cursor')), 'only the chosen host')
    assert.equal((await c.call('status')).json().gitignoreOk, true)

    const again = (await c.call('ensure_gitignore', { apply: true })).json()
    assert.equal(again.replaced.length + again.created.length, 0)

    const profile = (await c.call('get_profile', { languages: ['rust'], services: 'none' })).text
    assert.match(profile, /cargo clippy/)
  } finally { c.close() }
})

test('the server will not leave its folders', async () => {
  const root = tmp()
  const other = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const outside = await c.call('install_devops_team', { dest: other, apply: true })
    assert.ok(outside.isError)
    assert.match(outside.text, /outside the folders/)
    assert.ok(!fs.existsSync(path.join(other, '.devops')))
    assert.ok((await c.call('detect_project', { dest: '/' })).isError)
    assert.ok((await c.call('install_devops_team', { dest: path.join(root, '..') })).isError)
    const escape = path.join(root, 'link')
    fs.symlinkSync(other, escape)
    assert.ok((await c.call('install_devops_team', { dest: escape, apply: true })).isError, 'a symlink out of the root is outside')
  } finally { c.close() }
})

test('bad arguments are errors, not crashes', async () => {
  const c = await client({ env: { DEVOPS_MCP_ROOTS: tmp() } })
  try {
    assert.ok((await c.call('install_devops_team', { languages: ['rust; rm -rf /'] })).isError)
    assert.ok((await c.call('install_devops_team', { languages: ['nope-lang'] })).isError)
    assert.ok((await c.call('get_language', { id: 'nope' })).isError)
    assert.ok((await c.call('check_toolchain', { ids: ['../etc'] })).isError)
    assert.equal((await c.rpc('tools/call', { name: 'nope', arguments: {} })).error.code, -32602)
    assert.equal((await c.call('list_languages')).isError, false)
  } finally { c.close() }
})

test('add_language validates, saves on apply, and the language then works anywhere', async () => {
  const root = tmp({ 'main.elm': 'module Main exposing (..)\n', 'elm.json': '{}' })
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const entry = {
      id: 'elm', name: 'Elm', layers: ['web'], detect: { files: ['elm.json'], extensions: ['.elm'] },
      toolchain: { install: ['npm i -g elm elm-format elm-test'], verify: 'elm --version' },
      validate: ['elm make src/Main.elm --output=/dev/null', 'elm-format --validate src', 'elm-test'],
      sandboxImage: 'node:22-slim', security: { sast: null, sca: [], secrets: ['gitleaks detect --redact'], unanalysed: true }, interactsWith: [{ with: 'javascript', via: 'ports', contract: 'the port names' }],
    }
    const evil = { ...entry, toolchain: { install: ['x'], verify: 'sh -c "id"' } }
    const rejected = (await c.call('add_language', { entry: evil, apply: true })).json()
    assert.equal(rejected.ok, false)
    assert.match(rejected.problems.join('\n'), /toolchain\.verify/)
    assert.ok(!fs.existsSync(path.join(root, '.devops')))

    assert.equal((await c.call('add_language', { entry })).json().applied, false)
    assert.ok(!fs.existsSync(path.join(root, '.devops')))
    assert.equal((await c.call('add_language', { entry, apply: true })).json().applied, true)
    const found = (await c.call('detect_project')).json().languages.map(l => l.id)
    assert.ok(found.includes('elm'))
    assert.equal((await c.call('get_language', { id: 'elm' })).json().name, 'Elm')
  } finally { c.close() }
})

test('check_toolchain reports tools and env vars by name, never values', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root, ANTHROPIC_API_KEY: 'sk-test-should-never-appear' } })
  try {
    const result = await c.call('check_toolchain', { ids: ['javascript', 'anthropic', 'zig'] })
    assert.ok(!result.text.includes('sk-test-should-never-appear'))
    const rows = Object.fromEntries(result.json().map(r => [r.id, r]))
    assert.equal(rows.javascript.checked, true)
    assert.equal(rows.anthropic.env.ANTHROPIC_API_KEY, 'set')
    assert.equal(rows.anthropic.checked, false)
  } finally { c.close() }
})

test('sandbox_plan prints a locked-down command and runs nothing', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const plan = (await c.call('sandbox_plan', { language: 'rust', command: ['cargo', 'test', '--locked'] })).json()
    assert.match(plan.shell, /--network none/)
    assert.match(plan.shell, new RegExp(`-v ${root}:/work:rw`))
    assert.ok(plan.shell.endsWith('cargo test --locked'))
    assert.ok((await c.call('sandbox_plan', { language: 'containers', command: ['docker', 'build', '.'] })).isError, 'no image, no sandbox')
    assert.ok((await c.call('sandbox_plan', { language: 'rust', command: ['cargo', 'test'], phase: 'push' })).isError)
  } finally { c.close() }
})

test('without DEVOPS_MCP_ROOTS the client\'s MCP roots decide', async () => {
  const root = tmp({ 'go.mod': 'module x\n' })
  const elsewhere = tmp()
  const c = await client({ cwd: elsewhere, capabilities: { roots: {} }, onRequest: m => (m.method === 'roots/list' ? { roots: [{ uri: `file://${root}`, name: 'p' }] } : {}) })
  try {
    await new Promise(r => setTimeout(r, 200))
    const detected = (await c.call('detect_project')).json()
    assert.equal(detected.dest, root)
    assert.ok(detected.languages.some(l => l.id === 'go'))
    assert.ok((await c.call('detect_project', { dest: elsewhere })).isError)
  } finally { c.close() }
})
