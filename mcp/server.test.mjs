import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeHandoff } from '../scripts/devops-handoff.mjs'

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
  const notes = []
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
      } else if (message.method) {
        notes.push(message)
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
    return { rpc, call, notes, close: () => child.kill() }
  }
  return ready()
}

test('initialize negotiates, lists 34 tools, prompts and resources', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  try {
    const tools = (await c.rpc('tools/list')).result.tools.map(t => t.name)
    for (const name of ['detect_project', 'install_devops_team', 'ensure_gitignore', 'add_language', 'check_toolchain', 'sandbox_plan', 'list_languages', 'list_services', 'module_map', 'reuse_search', 'tag_history', 'tag_plan', 'tag_create', 'ghas_plan', 'comment_audit', 'story_parse', 'story_graph', 'story_new', 'story_link', 'story_check', 'story_guidance', 'cleanup_brief', 'cleanup_scan', 'formal_check', 'mindmap_overview', 'mindmap_tree', 'mindmap_note', 'mindmap_build', 'mindmap_status', 'mindmap_query']) assert.ok(tools.includes(name), name)
    const added = ['lint_check', 'lint_commands', 'config_get', 'config_set']
    for (const name of added) assert.ok(tools.includes(name), name)
    assert.equal(tools.length, 79)
    const catalogTools = [
      'catalog_index', 'catalog_release', 'catalog_pull', 'catalog_request', 'catalog_decide',
    ]
    for (const name of catalogTools) assert.ok(tools.includes(name), name)
    const scrum = [
      'allocation_plan', 'board_spin_up', 'meeting_schedule', 'meeting_hold', 'goal_signoff',
      'report_forward', 'goal_merge', 'goal_done', 'report_prepare', 'report_new_approach',
      'goal_scan', 'goal_raise', 'bug_report', 'bug_issue', 'bug_filed', 'work_decide',
    ]
    for (const name of scrum) {
      assert.ok(tools.includes(name), name)
    }
    const teamTools = ['team_board_open', 'team_item_add', 'team_item_move', 'team_item_signoff']
    for (const name of [...teamTools, 'needs_attention']) assert.ok(tools.includes(name), name)
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
    assert.equal((await c.call('mindmap_tree', { node: 'parseHeader' })).json().node.id, 'symbol:src/parser.ts#parseHeader')
    assert.equal((await c.call('mindmap_note', { node: 'parseHeader', text: 'Reads one header.' })).json().applied, false)
    assert.ok(!fs.existsSync(path.join(root, '.devops', 'mindmap', 'NOTES.md')))

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
    assert.ok(
      both.problems.some(p => p.startsWith('inverse-missing')),
      'SRV-01 depends on CLI-02, but CLI-02 does not list it as needed by; graph: '
        + JSON.stringify({ problems: both.problems, warnings: both.warnings }),
    )
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

test('config_set plans by default, writes only with apply, refuses an invalid value', async () => {
  const root = tmp({ 'a.py': 'print(1)\n' })
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const file = path.join(root, '.devops', 'standards.json')
  try {
    const set = { op: 'set', path: 'defaults.lineLength.code', value: 120 }
    const plan = (await c.call('config_set', set)).json()
    assert.equal(plan.written, false)
    assert.equal(plan.now, 120)
    assert.ok(!fs.existsSync(file))
    assert.equal((await c.call('config_set', { ...set, apply: true })).json().written, true)
    const read = (await c.call('config_get', { path: 'defaults.lineLength.code' })).json()
    assert.deepEqual([read.value, read.source], [120, '.devops/standards.json'])
    const bad = (await c.call('config_set', { ...set, value: -5, apply: true })).json()
    assert.equal(bad.written, false)
    assert.ok(bad.problems.length > 0)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).defaults.lineLength.code, 120)
  } finally { c.close() }
})

