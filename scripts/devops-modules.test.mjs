import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { install } from './devops-setup.mjs'
import { ghasPlan } from './devops-ghas.mjs'
import { moduleMap, moduleOf, reuseSearch } from './devops-research.mjs'
import { parseSemver, tagCreate, tagHistory, tagPlan } from './devops-tags.mjs'

function project(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-mod-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

test('module map finds modules, languages and imports between them', () => {
  const dir = project({
    'web/src/app.ts': "import { api } from '../../server/client'\n", 'web/package.json': '{}',
    'server/client.ts': 'export const api = 1\n', 'server/main.py': 'from .util import x\n', 'server/util.py': 'x = 1\n',
    'core/lib.c': '#include "../server/shim.h"\n', 'server/shim.h': '',
    'docs/guide.md': '# guide\n', 'node_modules/dep/index.js': '',
  })
  const map = moduleMap(dir)
  const ids = map.modules.map(m => m.id)
  assert.ok(['web', 'server', 'core', 'docs'].every(id => ids.includes(id)))
  assert.ok(!ids.includes('node_modules'))
  const edge = (from, to) => map.edges.find(e => e.from === from && e.to === to)
  assert.ok(edge('web', 'server'), 'TypeScript relative import')
  assert.ok(edge('core', 'server'), 'C include')
  assert.match(map.mermaid, /^graph TD/)
  assert.equal(moduleOf('crates/net/src/lib.rs'), 'crates/net')
})

test('reuse search finds definitions, docs and variants, skips secrets and redacts values', () => {
  const dir = project({
    'src/parser.ts': 'export function parseHeader(input: string) {}\n// parse header lines\nconst api_key = "abcd1234secret"\n',
    'docs/design.md': 'The header parser reads parse_header output.\n', 'src/use.ts': 'parseHeader(x)\n',
    '.env': 'parse_header=hunter2hunter2\n', 'notes.tex': '\\section{Header parsing}\n',
  })
  const result = reuseSearch(dir, ['parse header', 'api_key'])
  const first = result.results[0]
  assert.ok(first.matches.some(m => m.kind === 'definition' && m.file === 'src/parser.ts'), 'camelCase variant of the term')
  assert.ok(first.matches.some(m => m.kind === 'doc' && m.file === 'docs/design.md'))
  assert.ok(!JSON.stringify(result).includes('hunter2'), '.env is never read')
  assert.ok(!JSON.stringify(result).includes('abcd1234secret'), 'secret-looking values are redacted')
  assert.throws(() => reuseSearch(dir, ['rm -rf /;']), /not searchable/)
  assert.throws(() => reuseSearch(dir, []), /1 to 12/)
})

test('tags: history between releases, warnings, unreleased bump, plan and create', () => {
  const dir = project({ 'src/a.ts': 'a\n' })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'feat: first')
  git(dir, 'tag', '-a', 'v1.0.0', '-m', 'one')
  fs.appendFileSync(path.join(dir, 'src/a.ts'), 'b\n')
  git(dir, 'commit', '-qam', 'fix!: break the api')
  git(dir, 'tag', '-a', 'v1.0.1', '-m', 'two')
  fs.writeFileSync(path.join(dir, 'src/b.py'), 'x\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'feat: add b')

  const history = tagHistory(dir)
  assert.equal(history.latest, 'v1.0.1')
  const second = history.releases.find(r => r.name === 'v1.0.1')
  assert.equal(second.step, 'patch')
  assert.equal(second.breaking, 1)
  assert.match(second.warnings.join(), /breaking commit/)
  assert.equal(second.languages.typescript, 1)
  assert.equal(history.unreleased.suggestedBump, 'minor')

  const saved = tagHistory(dir, { save: true })
  assert.ok(fs.existsSync(saved.saved))
  git(dir, 'tag', '-a', 'v1.1.0', '-m', 'three')
  const later = tagHistory(dir, { save: true })
  assert.deepEqual(later.sinceLastSnapshot.newTags, ['v1.1.0'])

  const plan = tagPlan(dir, { bump: 'minor' })
  assert.equal(plan.next, 'v1.2.0')
  assert.match(plan.commands[1], /QA PASS/)
  assert.throws(() => tagPlan(dir, { version: '1.1.0' }), /already exists/)
  assert.throws(() => tagPlan(dir, { version: 'banana' }), /not a semantic version/)

  assert.equal(tagCreate(dir, { version: 'v1.2.0' }).applied, false)
  assert.equal(tagCreate(dir, { version: 'v1.2.0', apply: true }).applied, true)
  assert.ok(git(dir, 'tag', '-l', 'v1.2.0').includes('v1.2.0'))
  assert.throws(() => tagCreate(dir, { version: 'v1.2.0', apply: true }), /already exists/)
  assert.throws(() => tagCreate(dir, { version: 'v1.3.0', ref: '--upload-pack=x' }), /plain ref/)
  assert.deepEqual(parseSemver('v2.0.0-rc.1').pre, 'rc.1')
})

test('ghas plan: files for the detected languages and ecosystems, kept when present, human-only settings', () => {
  const dir = project({ 'api/Api.csproj': '<Project/>', 'api/Program.cs': '', 'web/package.json': '{}', 'web/app.ts': '', 'tool/main.py': '', '.github/workflows/ci.yml': 'name: ci\n', 'Dockerfile': 'FROM scratch\n' })
  const plan = ghasPlan(dir)
  assert.deepEqual(plan.codeqlLanguages, ['actions', 'csharp', 'javascript-typescript', 'python'])
  assert.deepEqual(plan.ecosystems.map(e => e.ecosystem).sort(), ['docker', 'github-actions', 'npm', 'nuget'])
  assert.ok(plan.requiredChecks.includes('Analyze (python)'))
  assert.ok(!fs.existsSync(path.join(dir, '.github/workflows/codeql.yml')), 'a plan writes nothing')

  const applied = ghasPlan(dir, { apply: true })
  const codeql = fs.readFileSync(path.join(dir, '.github/workflows/codeql.yml'), 'utf8')
  assert.match(codeql, /language: csharp\n\s+build-mode: none/)
  assert.match(codeql, /permissions:\n  contents: read/)
  assert.match(fs.readFileSync(path.join(dir, '.github/dependabot.yml'), 'utf8'), /package-ecosystem: "nuget"\n\s+directory: "\/api"/)
  assert.ok(fs.existsSync(path.join(dir, 'SECURITY.md')))
  const commands = fs.readFileSync(path.join(dir, '.devops/ghas/commands.md'), 'utf8')
  assert.match(commands, /vulnerability-alerts/)
  assert.match(commands, /run by a human/)
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.devops/ghas/ruleset.json'), 'utf8')).rules.some(r => r.type === 'required_status_checks'))
  assert.ok(applied.files.every(f => ['created', 'same'].includes(f.action)))

  fs.writeFileSync(path.join(dir, '.github/dependabot.yml'), '# mine\n')
  const again = ghasPlan(dir, { apply: true })
  assert.equal(again.files.find(f => f.path === '.github/dependabot.yml').action, 'kept')
  assert.equal(fs.readFileSync(path.join(dir, '.github/dependabot.yml'), 'utf8'), '# mine\n')
  assert.throws(() => ghasPlan(dir, { branch: 'main; rm -rf /' }), /plain branch/)
})

test('install ships the reuse and comment rules for both hosts and the docs section in the profile', () => {
  const dir = project({ 'a.py': '' })
  install({ dest: dir, target: 'both' })
  assert.match(fs.readFileSync(path.join(dir, '.cursor/rules/reuse-before-implement.mdc'), 'utf8'), /alwaysApply: true/)
  assert.ok(fs.existsSync(path.join(dir, '.claude/rules/comments.md')))
  assert.ok(fs.existsSync(path.join(dir, '.claude/agents/devops-coder.md')))
  const profile = fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8')
  assert.match(profile, /## Comments and documentation/)
  assert.match(profile, /PEP 257/)
  assert.match(profile, /Test directories/)
  assert.match(profile, /Blocking boundary rules/)
  assert.match(profile, /Preset `readable-code`/)
  assert.match(profile, /codeql database analyze/)
})

test('the comment policy says self-explanatory code gets no comment, in the rule, the standard and the profile', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const dir = project({ 'a.py': '' })
  install({ dest: dir, target: 'claude' })
  for (const file of ['rules/comments.md', 'skills/devops-multi-agent-team/references/comment-standards.md', 'agents/devops-coder.md', 'agents/devops-reviewer.md']) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /because (you added )?code was added|self-explanatory/i, file)
  }
  const profile = fs.readFileSync(path.join(dir, '.devops/project.md'), 'utf8')
  assert.match(profile, /no comment is added just because code\s+was added/)
  assert.match(profile, /Self-explanatory code gets no comment/)
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'agents/devops-reviewer.md'), 'utf8'), /with\s+no standard doc comment/)
})
