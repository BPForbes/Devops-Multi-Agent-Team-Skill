import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { changeSetting, getSetting, parsePath, parseValue } from './devops-config.mjs'
import { loadStandards } from './devops-standards.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'devops-config.mjs')
const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-cfg-')))
const fileOf = dir => path.join(dir, '.devops', 'standards.json')
const readFile = dir => JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'))
const apply = (dir, change) => changeSetting(dir, { ...change, apply: true })

test('paths and values parse the way the commands describe', () => {
  assert.deepEqual(parsePath('defaults.lineLength.code'), ['defaults', 'lineLength', 'code'])
  assert.deepEqual(parsePath('linters.python.options.mccabe\\.max-complexity'),
    ['linters', 'python', 'options', 'mccabe.max-complexity'])
  assert.equal(parseValue('120'), 120)
  assert.deepEqual(parseValue('[0,1,2]'), [0, 1, 2])
  assert.equal(parseValue('vendor/**'), 'vendor/**')
  assert.throws(() => parsePath(''), /path is required/)
})

test('get shows the value in effect and where it comes from, also per language', () => {
  const dir = project()
  const first = getSetting(dir, { path: 'defaults.lineLength.code' })
  assert.equal(first.source, 'standards.json (default)')
  assert.equal(getSetting(dir, { path: 'defaults.lineLength.code', language: 'python' }).value, 88)
  apply(dir, { op: 'set', path: 'defaults.lineLength.code', value: 120 })
  const got = getSetting(dir, { path: 'defaults.lineLength.code' })
  assert.deepEqual([got.value, got.source], [120, '.devops/standards.json'])
  assert.throws(() => getSetting(dir, { path: 'defaults.noSuchThing' }), /no setting/)
})

test('set plans unless applied, and the project file keeps only what changed', () => {
  const dir = project()
  const plan = changeSetting(dir, { op: 'set', path: 'defaults.function.maxLines', value: '40' })
  assert.deepEqual([plan.was, plan.now, plan.written], [30, 40, false])
  assert.ok(!fs.existsSync(fileOf(dir)))
  apply(dir, { op: 'set', path: 'defaults.function.maxLines', value: '40' })
  assert.deepEqual(readFile(dir), { schemaVersion: 1, defaults: { function: { maxLines: 40 } } })
  const { maxNesting } = loadStandards(dir).defaults.function
  assert.equal(maxNesting, 3, 'other values keep their default')
  apply(dir, { op: 'unset', path: 'defaults.function.maxLines' })
  assert.deepEqual(readFile(dir), { schemaVersion: 1 }, 'unset goes back to the default')
})

test('add and remove change a list, starting from the list in effect', () => {
  const dir = project()
  apply(dir, { op: 'add', path: 'defaults.magicLiterals.allowed', value: '100' })
  assert.deepEqual(loadStandards(dir).defaults.magicLiterals.allowed, [0, 1, 2, 100])
  apply(dir, { op: 'add', path: 'defaults.magicLiterals.allowed', value: '100' })
  const allowed = loadStandards(dir).defaults.magicLiterals.allowed
  assert.deepEqual(allowed, [0, 1, 2, 100], 'no duplicate')
  apply(dir, { op: 'remove', path: 'defaults.magicLiterals.allowed', value: '2' })
  assert.deepEqual(loadStandards(dir).defaults.magicLiterals.allowed, [0, 1, 100])
  apply(dir, { op: 'add', path: 'lint.exclude', value: 'vendor/**' })
  assert.deepEqual(loadStandards(dir).lint.exclude, ['vendor/**'])
})

test('a change inside a list entry copies the whole list, and one linter option can change', () => {
  const dir = project()
  apply(dir, { op: 'set', path: 'linters.all.0.command', value: 'semgrep scan --config auto' })
  const all = loadStandards(dir).linters.all
  assert.equal(all.length, 3)
  assert.equal(all[0].command, 'semgrep scan --config auto')
  apply(dir, { op: 'set', path: 'linters.python.options.mccabe\\.max-complexity', value: 8 })
  const python = loadStandards(dir).linters.python
  assert.deepEqual([python.tool, python.options['mccabe.max-complexity']], ['ruff', 8])
})

test('a value the validator rejects is never written', () => {
  const dir = project()
  apply(dir, { op: 'set', path: 'defaults.lineLength.code', value: 120 })
  for (const change of [
    { op: 'set', path: 'defaults.lineLength.code', value: 0 },
    { op: 'set', path: 'defaults.lineLenth.code', value: 90 },
    { op: 'set', path: 'lint.rules.no-such-rule', value: 'off' },
    { op: 'set', path: 'lint.rules.sec-eval', value: 'maybe' },
    { op: 'set', path: 'defaults.comments.densityBlock', value: 0.1 },
  ]) {
    const result = apply(dir, change)
    assert.equal(result.written, false, change.path)
    assert.ok(result.problems.length > 0, change.path)
  }
  assert.deepEqual(readFile(dir), { schemaVersion: 1, defaults: { lineLength: { code: 120 } } })
  const version = { op: 'set', path: 'schemaVersion', value: 2 }
  assert.throws(() => apply(dir, version), /cannot be changed/)
  assert.throws(() => apply(dir, { op: 'rename', path: 'a', value: 1 }), /op must be one of/)
})

test('the command line reads, writes, dry-runs and turns rules off', () => {
  const dir = project()
  const run = (...args) => execFileSync('node', [CLI, ...args, '--dest', dir], { encoding: 'utf8' })
  assert.match(run('get', 'defaults.lineLength.comment'), /^80\n\(standards\.json \(default\)\)/)
  assert.match(run('set', 'defaults.lineLength.code', '120', '--dry-run'), /dry run/)
  assert.ok(!fs.existsSync(fileOf(dir)))
  assert.match(run('rule', 'sec-insecure-url', 'off'), /-> "off", written/)
  assert.equal(readFile(dir).lint.rules['sec-insecure-url'], 'off')
  const refused = () => run('set', 'defaults.lineLength.code', '-1')
  const isRefusal = error => error.status === 1 && /refused, nothing written/.test(error.stdout)
  assert.throws(refused, isRefusal)
})

test('prototype keys and a set with no value are refused before anything changes', () => {
  const dir = project()
  assert.throws(() => changeSetting(dir, { op: 'set', path: '__proto__.apply', value: true }),
    /not a setting name/)
  assert.equal({}.apply, undefined)
  apply(dir, { op: 'add', path: 'lint.exclude', value: 'vendor/**' })
  assert.throws(() => apply(dir, { op: 'set', path: 'lint.exclude' }), /needs a value/)
  assert.deepEqual(readFile(dir).lint.exclude, ['vendor/**'])
})

test('a language override is named as the source over a general project value', () => {
  const dir = project()
  apply(dir, { op: 'set', path: 'defaults.lineLength.code', value: 120 })
  const python = getSetting(dir, { path: 'defaults.lineLength.code', language: 'python' })
  assert.equal(python.value, 88)
  assert.equal(python.source, 'standards.json (default) (languages.python)')
  const go = getSetting(dir, { path: 'defaults.lineLength.code', language: 'go' })
  assert.deepEqual([go.value, go.source], [120, '.devops/standards.json'])
})