test('a subscribed seat is pushed on new work, and can read its inbox', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const seat = 'agent-0a0a0a'
  const uri = `devops://inbox/${seat}`
  await c.call('board_add_goal', { goal: 'goal-3c9e41', title: 'Lint gate' })
  const subscribed = await c.rpc('resources/subscribe', { uri })
  assert.deepEqual(subscribed.result, {})
  await c.call('work_assign', {
    goal: 'goal-3c9e41', job: 'coder', agent: seat, team: 'team-1a2b3c',
    description: 'Fix the parser',
  })
  const pushed = () => c.notes.some(
    n => n.method === 'notifications/resources/updated' && n.params.uri === uri,
  )
  const deadline = Date.now() + 8000
  while (!pushed() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(pushed(), 'a notification for the subscribed inbox arrived')
  const readBack = await c.rpc('resources/read', { uri })
  const read = JSON.parse(readBack.result.contents[0].text)
  assert.equal(read.work.length, 1)
  assert.equal(read.work[0].description, 'Fix the parser')
  c.close()
})

test('subscribing to something that is not an inbox is refused', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const response = await c.rpc('resources/subscribe', { uri: 'devops://board' })
  assert.equal(response.error.code, -32602)
  c.close()
})

test('a thread on a goal is pushed to the coder inbox and readable as a resource', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const coder = 'agent-0a0a0a'
  const qa = 'agent-0c0c0c'
  const inboxUri = `devops://inbox/${coder}`
  await c.call('board_add_goal', { goal: 'goal-3c9e41', title: 'Lint gate' })
  await c.rpc('resources/subscribe', { uri: inboxUri })
  await c.call('handoff_send', {
    caller: coder,
    payload: {
      kind: 'coder-to-review', item: 'item-3c9e41', goal: 'goal-3c9e41', signed_by: coder,
      from: { job: 'coder', agent: coder, team: 'team-1a2b3c' },
      to: { job: 'reviewer', agent: '', team: 'team-7a8b9c' },
      reason: '', blame: null, created: '2026-11-23T10:00:00Z',
    },
  })
  await c.call('thread_open', {
    goal: 'goal-3c9e41', item: 'item-3c9e41', topic: 'Repro fails', agent: qa,
    team: 'team-4d5e6f', body: 'Step 3 gives exit 2',
  })
  const pushed = () => c.notes.some(n => n.method === 'notifications/resources/updated'
    && n.params.uri === inboxUri)
  const deadline = Date.now() + 8000
  while (!pushed() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(pushed(), 'the coder inbox was pushed')
  const inbox = await c.rpc('resources/read', { uri: inboxUri })
  assert.equal(JSON.parse(inbox.result.contents[0].text).threads.length, 1)
  const threads = await c.rpc('resources/read', { uri: 'devops://threads/goal-3c9e41' })
  assert.equal(JSON.parse(threads.result.contents[0].text).threads[0].topic, 'Repro fails')
  c.close()
})

test('a server bound to a seat refuses to act as another seat', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root, DEVOPS_SEAT: 'agent-0a0a0a' } })
  const refused = await c.call('handoff_send', { caller: 'agent-0c0c0c', payload: {} })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /bound to agent-0a0a0a/)
  c.close()
})

test('the board is never written through a symbolic link out of the project', async () => {
  const root = tmp()
  const outside = tmp()
  fs.symlinkSync(outside, path.join(root, 'devops-skill'))
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const refused = await c.call('board_create_sprint', { name: 'S1' })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /symbolic link/)
  assert.equal(fs.existsSync(path.join(outside, 'thoughts')), false)
  c.close()
})

test('only Orchestration, not a bound seat, may assign work', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root, DEVOPS_SEAT: 'agent-0a0a0a' } })
  const refused = await c.call('work_assign', {
    goal: 'goal-3c9e41', job: 'coder', agent: 'agent-0a0a0a', team: 'team-1a2b3c',
    description: 'Fix the parser',
  })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /only Orchestration/)
  c.close()
})

test('the server records Orchestration as the one who assigned the work', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  await c.call('board_add_goal', { goal: 'goal-3c9e41', title: 'Lint gate' })
  const assigned = await c.call('work_assign', {
    goal: 'goal-3c9e41', job: 'coder', agent: 'agent-0a0a0a', team: 'team-1a2b3c',
    description: 'Fix the parser',
  })
  assert.notEqual(assigned.isError, true, assigned.text)
  const read = await c.rpc('resources/read', { uri: 'devops://work/agent-0a0a0a' })
  const work = JSON.parse(read.result.contents[0].text)
  assert.equal(work.work[0].assigned_by, 'orchestration')
  c.close()
})

