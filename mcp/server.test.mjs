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

test('initialize negotiates, lists 32 tools, prompts and resources', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const tools = (await c.rpc('tools/list')).result.tools.map(t => t.name)
    for (const name of ['detect_project', 'install_devops_team', 'ensure_gitignore', 'add_language', 'check_toolchain', 'sandbox_plan', 'list_languages', 'list_services', 'module_map', 'reuse_search', 'tag_history', 'tag_plan', 'tag_create', 'ghas_plan', 'comment_audit', 'story_parse', 'story_graph', 'story_new', 'story_link', 'story_check', 'story_guidance', 'cleanup_brief', 'cleanup_scan', 'formal_check', 'mindmap_overview', 'mindmap_build', 'mindmap_status', 'mindmap_query']) assert.ok(tools.includes(name), name)
    assert.equal(tools.length, 32)
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
      sandboxImage: 'node:22-slim', docs: { format: 'elm-format doc comments ({-| … -})', lineComment: '--', check: 'elm-review' }, comments: { line: ['--'], block: [['{-', '-}']] }, security: { sast: null, sca: [], secrets: ['gitleaks detect --redact'], unanalysed: true }, interactsWith: [{ with: 'javascript', via: 'ports', contract: 'the port names' }],
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

test('research, tag and security tools work through chat and stay inside the folder', async () => {
  const root = tmp({ 'src/parser.ts': 'export function parseHeader() {}\n', 'web/package.json': '{}', 'web/app.ts': '' })
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    assert.match((await c.call('module_map')).json().mermaid, /^graph TD/)
    const found = (await c.call('reuse_search', { terms: ['parse header'] })).json()
    assert.ok(found.results[0].matches.some(m => m.kind === 'definition'))
    assert.ok((await c.call('reuse_search', { terms: [] })).isError)

    assert.match((await c.call('mindmap_overview')).json().overview, /at a glance/)
    const built = (await c.call('mindmap_build', { save: true })).json()
    assert.match(built.summary, /# Repository mind map/)
    assert.ok(fs.existsSync(path.join(root, '.devops', 'mindmap', 'MINDMAP.md')))
    assert.equal((await c.call('mindmap_status')).json().stale, false)
    assert.equal((await c.call('mindmap_query', { symbol: 'parseHeader' })).json().definitions[0].file, 'src/parser.ts')
    assert.ok((await c.call('mindmap_query', { symbol: 'a', file: 'b' })).isError)

    const plan = (await c.call('ghas_plan')).json()
    assert.equal(plan.applied, false)
    assert.ok(!fs.existsSync(path.join(root, '.github')))
    assert.equal((await c.call('ghas_plan', { apply: true })).json().applied, true)
    assert.ok(fs.existsSync(path.join(root, '.github/workflows/dependency-review.yml')))
    assert.ok((await c.call('ghas_plan', { dest: os.tmpdir(), apply: true })).isError)

    const notGit = await c.call('tag_history')
    assert.ok(notGit.isError, 'not a repository')
  } finally { c.close() }

  const off = await client({ env: { DEVOPS_MCP_ROOTS: root, DEVOPS_MCP_NO_GIT: '1' } })
  try {
    assert.match((await off.call('tag_plan')).text, /disabled/)
  } finally { off.close() }
})

test('comment_audit works through chat on a staged change and is read-only', async () => {
  const root = tmp({ 'src/a.ts': '// Increment i by 1\ni++\n// Not sure about this?\n' })
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const result = (await c.call('comment_audit', { staged: true })).json()
    assert.ok(result.blocking >= 2)
    assert.ok(result.findings.some(f => f.rule === 'restates-code' && /^issue \(blocking\)/.test(f.remark)))
    assert.ok(result.findings.some(f => f.rule === 'question'))
    assert.ok((await c.call('comment_audit', { base: '--output=x' })).isError)
  } finally { c.close() }
  const off = await client({ env: { DEVOPS_MCP_ROOTS: root, DEVOPS_MCP_NO_GIT: '1' } })
  try { assert.match((await off.call('comment_audit', { staged: true })).text, /disabled/) } finally { off.close() }
})

