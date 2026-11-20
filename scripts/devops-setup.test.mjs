import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  GITIGNORE_LINES, checkTool, connectClients, detectLanguages, detectServices, ensureGitignore,
  initProject, install, loadLanguages, loadServices, parseVerify, renderProfile, resolveDest,
  sandboxArgv, status, validateLanguage,
} from './devops-setup.mjs'

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

const FULLSTACK = {
  'Cargo.toml': '[package]\nname="x"\n', 'src/lib.rs': '',
  'web/package.json': '{}', 'web/tsconfig.json': '{}', 'web/src/app.ts': '',
  '.github/workflows/ci.yml': 'name: ci\n', 'scripts/run.sh': '#!/bin/sh\n',
  'App.csproj': '<Project/>', 'node_modules/dep/index.js': '',
}

test('detect finds each layer and skips node_modules', () => {
  const ids = detectLanguages(project(FULLSTACK)).map(d => d.id)
  for (const want of ['rust', 'typescript', 'ci-workflows', 'shell', 'csharp']) assert.ok(ids.includes(want), want)
  assert.ok(!ids.includes('javascript'), 'node_modules/*.js is ignored')
  assert.ok(!ids.includes('python'))
})

test('profile carries commands, departments and only real boundaries', () => {
  const dir = project(FULLSTACK)
  const config = loadLanguages(dir)
  const chosen = config.languages.filter(l => ['rust', 'typescript', 'csharp'].includes(l.id))
  const text = renderProfile(config, chosen, dir)
  assert.match(text, /cargo clippy --locked --all-targets --all-features -- -D warnings/)
  assert.match(text, /dotnet format --verify-no-changes/)
  assert.match(text, /\*\*rust ↔ typescript\*\*/)
  assert.doesNotMatch(text, /\*\*rust ↔ c\*\*/, 'c is not selected')
  assert.match(text, /\| \*\*web\*\* \|/)
  assert.match(text, /explicit-types/)
})