test('only Orchestration, not a bound seat, may allow a same-team review', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root, DEVOPS_SEAT: 'agent-0a0a0a' } })
  const refused = await c.call('board_allow_same_team', {
    goal: 'goal-3c9e41', team: 'team-1a2b3c', reason: 'low on resources',
  })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /only Orchestration/)
  c.close()
})

test('a team keeps its own board; nothing closes without security sign-off', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const team = 'team-1a2b3c'
  const members = [
    { agent: 'agent-lead', role: 'manager' },
    { agent: 'agent-dev', role: 'assignee' },
    { agent: 'agent-rev', role: 'reviewer' },
    { agent: 'agent-qa', role: 'qa' },
    { agent: 'agent-sec', role: 'security' },
    { agent: 'agent-srv', role: 'server' },
    { agent: 'agent-hum', role: 'human' },
  ]
  const call = (name, args) => c.call(name, { dest: root, team, ...args })
  const move = (caller, item, to) => call('team_item_move', { caller, item, to })
  assert.equal((await call('team_board_open', { caller: 'agent-dev', members })).isError, true)
  assert.equal((await call('team_board_open', { caller: 'agent-lead', members })).isError, false)
  assert.equal((await call('team_board_open', { caller: 'agent-lead', members })).isError, true)
  const body = { goal: 'goal-7f0a12', job: 'coder', acceptance: ['tests pass'], points: 3 }
  const add = (caller, item) => call('team_item_add', { caller, item, ...body })
  assert.equal((await add('agent-x', 'item-0000a1')).isError, true)
  for (const item of ['item-0000a1', 'item-0000a2']) {
    assert.equal((await add('agent-dev', item)).isError, false)
  }
  const steps = [
    ['agent-srv', 'assigned'], ['agent-dev', 'in_progress'], ['agent-dev', 'in_review'],
    ['agent-rev', 'in_qa'], ['agent-qa', 'in_security'],
  ]
  for (const item of ['item-0000a1', 'item-0000a2']) {
    for (const [caller, to] of steps) {
      assert.equal((await move(caller, item, to)).isError, false, to)
    }
  }
  const signoff = (caller, item) => call('team_item_signoff', { caller, item })
  assert.equal((await signoff('agent-dev', 'item-0000a1')).isError, true)
  assert.equal((await signoff('agent-sec', 'item-0000a1')).isError, false)
  assert.equal((await move('agent-sec', 'item-0000a1', 'ready_for_human')).isError, false)
  const byPerson = await move('agent-hum', 'item-0000a1', 'done')
  assert.equal(byPerson.isError, true, 'the team lead signs an item off as done')
  const done1 = await move('agent-lead', 'item-0000a1', 'done')
  assert.equal(done1.isError, false, 'signed off, so the lead can close it')
  assert.equal((await move('agent-sec', 'item-0000a2', 'ready_for_human')).isError, false)
  const refused = await move('agent-lead', 'item-0000a2', 'done')
  assert.equal(refused.isError, true)
  assert.match(refused.text, /security sign-off/)
  const teamFile = path.join(root, '.devops', 'teams', `${team}.json`)
  const saved = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
  assert.equal(saved.refusals.at(-1).action, 'move', 'the refusal is kept on the team board')
  assert.equal(saved.refusals.at(-1).by, 'agent-lead')
  const notLead = await call('needs_attention', { caller: 'agent-dev' })
  assert.equal(notLead.isError, true, 'only the lead')
  const view = (await call('needs_attention', { caller: 'agent-lead' })).json()
  assert.deepEqual(view.attention.map(a => [a.id, a.kind]), [['item-0000a2', 'awaiting_lead']])
  c.close()
})

const RESEARCH = { task: 'Fix the parser', streams: [{ name: 'parser', files: 2, unknowns: true }] }
const SPIN = {
  research: RESEARCH, name: 'Sprint 1', weeks: 1, goals: { parser: 'goal-111111' },
  teams: {
    A1: { team: 'team-a1a1a1', lead: 'agent-a1a1a1' },
    R1: { team: 'team-b2b2b2', lead: 'agent-b2b2b2' },
    Q1: { team: 'team-c3c3c3', lead: 'agent-c3c3c3' },
    S1: { team: 'team-d4d4d4', lead: 'agent-d4d4d4' },
  },
}

