import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { GITIGNORE_LINES, checkTool, detectLanguages, detectServices, install, loadLanguages, loadServices, parseVerify, renderProfile, resolveDest, sandboxArgv, status, validateLanguage } from './devops-setup.mjs'

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

test('install writes both hosts, the profile and the gitignore, once', () => {
  const dir = project(FULLSTACK)
  const first = install({ dest: dir, target: 'both' })
  assert.ok(first.created.length > 30)
  for (const rel of [
    '.cursor/skills/devops-multi-agent-team/SKILL.md', '.claude/skills/devops-multi-agent-team/SKILL.md',
    '.claude/agents/devops-reviewer.md', '.cursor/commands/goal.md', '.devops/project.md', '.devops/languages.json',
    '.devops/LANGUAGES.md', '.devops/languages.local.json', '.devops/thoughts/non-finalized/.gitkeep',
  ]) assert.ok(fs.existsSync(path.join(dir, rel)), rel)
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.devops\/thoughts\/\*/)

  fs.appendFileSync(path.join(dir, '.devops/project.md'), '\nMY EDIT\n')
  const second = install({ dest: dir, target: 'both' })
  assert.equal(second.created.length, 0)
  assert.ok(second.skipped.some(f => f.endsWith('project.md')), 'a hand-edited profile is kept')
  assert.match(fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8'), /MY EDIT/)
  assert.equal((fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').match(/>>> devops-multi-agent-team/g) ?? []).length, 1)

  install({ dest: dir, target: 'both', force: true })
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8'), /MY EDIT/)
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

test('thoughts are git-ignored, their .gitkeep and the profile are not (checked with real git)', () => {
  const dir = project({ 'main.py': 'print(1)\n' })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  install({ dest: dir, target: 'claude' })
  for (const rel of ['.devops/thoughts/non-finalized/review-reviewer-0b0b0b.md', '.devops/thoughts/non-finalized/push-coder-0a0a0a.json', '.devops/thoughts/finalized/goal-x.md', '.devops/thoughts/team-board.md', 'codeql-python.sarif']) {
    assert.ok(ignored(dir, rel), `${rel} should be ignored`)
  }
  for (const rel of ['.devops/thoughts/non-finalized/.gitkeep', '.devops/project.md', '.devops/sandbox.md', '.devops/languages.json', '.claude/skills/devops-multi-agent-team/SKILL.md']) {
    assert.ok(!ignored(dir, rel), `${rel} must not be ignored`)
  }
})

test('the gitignore block is added to a missing file, repaired when damaged, and keeps the user\'s lines', () => {
  const none = project({ 'a.py': '' })
  install({ dest: none, target: 'claude' })
  const text = fs.readFileSync(path.join(none, '.gitignore'), 'utf8')
  for (const line of GITIGNORE_LINES) assert.ok(text.includes(line), line)

  const damaged = project({ 'a.py': '', '.gitignore': 'node_modules/\n# >>> devops-multi-agent-team (managed block; do not edit between the markers)\n.devops/thoughts/*\n# <<< devops-multi-agent-team\ndist/\n' })
  install({ dest: damaged, target: 'claude' })
  const fixed = fs.readFileSync(path.join(damaged, '.gitignore'), 'utf8')
  for (const line of GITIGNORE_LINES) assert.ok(fixed.includes(line), line)
  assert.ok(fixed.includes('node_modules/') && fixed.includes('dist/'))
  const again = install({ dest: damaged, target: 'claude' })
  assert.ok(again.same.some(f => f.endsWith('.gitignore')) && !again.replaced.some(f => f.endsWith('.gitignore')))

  const legacy = project({ 'a.py': '', '.gitignore': 'build/\n\n# devops-multi-agent-team\n.devops/thoughts/*\n!.devops/thoughts/non-finalized/\n\nout/\n' })
  install({ dest: legacy, target: 'claude' })
  const migrated = fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8')
  assert.equal((migrated.match(/\.devops\/thoughts\/\*\n/g) ?? []).length, 1)
  assert.ok(migrated.includes('build/') && migrated.includes('out/'))
})

test('a rule that ignores all of .devops/ is reported', () => {
  const dir = project({ 'a.py': '', '.gitignore': '.devops/\n' })
  const report = install({ dest: dir, target: 'claude' })
  assert.ok(report.warnings.some(w => /ignores \.devops/.test(w)))
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
