import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commentAudit } from './devops-comments.mjs'
import {
  cleanupLimits, commentLimits, loadStandards, standardsFor, validateStandards,
} from './devops-standards.mjs'

const WHO = ['-c', 'user.name=t', '-c', 'user.email=t@t']
const STANDARDS = '.devops/standards.json'

function project(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-std-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', [...WHO, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}

const withStandards = value => {
  const text = JSON.stringify({ schemaVersion: 1, ...value })
  return project({ [STANDARDS]: text })
}

test('the package defaults load with no project file', () => {
  const standards = loadStandards(project())
  assert.equal(standards.defaults.lineLength.comment, 80)
  assert.equal(standards.defaults.function.maxLines, 30)
})

test('a project file overrides only the keys it sets', () => {
  const s = loadStandards(withStandards({ defaults: { function: { maxLines: 12 } } }))
  assert.equal(standardsFor(s, 'typescript').function.maxLines, 12)
  assert.equal(standardsFor(s, 'typescript').function.maxNesting, 3)
})

test('per-language overrides apply to that language only', () => {
  const s = loadStandards(project())
  assert.equal(standardsFor(s, 'python').lineLength.code, 88)
  assert.equal(standardsFor(s, 'typescript').lineLength.code, 100)
  assert.equal(cleanupLimits(s, 'python').maxFunctionLines, 40)
  assert.equal(cleanupLimits(s, 'go').maxFunctionLines, 50)
  const explicit = cleanupLimits(s, 'typescript', { maxFunctionLines: 7 })
  assert.equal(explicit.maxFunctionLines, 7, 'an explicit threshold wins')
  assert.equal(commentLimits(s, 'c', { isInterface: true }).longBlockLines, 12)
})

test('a typo, a bad value or a bad ratio in the project file stops loading', () => {
  const refuses = (value, reason) => {
    assert.throws(() => loadStandards(withStandards(value)), reason)
  }
  refuses({ defaults: { function: { maxLine: 12 } } }, /not a known setting/)
  refuses({ function: { maxLines: 12 } }, /not a known top-level key/)
  refuses({ defaults: { function: { maxLines: 0 } } }, /whole number of at least 1/)
  refuses({ defaults: { comments: { densityWarn: 2 } } }, /above 0 and at most 1/)
  refuses({ languages: { cobolx: { function: { maxLines: 9 } } } }, /unknown language id/)
  assert.throws(() => loadStandards(project({ [STANDARDS]: '{ not json' })), /not valid JSON/)
})

const problemsIn = s => validateStandards(s, { languageIds: ['python'] })

test('a density block below its warning is refused', () => {
  const s = loadStandards(project())
  s.defaults.comments.densityBlock = 0.1
  assert.ok(problemsIn(s).some(p => /densityBlock/.test(p)))
})

test('linter settings need a tool name and option values of a simple type', () => {
  const s = loadStandards(project())
  s.linters.python = { options: {} }
  assert.ok(problemsIn(s).some(p => /tool must be a name/.test(p)))
})

test('the code line limit is per language and applies to added lines only', () => {
  const long = `x = "${'a'.repeat(90)}"`
  const typescript = `const z = 1\nconst w = "${'b'.repeat(80)}"\n`
  const dir = project({ 'a.py': `y = 1\n${long}\n`, 'b.ts': typescript })
  const result = commentAudit(dir, { staged: true })
  const flagged = result.findings.filter(f => f.rule === 'long-code-line')
  const why = 'python is limited to 88; the TypeScript line is under 100'
  assert.deepEqual(flagged.map(f => f.file), ['a.py'], why)
  assert.equal(flagged[0].line, 2)
  assert.equal(flagged[0].blocking, true)
})