test('research plans the teams, Orchestration spins up the board, the lead plans', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const plan = (await c.call('allocation_plan', { research: RESEARCH })).json()
  assert.deepEqual(plan.teams.map(t => t.name), ['A1', 'R1', 'Q1', 'S1'])
  const up = await c.call('board_spin_up', { dest: root, ...SPIN })
  assert.notEqual(up.isError, true, up.text)
  const { sprint, meetings, setup } = up.json()
  assert.equal(meetings.length, 4, 'every team lead gets a Sprint Planning')
  assert.equal(setup[0].body.versions.node, process.versions.node, 'and a setup payload')
  const held = await c.call('meeting_hold', {
    dest: root, caller: 'agent-a1a1a1', id: meetings[0].id, minutes: 60,
    attendees: ['agent-a1a1a1', 'agent-b1b1b1'],
    record: {
      businessAnalyst: 'agent-b1b1b1',
      sprintGoal: 'Empty config parses', goals: ['goal-111111'],
      tasks: [{ goal: 'goal-111111', job: 'coder', title: 'Fix it' }],
    },
  })
  assert.notEqual(held.isError, true, held.text)
  const boardRead = await c.rpc('resources/read', { uri: 'devops://board' })
  const view = JSON.parse(boardRead.result.contents[0].text)
  assert.deepEqual(view.sprints[sprint].map(g => g.goal), ['goal-111111'])
  const read = await c.rpc('resources/read', { uri: `devops://meetings/${sprint}` })
  const sprintMeetings = JSON.parse(read.result.contents[0].text)
  assert.equal(sprintMeetings.meetings[0].state, 'held')
  assert.equal(sprintMeetings.allocation.teams.length, 4)
  for (const state of ['ready', 'in_progress', 'review', 'qa', 'security']) {
    await c.call('board_move_goal', { dest: root, goal: 'goal-111111', state })
  }
  const direct = await c.call('board_move_goal', { dest: root, goal: 'goal-111111', state: 'done' })
  assert.equal(direct.isError, true)
  const goal = 'goal-111111'
  const signoff = caller => c.call('goal_signoff', { dest: root, caller, sprint, goal })
  const early = await signoff('agent-a1a1a1')
  assert.match(early.text, /no review hand-off to QA \(team-c3c3c3\)/)
  const qa = 'agent-0c0c0c'
  const sec = 'agent-0d0d0d'
  const base = { item: 'item-3c9e41', goal, created: '2026-11-24T10:00:00Z' }
  const rev = 'agent-0b0b0b'
  const reviewed = makeHandoff('review-to-qa', {
    ...base, signedBy: rev, fromAgent: rev, fromTeam: 'team-b2b2b2',
    toAgent: qa, toTeam: 'team-c3c3c3',
  })
  const toSecurity = makeHandoff('qa-to-security', {
    ...base, signedBy: qa, fromAgent: qa, fromTeam: 'team-c3c3c3',
    toAgent: sec, toTeam: 'team-d4d4d4',
  })
  const clear = makeHandoff('security-signoff', {
    ...base, signedBy: sec, fromAgent: sec, fromTeam: 'team-d4d4d4',
    toAgent: '', toTeam: '', result: 'clear',
  })
  for (const [caller, payload] of [[rev, reviewed], [qa, toSecurity], [sec, clear]]) {
    const sent = await c.call('handoff_send', { dest: root, caller, payload })
    assert.notEqual(sent.isError, true, sent.text)
  }
  const stranger = await signoff('agent-b2b2b2')
  assert.equal(stranger.isError, true)
  const unverified = await signoff('agent-a1a1a1')
  assert.match(unverified.text, /peer verification/)
  const as = (caller, more = {}) => ({ dest: root, caller, team: 'team-a1a1a1', goal, ...more })
  const peerDone = await c.call('goal_done', as('agent-0e0e0e'))
  assert.match(peerDone.text, /runs merge-ok on the peer step before done/)
  for (const caller of ['agent-0e0e0e', 'agent-a1a1a1']) {
    const ok = await c.call('goal_merge', as(caller, { decision: 'ok' }))
    assert.notEqual(ok.isError, true, ok.text)
    const done = await c.call('goal_done', as(caller))
    assert.notEqual(done.isError, true, done.text)
  }
  const reportsRead = await c.rpc('resources/read', { uri: 'devops://reports' })
  const reports = JSON.parse(reportsRead.result.contents[0].text)
  assert.equal(reports.awaitingBa.length, 1)
  assert.deepEqual(reports.baPings.map(p => p.step), ['peer', 'lead'])
  const scan = { dest: root, caller: 'agent-b1b1b1', goal, verdict: 'hold', reason: 'ask client' }
  const scanned = await c.call('goal_scan', scan)
  assert.notEqual(scanned.isError, true, scanned.text)
  const baArgs = { dest: root, caller: 'agent-b1b1b1', goal, decision: 'ok' }
  const blocked = await c.call('goal_merge', baArgs)
  assert.match(blocked.text, /scan holds the ba step: ask client/)
  await c.call('goal_scan', { ...scan, verdict: 'ok', reason: undefined })
  const baOk = await c.call('goal_merge', baArgs)
  assert.notEqual(baOk.isError, true, baOk.text)
  const ba = await c.call('goal_done', { dest: root, caller: 'agent-b1b1b1', goal })
  assert.match(ba.text, /schedule sprint-[0-9a-f]{6}'s Sprint Review first/)
  const merge = { branch: 'main', design: 'parser module', implementation: 'one guard' }
  const forwarded = await c.call('report_forward', {
    dest: root, sprint, ids: [reports.awaitingBa[0].id], summary: 'Parser fix done', merge,
  })
  assert.match(forwarded.text, /is awaiting_ba, not to_orchestration/)
  const denied = await c.call('goal_merge', {
    dest: root, caller: 'agent-b1b1b1', goal, decision: 'deny', reason: 'Review: name the key',
  })
  assert.notEqual(denied.isError, true, denied.text)
  const after = JSON.parse((await c.rpc('resources/read', { uri: 'devops://reports' }))
    .result.contents[0].text)
  assert.equal(after.reopened[0].needs_client_review, true)
  c.close()
})

