import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintCheck, lintCommands } from './devops-lint.mjs'
import { PATTERNS, RULES } from './devops-lint-rules.mjs'
import { loadStandards } from './devops-standards.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gitArgs = ['-c', 'user.name=t', '-c', 'user.email=t@t']

function repo(files, { commit = {} } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-lint-')))
  const write = set => {
    for (const [rel, text] of Object.entries(set)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), text)
    }
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  write(commit)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', [...gitArgs, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  write(files)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}
const rulesAt = (result, file) => result.findings.filter(f => f.file === file).map(f => f.rule)

test('security, outdated and debug patterns are blocking and carry a fix', () => {
  const dir = repo({
    'a.py': [
      'import subprocess',
      'subprocess.run(cmd, shell=True)',
      'data = pick' + 'le.loads(blob)',
      'requests.get(url, verify=' + 'False)',
      'when = datetime.utc' + 'now()',
      'break' + 'point()',
      '',
    ].join('\n'),
    'b.js': [
      'var count = 1',
      'el.inner' + 'HTML = text',
      'const s = name.sub' + 'str(1)',
      '',
    ].join('\n'),
    'c.c': 'void f(char *d, const char *s) { str' + 'cpy(d, s); }\n',
  })
  const result = lintCheck(dir, { staged: true })
  assert.equal(result.verdict, 'DENY')
  const expected = ['sec-shell', 'sec-deserialize', 'sec-tls-off', 'outdated', 'debug-leftover']
  for (const rule of expected) {
    assert.ok(rulesAt(result, 'a.py').includes(rule), rule)
  }
  assert.ok(rulesAt(result, 'b.js').includes('sec-xss'))
  assert.equal(rulesAt(result, 'b.js').filter(r => r === 'outdated').length, 2)
  assert.ok(rulesAt(result, 'c.c').includes('sec-c-unsafe'))
  for (const f of result.findings) assert.match(f.remark, /^issue \(blocking\): .* Fix: \S/)
})

test('a hardcoded secret and SQL built from a string are caught in any language', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  const query = 'db.execute("SEL' + 'ECT * FROM t WHERE id = " + id)'
  const dir = repo({ 'q.rb': `KEY = "${key}"\n${query}\n` })
  const rules = rulesAt(lintCheck(dir, { staged: true }), 'q.rb')
  assert.ok(rules.includes('sec-secret'))
  assert.ok(rules.includes('sec-sql-concat'))
})

test('a clean change passes', () => {
  const text = 'def area(width, height):\n    return width * height\n\n\nprint(area(2, 3))\n'
  const dir = repo({ 'ok.py': text })
  const result = lintCheck(dir, { staged: true })
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.findings))
})

test('unused functions, variables and imports are found; used and exported ones are not', () => {
  const dir = repo({
    'u.js': [
      "import { readFile, writeFile } from 'node:fs'",
      'function helper() { return 1 }',
      'function lonely() { return 2 }',
      'export function api() { return helper() }',
      'const spare = 3',
      'readFile("x", () => {})',
      '',
    ].join('\n'),
  })
  const unused = lintCheck(dir, { staged: true }).findings.filter(f => f.rule === 'unused-symbol')
  const names = unused.map(f => f.message.split('`')[1]).sort()
  assert.deepEqual(names, ['lonely', 'spare', 'writeFile'])
})

test('size rules report a function only where the change touches it', () => {
  const body = n => Array.from({ length: n }, (_, i) => `  total += ${i % 2}`).join('\n')
  const old = `function oldOne(total) {\n${body(40)}\n  return total\n}\n`
  const added = `export function newOne(total) {\n${body(40)}\n  return total\n}\n`
  const dir = repo({ 's.js': `${old}${added}` }, { commit: { 's.js': old } })
  const sizes = lintCheck(dir, { staged: true }).findings.filter(f => f.rule === 'function-length')
  assert.equal(sizes.length, 1)
  assert.match(sizes[0].message, /^newOne: /)
})

test('comment rules come through the lint gate with their fix', () => {
  const dir = repo({ 'k.ts': '// Increment i by 1\nexport let i = 0\ni++\n' })
  const found = lintCheck(dir, { staged: true }).findings.find(f => f.rule === 'restates-code')
  assert.equal(found.category, 'comments')
  assert.match(found.remark, /Fix: Delete the comment/)
})

test('the project can turn a rule off or exclude a path; unknown rules are refused', () => {
  const text = 'var n = 1\nexport { n }\n'
  const standards = lint => JSON.stringify({ schemaVersion: 1, lint })
  const outdatedOff = standards({ rules: { outdated: 'off' } })
  const off = repo({ '.devops/standards.json': outdatedOff, 'a.js': text })
  assert.ok(!rulesAt(lintCheck(off, { staged: true }), 'a.js').includes('outdated'))
  const excludeVendor = standards({ exclude: ['vendor/**'] })
  const excluded = repo({ '.devops/standards.json': excludeVendor, 'vendor/x/a.js': text })
  assert.deepEqual(rulesAt(lintCheck(excluded, { staged: true }), 'vendor/x/a.js'), [])
  const bad = repo({ '.devops/standards.json': standards({ rules: { 'no-such-rule': 'off' } }) })
  assert.throws(() => loadStandards(bad), /not a known rule/)
})

test('with the Push JSON, every open-source linter must have run and exited 0', () => {
  const dir = repo({ 'm.py': 'print(1)\n' })
  const commands = lintCommands(dir).commands
  assert.ok(commands.some(c => c.tool === 'ruff'))
  assert.ok(commands.some(c => c.tool === 'semgrep'))
  const missing = lintCheck(dir, { staged: true, push: { lint: { tools: [] } } })
  assert.equal(missing.findings.filter(f => f.rule === 'linter-not-run').length, commands.length)
  const tools = commands.map(c => ({ command: c.command, exit: c.tool === 'ruff' ? 1 : 0 }))
  const failed = lintCheck(dir, { staged: true, push: { lint: { tools } } })
  const toolRules = failed.findings.filter(f => f.rule.startsWith('linter-')).map(f => f.rule)
  assert.deepEqual(toolRules, ['linter-failed'])
  const clean = commands.map(c => ({ command: c.command, exit: 0 }))
  const passed = lintCheck(dir, { staged: true, push: { lint: { tools: clean } } })
  assert.equal(passed.verdict, 'PASS')
})

test('every rule is documented, and every pattern reports a known rule', () => {
  const docPath = path.join(ROOT, 'skills/devops-multi-agent-team/references/lint-rules.md')
  const doc = fs.readFileSync(docPath, 'utf8')
  for (const id of Object.keys(RULES)) assert.ok(doc.includes(`| \`${id}\` |`), id)
  for (const p of PATTERNS) assert.ok(RULES[p.rule], p.rule)
})

test('numbers in strings and regexes are not magic numbers; repeated code numbers are', () => {
  const dir = repo({
    'n.js': [
      'export const a = /[0-9]{16}/.test(x)',
      'export const b = /[0-9]{16}/.test(y)',
      "export const c = 'v16' + 'v16'",
      'run(w * 7, h * 7)',
      '',
    ].join('\n'),
  })
  const magic = lintCheck(dir, { staged: true }).findings.filter(f => f.rule === 'magic-number')
  assert.deepEqual(magic.map(f => f.message.split(' ')[0]), ['7'])
})
