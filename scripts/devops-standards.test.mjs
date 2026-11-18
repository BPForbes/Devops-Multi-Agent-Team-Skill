import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commentAudit } from './devops-comments.mjs'
import { cleanupLimits, commentLimits, loadStandards, standardsFor, validateStandards } from './devops-standards.mjs'

function project(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-std-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}

test('the package defaults load with no project file', () => {
  const standards = loadStandards(project())
  assert.equal(standards.defaults.lineLength.comment, 80)
  assert.equal(standards.defaults.function.maxLines, 30)
})

test('a project file overrides only the keys it sets', () => {
  const dir = project({ '.devops/standards.json': JSON.stringify({ schemaVersion: 1, defaults: { function: { maxLines: 12 } } }) })
  const s = loadStandards(dir)
  assert.equal(standardsFor(s, 'typescript').function.maxLines, 12)
  assert.equal(standardsFor(s, 'typescript').function.maxNesting, 3)
})

test('per-language overrides apply to that language only', () => {
  const s = loadStandards(project())
  assert.equal(standardsFor(s, 'python').lineLength.code, 88)
  assert.equal(standardsFor(s, 'typescript').lineLength.code, 100)
  assert.equal(cleanupLimits(s, 'python').maxFunctionLines, 40)
  assert.equal(cleanupLimits(s, 'go').maxFunctionLines, 50)
  assert.equal(cleanupLimits(s, 'typescript', { maxFunctionLines: 7 }).maxFunctionLines, 7, 'an explicit threshold wins')
  assert.equal(commentLimits(s, 'c', { isInterface: true }).longBlockLines, 12)
})

test('a typo, a bad value or a bad ratio in the project file stops loading', () => {
  assert.throws(() => loadStandards(project({ '.devops/standards.json': '{"schemaVersion":1,"defaults":{"function":{"maxLine":12}}}' })), /not a known setting/)
  assert.throws(() => loadStandards(project({ '.devops/standards.json': '{"schemaVersion":1,"function":{"maxLines":12}}' })), /not a known top-level key/)
  assert.throws(() => loadStandards(project({ '.devops/standards.json': '{"schemaVersion":1,"defaults":{"function":{"maxLines":0}}}' })), /whole number of at least 1/)
  assert.throws(() => loadStandards(project({ '.devops/standards.json': '{"schemaVersion":1,"defaults":{"comments":{"densityWarn":2}}}' })), /above 0 and at most 1/)
  assert.throws(() => loadStandards(project({ '.devops/standards.json': '{"schemaVersion":1,"languages":{"cobolx":{"function":{"maxLines":9}}}}' })), /unknown language id/)
  assert.throws(() => loadStandards(project({ '.devops/standards.json': '{ not json' })), /not valid JSON/)
})

test('a density block below its warning is refused', () => {
  const s = loadStandards(project())
  s.defaults.comments.densityBlock = 0.1
  assert.ok(validateStandards(s, { languageIds: ['python'] }).some(p => /densityBlock/.test(p)))
})

test('linter settings need a tool name and option values of a simple type', () => {
  const s = loadStandards(project())
  s.linters.python = { options: {} }
  assert.ok(validateStandards(s, { languageIds: ['python'] }).some(p => /tool must be a name/.test(p)))
})

test('the code line limit is per language and applies to added lines only', () => {
  const long = 'x = "' + 'a'.repeat(90) + '"'
  const dir = project({ 'a.py': `y = 1\n${long}\n`, 'b.ts': `const z = 1\nconst w = "${'b'.repeat(80)}"\n` })
  const result = commentAudit(dir, { staged: true })
  const flagged = result.findings.filter(f => f.rule === 'long-code-line')
  assert.deepEqual(flagged.map(f => f.file), ['a.py'], 'python is limited to 88; the TypeScript line is under 100')
  assert.equal(flagged[0].line, 2)
  assert.equal(flagged[0].blocking, true)
})