test('a bound seat cannot spin up the board or hold a meeting as another seat', async () => {
  const root = tmp()
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root, DEVOPS_SEAT: 'agent-0a0a0a' } })
  const refused = await c.call('board_spin_up', { dest: root, ...SPIN })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /only Orchestration/)
  const forward = {
    dest: root, sprint: 'sprint-aaaaaa', ids: ['report-aaaaaa'], summary: 'x',
    merge: { branch: 'main', design: 'x', implementation: 'x' },
  }
  const report = await c.call('report_forward', forward)
  assert.match(report.text, /only Orchestration reports to the person/)
  const prepare = await c.call('report_prepare', { dest: root, ids: ['report-aaaaaa'] })
  assert.match(prepare.text, /only Orchestration prepares the merge presentation/)
  const foreign = await c.call('meeting_hold', {
    dest: root, caller: 'agent-a1a1a1', id: 'meeting-aaaaaa', minutes: 5,
    attendees: ['agent-a1a1a1'],
  })
  assert.equal(foreign.isError, true)
  c.close()
})

test('a seat bound to a team hash cannot act under another team', async () => {
  const root = tmp()
  const env = { DEVOPS_MCP_ROOTS: root, DEVOPS_SEAT: 'agent-0a0a0a', DEVOPS_TEAM: 'team-a1a1a1' }
  const c = await client({ env })
  const merge = { dest: root, caller: 'agent-0a0a0a', goal: 'goal-111111', decision: 'ok' }
  const foreign = await c.call('goal_merge', { ...merge, team: 'team-b2b2b2' })
  assert.match(foreign.text, /bound to team-a1a1a1; it cannot act for team-b2b2b2/)
  const own = await c.call('goal_merge', { ...merge, team: 'team-a1a1a1' })
  assert.match(own.text, /goal is not on the board/)
  c.close()
})

const CATALOG_PROJECT = {
  'core/util.ts': 'export function slugify(text: string) {\n  return text.toLowerCase()\n}\n',
  'core/util.test.ts': "import { slugify } from './util'\nslugify('A')\n",
  'api/routes.ts': "import { slugify } from '../core/util'\n"
    + "export function routeFor(name: string) {\n  return '/' + slugify(name)\n}\n",
  'web/page.ts': 'export function pageTitle() {\n  return 1\n}\n',
}
const LEAD = 'agent-0c0c0c'
const CODER = 'agent-0a0a0a'
const PEER = 'agent-0b0b0b'