test('install writes both hosts, the profile, the tools and the ignore block, once', () => {
  const dir = project(FULLSTACK)
  const first = install({ dest: dir, target: 'both' })
  assert.ok(first.created.length > 30)
  assert.ok(first.kit.files > 20, 'the tools are copied into the project')
  for (const rel of [
    '.cursor/skills/devops-multi-agent-team/SKILL.md', '.claude/skills/devops-multi-agent-team/SKILL.md',
    '.claude/agents/devops-reviewer.md', '.cursor/commands/goal.md', '.devops/project.md',
    '.devops/languages.local.json', 'devops-skill/thoughts/non-final',
    'devops-skill/thoughts/final',
    'devops-skill/kit/mcp/server.mjs', 'devops-skill/kit/scripts/devops-lint.mjs',
    'devops-skill/kit/standards.json',
  ]) assert.ok(fs.existsSync(path.join(dir, rel)), rel)
  const absent = rel => !fs.existsSync(path.join(dir, rel))
  assert.ok(absent('.devops/languages.json'), 'package data lives in the kit')
  assert.ok(absent('devops-skill/kit/mcp/server.test.mjs'), 'tests are not copied')
  const ignoreText = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
  assert.ok(ignoreText.includes('/devops-skill/'), 'outside git the block falls back to .gitignore')

  fs.appendFileSync(path.join(dir, '.devops/project.md'), '\nMY EDIT\n')
  const second = install({ dest: dir, target: 'both' })
  assert.equal(second.created.length, 0)
  assert.ok(second.skipped.some(f => f.endsWith('project.md')), 'a hand-edited profile is kept')
  assert.match(fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8'), /MY EDIT/)
  const ignoreAgain = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
  const blocks = ignoreAgain.match(/>>> devops-multi-agent-team/g)
  assert.equal(blocks.length, 1)

  install({ dest: dir, target: 'both', force: true })
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8'), /MY EDIT/)
})

test('copied instructions point at the project\'s own tools', () => {
  const dir = project({ 'a.py': '' })
  install({ dest: dir, target: 'claude' })
  const skill = path.join(dir, '.claude/skills/devops-multi-agent-team/references/lint-rules.md')
  assert.match(fs.readFileSync(skill, 'utf8'), /node devops-skill\/kit\/scripts\/devops-lint\.mjs/)
  assert.doesNotMatch(fs.readFileSync(skill, 'utf8'), /node scripts\//)
})

test('dry run writes nothing', () => {
  const dir = project({ 'main.py': 'print(1)\n' })
  const report = install({ dest: dir, target: 'claude', dryRun: true })
  assert.ok(report.created.length > 0)
  assert.ok(!fs.existsSync(path.join(dir, '.claude')))
})

test('a local override adds a language and wins by id', () => {
  const dir = project({ 'Gemfile': '', 'app.rb': '' })
  fs.mkdirSync(path.join(dir, '.devops'))
  fs.writeFileSync(path.join(dir, '.devops/languages.local.json'), JSON.stringify({ languages: [
    { id: 'ruby', name: 'Ruby', layers: ['backend'], detect: { files: ['Gemfile'] }, toolchain: { verify: 'ruby -v', install: [] }, validate: ['bundle exec rspec'], security: { sast: null, sca: [], secrets: [], unanalysed: true }, interactsWith: [] },
    { id: 'python', validate: ['tox'] },
  ] }))
  const config = loadLanguages(dir)
  assert.deepEqual(detectLanguages(dir, config).map(d => d.id), ['ruby'])
  assert.deepEqual(config.languages.find(l => l.id === 'python').validate, ['tox'])
  assert.equal(config.languages.find(l => l.id === 'python').name, 'Python')
})

test('an unknown --lang id is refused', () => {
  assert.throws(() => install({ dest: project({}), lang: 'brainfuck' }), /unknown language id/)
})

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
const ignored = (dir, rel) => git(dir, 'check-ignore', '-q', rel).status === 0

function gitProject(files) {
  const dir = project(files)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  const who = ['-c', 'user.name=t', '-c', 'user.email=t@t']
  execFileSync('git', [...who, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}
const untracked = dir => git(dir, 'status', '--porcelain', '--untracked-files=all').stdout.trim()

test('in a git repository nothing the install writes shows up; no tracked file changes', () => {
  const dir = gitProject({ 'main.py': 'print(1)\n', '.gitignore': 'node_modules/\n' })
  const report = initProject({ dest: dir, target: 'both' })
  assert.equal(untracked(dir), '', 'git status stays clean')
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules/\n')
  const exclude = fs.readFileSync(path.join(dir, '.git/info/exclude'), 'utf8')
  assert.match(exclude, /^\/devops-skill\/$/m)
  assert.match(exclude, /^\/\.devops\/$/m)
  const written = [
    'devops-skill/thoughts/final/goal-x.md', '.devops/project.md', '.mcp.json',
    'codeql-python.sarif',
    '.claude/skills/devops-multi-agent-team/SKILL.md', '.cursor/rules/comments.mdc',
    '.claude/agents/devops-coder.md',
  ]
  for (const rel of written) {
    assert.ok(ignored(dir, rel), `${rel} should be ignored`)
  }
  assert.ok(status(dir).gitignoreOk)
  assert.equal(status(dir).ignoreFile, path.join('.git', 'info', 'exclude'))
  assert.deepEqual(report.installed.warnings, [])
})

test('the project\'s own same-named files stay visible to git', () => {
  const dir = gitProject({ 'a.py': '' })
  fs.mkdirSync(path.join(dir, '.claude/commands'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude/commands/goal.md'), 'our own goal command\n')
  install({ dest: dir, target: 'claude' })
  assert.ok(!ignored(dir, '.claude/commands/goal.md'))
  assert.ok(ignored(dir, '.claude/commands/cleanup.md'))
})

test('--share-config keeps .devops/ committable while the tools and copies stay local', () => {
  const dir = gitProject({ 'a.py': '' })
  install({ dest: dir, target: 'claude', shareConfig: true })
  for (const rel of ['.devops/project.md', '.devops/standards.json']) {
    assert.ok(!ignored(dir, rel), rel)
  }
  assert.ok(ignored(dir, 'devops-skill/kit/mcp/server.mjs'))
  assert.ok(ignored(dir, '.claude/skills/devops-multi-agent-team/SKILL.md'))
  const again = { created: [], replaced: [], same: [], warnings: [], commands: [] }
  ensureGitignore(dir, { root: dir }, again)
  assert.ok(!ignored(dir, '.devops/project.md'), 'the mode is remembered')
})

test('an earlier install is cleaned up: its block goes, tracked copies get a command', () => {
  const dir = gitProject({
    'a.py': '',
    '.gitignore': 'build/\n\n# >>> devops-multi-agent-team (managed block; do not edit between'
      + ' the markers)\ndevops-skill/thoughts/*\n# <<< devops-multi-agent-team\n',
    '.claude/skills/devops-multi-agent-team/SKILL.md': 'old copy\n',
  })
  const report = install({ dest: dir, target: 'claude', force: true })
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'build/\n')
  assert.ok(report.warnings.some(w => /removed the old .* block from \.gitignore/.test(w)))
  assert.ok(report.warnings.some(w => /git already tracks/.test(w)))
  assert.ok(report.commands.some(c => c.startsWith('git rm -r --cached')))
  const prefix = path.join(dir, '.claude/skills/devops-multi-agent-team/SKILL.md')
  assert.ok(fs.existsSync(prefix), 'nothing is deleted from disk')
})

test('a .mcp.json that git tracks is not edited; a local connection is offered instead', () => {
  const shared = JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2) + '\n'
  const dir = gitProject({ 'a.py': '', '.mcp.json': shared, '.claude/.keep': '' })
  const report = connectClients({ dest: dir, clients: 'claude' })
  assert.equal(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'), shared)
  const local = 'claude mcp add devops-multi-agent-team --scope local'
  assert.ok(report.commands.some(c => c.startsWith(local)))
  const kit = path.join(dir, 'devops-skill/kit/mcp/server.mjs')
  assert.ok(fs.existsSync(kit), 'connect also writes the tools')
})

test('outside git the block goes into .gitignore, is repaired, and keeps the user\'s lines', () => {
  const none = project({ 'a.py': '' })
  const report = install({ dest: none, target: 'claude' })
  const text = fs.readFileSync(path.join(none, '.gitignore'), 'utf8')
  for (const line of GITIGNORE_LINES) assert.ok(text.includes(line), line)
  assert.ok(report.warnings.some(w => /not a git repository/.test(w)))

  const damaged = project({ 'a.py': '', '.gitignore': 'node_modules/\n# >>> devops-multi-agent-team (managed block; do not edit between the markers)\ndevops-skill/thoughts/*\n# <<< devops-multi-agent-team\ndist/\n' })
  install({ dest: damaged, target: 'claude' })
  const fixed = fs.readFileSync(path.join(damaged, '.gitignore'), 'utf8')
  for (const line of GITIGNORE_LINES) assert.ok(fixed.includes(line), line)
  assert.ok(fixed.includes('node_modules/') && fixed.includes('dist/'))
  const again = install({ dest: damaged, target: 'claude' })
  assert.ok(again.same.some(f => f.endsWith('.gitignore')) && !again.replaced.some(f => f.endsWith('.gitignore')))

  const legacy = project({ 'a.py': '', '.gitignore': 'build/\n\n# devops-multi-agent-team\ndevops-skill/thoughts/*\n!devops-skill/thoughts/non-final/\n\nout/\n' })
  install({ dest: legacy, target: 'claude' })
  const migrated = fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8')
  assert.equal((migrated.match(/>>> devops-multi-agent-team/g) ?? []).length, 1)
  assert.ok(!migrated.includes('!devops-skill/thoughts/non-final/'), 'the legacy block is replaced')
  assert.ok(migrated.includes('/devops-skill/'))
  assert.ok(migrated.includes('build/') && migrated.includes('out/'))
})

test('install never writes through a symlink or outside the project', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-out-'))
  const dir = project({ 'a.py': '' })
  fs.symlinkSync(outside, path.join(dir, '.devops'))
  assert.throws(() => install({ dest: dir, target: 'claude' }), /symbolic link|outside the project/)
  assert.deepEqual(fs.readdirSync(outside), [])
})

test('dest must be a real folder that is not / or the home folder', () => {
  assert.throws(() => resolveDest('/'), /too broad/)
  assert.throws(() => resolveDest(os.homedir()), /too broad/)
  assert.throws(() => resolveDest('/definitely/not/here'), /not a directory/)
  const dir = project({})
  assert.throws(() => resolveDest(dir, ['/somewhere/else']), /outside the folders/)
})

test('services are detected from files and rendered with the human-only actions', () => {
  const dir = project({ Dockerfile: 'FROM scratch\n', 'infra/main.tf': '' })
  const ids = detectServices(dir).map(s => s.id)
  assert.ok(ids.includes('docker'))
  install({ dest: dir, target: 'claude' })
  const profile = fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8')
  assert.match(profile, /Only the human runs or approves/)
  assert.match(profile, /## Sandbox/)
  assert.ok(fs.existsSync(path.join(dir, '.devops/sandbox.md')))
})

test('the sandbox command is locked down, and refuses what the policy forbids', () => {
  const policy = loadServices(project({})).sandboxPolicy
  const test_ = sandboxArgv(policy, { phase: 'test', image: 'rust:1-slim', cmd: ['cargo', 'test'], worktree: '/work/tree' })
  const flat = test_.argv.join(' ')
  assert.match(flat, /--network none/)
  for (const must of ['--read-only', '--cap-drop ALL', 'no-new-privileges', '--user 65532:65532', '-v /work/tree:/work:rw']) assert.ok(flat.includes(must), must)
  assert.doesNotMatch(flat, /--privileged|docker\.sock|--network host/)
  assert.match(sandboxArgv(policy, { phase: 'deps', image: 'rust:1-slim', cmd: ['cargo', 'fetch'], worktree: '/w' }).shell, /--network bridge/)
  assert.throws(() => sandboxArgv(policy, { phase: 'nope', image: 'x', cmd: ['a'], worktree: '/w' }), /unknown sandbox phase/)
  assert.throws(() => sandboxArgv(policy, { image: 'x; rm -rf /', cmd: ['a'], worktree: '/w' }), /plain image/)
  assert.throws(() => sandboxArgv(policy, { image: 'x', cmd: ['a'], worktree: 'relative' }), /absolute/)
  assert.throws(() => sandboxArgv({ ...policy, default: { ...policy.default, env: { pass: ['API_TOKEN'], blockPatterns: ['TOKEN'] } } }, { image: 'x', cmd: ['a'], worktree: '/w' }), /refusing to pass/)
})

test('only "<tool> --version" style checks ever run', () => {
  assert.deepEqual(parseVerify('cargo --version'), ['cargo', '--version'])
  assert.deepEqual(parseVerify('kubectl version --client'), ['kubectl', 'version', '--client'])
  for (const bad of ['rm -rf /', './tool --version', '/bin/sh --version', 'sh -c id', 'tool --version; id', 'tool', '', null]) assert.equal(parseVerify(bad), null, String(bad))
  assert.equal(checkTool('node --version').installed, true)
  assert.equal(checkTool('definitely-not-a-tool --version').installed, false)
  assert.equal(checkTool('rm -rf').checked, false)
})

test('every shipped language and service passes the shared validators; ids resolve both ways', () => {
  const dir = project({})
  const config = loadLanguages(dir)
  const ctx = { layers: config.layers, codeqlLanguages: config.codeqlLanguages }
  for (const lang of config.languages) assert.deepEqual(validateLanguage(lang, ctx), [], lang.id)
  assert.ok(config.languages.length >= 39)
  assert.ok(status(dir).gitignoreOk === false)
})

test('a language can be used whatever its layer: any id installs', () => {
  const dir = project({})
  const report = install({ dest: dir, target: 'claude', lang: 'gdscript,cobol,r,html,zig', services: 'none', dryRun: true })
  assert.deepEqual(report.languages, ['gdscript', 'cobol', 'r', 'html', 'zig'])
})