test('stories through chat: create, link, graph two projects, check, guide', async () => {
  const root = tmp({ 'Makefile': 'CC=cc\nall: build\n' })
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'], { cwd: root })
  const other = tmp({})
  const c = await client({ env: { DEVOPS_MCP_ROOTS: [root, other].join(path.delimiter) } })
  try {
    await c.call('install_devops_team', { dest: root, target: 'claude', apply: true })
    await c.call('install_devops_team', { dest: other, target: 'claude', apply: true })
    assert.equal((await c.call('story_new', { dest: root, id: 'CLI-01', title: 'first' })).json().applied, false)
    assert.ok(!fs.existsSync(path.join(root, '.devops/stories/CLI-01.md')))
    await c.call('story_new', { dest: root, id: 'CLI-01', title: 'first', apply: true })
    await c.call('story_new', { dest: root, id: 'CLI-02', title: 'second', dependsOn: ['CLI-01'], apply: true })
    await c.call('story_new', { dest: other, id: 'SRV-01', title: 'consumer', dependsOn: ['CLI-02'], apply: true })
    assert.ok((await c.call('story_new', { dest: root, id: 'CLI-01', title: 'dup', apply: true })).isError)
    await c.call('story_link', { dest: root, from: 'CLI-02', to: 'CLI-01', relation: 'depends-on', apply: true })
    await c.call('story_link', { dest: root, from: 'CLI-02', to: 'SRV-01', relation: 'shares-contract', apply: true })
    const one = (await c.call('story_graph', { dest: root })).json()
    assert.deepEqual(one.levels[0], ['CLI-01'])
    const both = (await c.call('story_graph', { dests: [root, other] })).json()
    assert.ok(both.stories === 3 && both.crossProject.some(e => e.from === 'CLI-02' && e.to === 'SRV-01'))
    assert.ok(both.problems.some(p => p.startsWith('inverse-missing')), 'SRV-01 depends on CLI-02, but CLI-02 does not list it as needed by')
    const parsed = (await c.call('story_parse', { text: '> **Catalog entry SRV-22** · project: **SERVER · C**\n| **Status** | PROPOSED |\n| **Depends on** | CLI-02 |', title: 'SRV-22: x' })).json()
    assert.deepEqual([parsed.id, parsed.status, parsed.dependsOn], ['SRV-22', 'PROPOSED', ['CLI-02']])
    assert.equal((await c.call('story_check', { dest: root, id: 'CLI-01' })).json().ok, false)
    assert.match((await c.call('story_guidance', { dest: root })).json().text, /Ready to start: CLI-01/)
    assert.ok((await c.call('story_graph', { dests: [os.tmpdir()] })).isError)
  } finally { c.close() }
})

test('the setup script travels in the MCP instructions, a resource and the prompt', async () => {
  const c = await client({ env: { DEVOPS_MCP_ROOTS: tmp() } })
  try {
    const init = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    const text = init.result.instructions
    for (const step of ['SETUP SCRIPT', 'detect_project', 'install_devops_team with apply=false', 'check_toolchain', 'devops-skill/thoughts/non-final/']) assert.ok(text.includes(step), step)
    const resource = await c.rpc('resources/read', { uri: 'devops://setup' })
    assert.ok(resource.result.contents[0].text.startsWith('SETUP SCRIPT'))
    const prompt = await c.rpc('prompts/get', { name: 'setup_project', arguments: { services: 'docker' } })
    assert.ok(prompt.result.messages[0].content.text.includes('SETUP SCRIPT'))
    assert.ok(prompt.result.messages[0].content.text.includes('docker'))
  } finally { c.close() }
})

test('cleanup through chat: a plain-English statement, a scan, a saved baseline and a comparison', async () => {
  const block = ['const rows = input.filter(r => r.active)', 'const grouped = new Map()', 'for (const row of rows) {', '  const key = row.team + ":" + row.region', '  grouped.set(key, (grouped.get(key) ?? 0) + row.amount)', '}', 'const sorted = [...grouped.entries()].sort((a, b) => b[1] - a[1])', 'return sorted.slice(0, 10)'].join('\n')
  const root = tmp({ 'src/a.js': block + '\n', 'src/b.js': block + '\n', 'vendor/v.js': block + '\n' })
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const brief = (await c.call('cleanup_brief', { statement: 'Remove duplicated code in src. Do not touch vendor.' })).json()
    assert.deepEqual(brief.goals, ['duplicates'])
    assert.deepEqual(brief.scope.paths, ['src'])
    const scan = (await c.call('cleanup_scan', { statement: 'Remove duplicated code in src. Do not touch vendor.', save: 'before' })).json()
    assert.ok(scan.candidates.some(x => x.kind === 'duplicate-code' && x.locations.every(l => l.file.startsWith('src/'))))
    assert.equal(scan.snapshot.saved, 'devops-skill/thoughts/non-final/cleanup-before.json')
    fs.writeFileSync(path.join(root, 'src/b.js'), "import './a.js'\n")
    const after = (await c.call('cleanup_scan', { goals: ['duplicates'], paths: ['src'], compare: 'before' })).json()
    assert.equal(after.compare.improved, true)
    assert.ok((await c.call('cleanup_scan', { save: '../x' })).isError)
    assert.ok((await c.call('cleanup_scan', { dest: os.tmpdir() })).isError)
  } finally { c.close() }
})