const inboxOfSeat = async (c, agent) => JSON.parse(
  (await c.rpc('resources/read', { uri: `devops://inbox/${agent}` })).result.contents[0].text,
)

/** Two seats given work on the core module, each delivered a catalog. */
async function twoSeatsOnCore(c) {
  await c.call('board_add_goal', { goal: 'goal-3c9e41', title: 'Slugs for every route' })
  const work = {}
  for (const agent of [CODER, PEER]) {
    const assigned = await c.call('work_assign', {
      goal: 'goal-3c9e41', job: 'coder', agent, team: 'team-1a2b3c',
      description: 'Make slugs safe', scope: { files: ['core/util.ts'] }, depth: 0,
    })
    assert.notEqual(assigned.isError, true, assigned.text)
    work[agent] = assigned.json().id
    assert.deepEqual(assigned.json().context.modules, ['core'])
  }
  return work
}

test('assigned work delivers a catalog of the mind map, not the whole map', async () => {
  const root = tmp(CATALOG_PROJECT)
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  await twoSeatsOnCore(c)
  const inbox = await inboxOfSeat(c, CODER)
  const [catalog] = inbox.context.catalogs
  assert.equal(catalog.kind, 'context.catalog')
  assert.equal(catalog.body.goal.title, 'Slugs for every route')
  assert.deepEqual(catalog.body.entries.map(entry => entry.module), ['core'])
  assert.match(inbox.context.holding.core.hash, /^[0-9a-f]{12}$/)
  const index = (await c.call('catalog_index')).json().index
  assert.equal(index.core, inbox.context.holding.core.hash)
  c.close()
})

test('a release rehashes, saves the map, tells the other holder, and drops the entry', async () => {
  const root = tmp(CATALOG_PROJECT)
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const work = await twoSeatsOnCore(c)
  const oldHash = (await inboxOfSeat(c, PEER)).context.holding.core.hash
  fs.appendFileSync(path.join(root, 'core/util.ts'), 'export const MAX_SLUG = 40\n')
  const released = await c.call('catalog_release', {
    agent: CODER, work: work[CODER], module: 'core',
  })
  assert.notEqual(released.isError, true, released.text)
  assert.deepEqual(released.json().notified, [PEER])
  assert.ok(fs.existsSync(path.join(root, '.devops/mindmap/mindmap.json')))
  assert.equal((await inboxOfSeat(c, CODER)).context.holding.core, undefined)
  const notice = (await inboxOfSeat(c, PEER)).context.updates[0]
  assert.equal(notice.body.old_hash, oldHash)
  assert.notEqual(notice.body.new_hash, oldHash)
  const pulled = await c.call('catalog_pull', { agent: PEER, module: 'core' })
  assert.equal(pulled.json().entry.hash, notice.body.new_hash)
  const after = await inboxOfSeat(c, PEER)
  assert.deepEqual(after.context.updates, [])
  assert.equal(after.context.catalogs[0].body.entries[0].hash, notice.body.new_hash)
  c.close()
})

test('a module outside the work waits for the lead, who keeps the team on course', async () => {
  const root = tmp(CATALOG_PROJECT)
  const c = await client({ env: { DEVOPS_MCP_ROOTS: root } })
  const work = await twoSeatsOnCore(c)
  await c.call('team_board_open', {
    team: 'team-1a2b3c', caller: LEAD,
    members: [{ agent: LEAD, roles: ['manager'] }, { agent: CODER, roles: ['coder'] }],
  })
  const asked = (await c.call('catalog_request', {
    agent: CODER, work: work[CODER], module: 'web',
  })).json()
  assert.equal(asked.granted, false)
  const view = (await c.call('needs_attention', { team: 'team-1a2b3c', caller: LEAD })).json()
  assert.equal(view.catalogRequests[0].module, 'web')
  const byCoder = await c.call('catalog_decide', {
    team: 'team-1a2b3c', caller: CODER, id: asked.request, approve: true,
  })
  assert.equal(byCoder.isError, true)
  const approved = await c.call('catalog_decide', {
    team: 'team-1a2b3c', caller: LEAD, id: asked.request, approve: true,
  })
  assert.equal(approved.json().state, 'approved')
  assert.ok((await inboxOfSeat(c, CODER)).context.holding.web)
  c.close()
})
