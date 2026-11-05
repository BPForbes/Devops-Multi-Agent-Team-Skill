import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectLanguages, install, loadLanguages, renderProfile } from './devops-setup.mjs'

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
  assert.equal((fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').match(/devops-multi-agent-team/g) ?? []).length, 1)

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
  assert.throws(() => install({ dest: project({}), lang: 'cobol' }), /unknown language id/)
})
