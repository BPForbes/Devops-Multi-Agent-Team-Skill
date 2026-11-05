import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseStatement, scanProject, snapshot } from './devops-cleanup.mjs'

function project(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-cl-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

const BLOCK = [
  'const rows = input.filter(r => r.active)',
  'const grouped = new Map()',
  'for (const row of rows) {',
  '  const key = row.team + ":" + row.region',
  '  grouped.set(key, (grouped.get(key) ?? 0) + row.amount)',
  '}',
  'const sorted = [...grouped.entries()].sort((a, b) => b[1] - a[1])',
  'return sorted.slice(0, 10).map(([k, v]) => k + "=" + v)',
]
const longBody = n => Array.from({ length: n }, (_, i) => `  total += compute(${i}, input[${i}])`).join('\n')

test('a plain-English statement becomes goals, scope, thresholds and constraints', () => {
  const dir = project({ 'src/a.js': '', 'vendor/x.js': '', 'tests/t.js': '' })
  const brief = parseStatement('Clean up the comments and remove duplicated code in src. Split functions over 30 lines. Do not touch vendor. Keep the public API.', dir)
  assert.deepEqual(brief.goals.sort(), ['comments', 'duplicates', 'split'])
  assert.deepEqual(brief.scope.paths, ['src'])
  assert.deepEqual(brief.scope.exclude, ['vendor'])
  assert.equal(brief.thresholds.maxFunctionLines, 30)
  assert.ok(brief.constraints.some(c => /Do not touch vendor/.test(c)) && brief.constraints.some(c => /Keep the public API/.test(c)))
  assert.ok(brief.constraints[0].startsWith('Behavior is preserved'))

  const only = parseStatement('just reduce the comments, skip the tests', dir)
  assert.deepEqual(only.goals, ['comments'])
  assert.ok(only.scope.exclude.includes('tests'))

  const vague = parseStatement('tidy this up', dir)
  assert.deepEqual(vague.goals, ['comments', 'duplicates', 'split', 'constants', 'naming'])
  assert.deepEqual(parseStatement('Follow clean code principles in src.', dir).goals.length, 5)
  assert.deepEqual(parseStatement('Replace the magic numbers and give things better names.', dir).goals.sort(), ['constants', 'naming'])
  assert.equal(vague.defaultedGoals, true)
  assert.deepEqual(parseStatement('Remove duplicated code. The colors are ugly.', dir).unrecognized, ['The colors are ugly.'])
  assert.deepEqual(parseStatement('../../etc/passwd and clean up', dir).scope.paths, [])
})

test('the scan finds duplicate blocks, long and deep functions, many parameters and noisy comments', () => {
  const dir = project({
    'src/a.js': `function report(input) {\n${BLOCK.map(l => '  ' + l).join('\n')}\n}\n`,
    'src/b.js': `function summary(input) {\n${BLOCK.map(l => '  ' + l).join('\n')}\n}\n`,
    'src/long.js': `function crunch(input) {\n  let total = 0\n${longBody(75)}\n  return total\n}\nfunction wide(a, b, c, d, e, f, g, h) {\n  return a\n}\nfunction deep(x) {\n  if (x) {\n    if (x) {\n      if (x) {\n        if (x) {\n          if (x) {\n            return 1\n          }\n        }\n      }\n    }\n  }\n}\n`,
    'src/noisy.py': 'x = 1\n# Increment x by 1\nx += 1\n# y = compute(x)\n# Why is this here? Not sure.\ndef long_one():\n' + Array.from({ length: 70 }, (_, i) => `    v${i} = ${i}`).join('\n') + '\n',
    'src/legacy.rb': 'def a\n  1\nend\n',
    'tests/test_a.js': `function reportTest(input) {\n${BLOCK.map(l => '  ' + l).join('\n')}\n}\n`,
  })
  const scan = scanProject(dir, { goals: ['comments', 'duplicates', 'split'] })
  const kinds = scan.candidates.map(c => c.kind)
  assert.ok(kinds.includes('duplicate-code') && kinds.includes('long-function') && kinds.includes('comment-noise'))
  const dup = scan.candidates.find(c => c.kind === 'duplicate-code')
  assert.ok(dup.locations.length >= 2 && dup.lines >= 6)
  assert.ok(dup.locations.some(l => l.file === 'src/a.js') && dup.locations.some(l => l.file === 'src/b.js'))
  const longs = scan.candidates.filter(c => c.kind === 'long-function')
  assert.ok(longs.some(c => c.name === 'crunch' && /code lines/.test(c.reasons.join())))
  assert.ok(longs.some(c => c.name === 'wide' && /8 parameters/.test(c.reasons.join())))
  assert.ok(longs.some(c => c.name === 'deep' && /nesting/.test(c.reasons.join())))
  assert.ok(longs.some(c => c.name === 'long_one' && c.file === 'src/noisy.py'))
  const noise = scan.candidates.find(c => c.kind === 'comment-noise' && c.file === 'src/noisy.py')
  assert.ok(noise.blocking >= 3)
  assert.equal(scan.unsupportedLanguages.ruby, 1)
  assert.ok(scan.summary.duplicateGroups >= 1 && scan.summary.longFunctions >= 2)

  const noTests = scanProject(dir, { goals: ['duplicates'], exclude: ['tests'] })
  assert.ok(noTests.candidates.every(c => !(c.locations ?? []).some(l => l.file.startsWith('tests/'))))
  const scoped = scanProject(dir, { goals: ['split'], paths: ['src/long.js'] })
  assert.ok(scoped.candidates.every(c => c.file === 'src/long.js'))
})

test('goals limit what is scanned, and comments worth keeping are not reported', () => {
  const dir = project({
    'src/ok.js': '// Retry once because the driver returns EBUSY after resume (see #123).\nconst delay = 5\n',
    'src/dup1.js': BLOCK.join('\n') + '\n', 'src/dup2.js': BLOCK.join('\n') + '\n',
  })
  assert.ok(scanProject(dir, { goals: ['comments'] }).candidates.every(c => c.kind !== 'duplicate-code'))
  assert.equal(scanProject(dir, { goals: ['comments'] }).candidates.filter(c => c.kind === 'comment-noise').length, 0)
  assert.ok(scanProject(dir, { goals: ['duplicates'] }).candidates.some(c => c.kind === 'duplicate-code'))
})

test('a saved scan can be compared after the cleanup, and a worse result is called out', () => {
  const dir = project({ 'src/a.js': BLOCK.join('\n') + '\n', 'src/b.js': BLOCK.join('\n') + '\n' })
  const before = scanProject(dir, { goals: ['duplicates'] })
  assert.ok(before.summary.duplicateGroups >= 1)
  assert.match(snapshot(dir, 'first', before, { save: true }).saved, /devops-skill\/thoughts\/non-final\/cleanup-first\.json$/)
  fs.writeFileSync(path.join(dir, 'src/b.js'), "import { block } from './a.js'\nblock()\n")
  const after = scanProject(dir, { goals: ['duplicates'] })
  const compared = snapshot(dir, 'first', after)
  assert.equal(compared.improved, true)
  assert.ok(compared.delta.duplicatedLines.change < 0)
  fs.writeFileSync(path.join(dir, 'src/c.js'), BLOCK.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'src/d.js'), BLOCK.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'src/b.js'), BLOCK.join('\n') + '\n')
  assert.ok(snapshot(dir, 'first', scanProject(dir, { goals: ['duplicates'] })).worse.includes('duplicatedLines'))
  assert.throws(() => snapshot(dir, '../evil', before, { save: true }), /snapshot name/)
})

test('the scan finds magic numbers, vague names and flag arguments, and leaves named constants alone', () => {
  const dir = project({
    'src/price.js': [
      'const TAX_RATE = 0.2',
      'function total(items, applyDiscount) {',
      '  const data = items.map(i => i.price * 1.2)',
      '  let tmp = 0',
      '  for (const x of data) tmp += x',
      '  if (tmp > 500) tmp -= 50',
      '  if (tmp > 500) tmp -= 50',
      '  return tmp',
      '}',
      'class UserInfo {}',
      '',
    ].join('\n'),
    'src/m.py': 'class Box:\n    def __init__(self):\n        self.m_size = 1\n\ndef run(a, force=True):\n    b = 42 + 42\n    return b\n',
    'tests/t.js': 'const data = 77 + 77\n',
  })
  const scan = scanProject(dir, { goals: ['constants', 'naming', 'split'] })
  const magic = scan.candidates.filter(c => c.kind === 'magic-number')
  assert.ok(magic.some(c => c.literal === '500' && c.count === 2 && c.file === 'src/price.js'))
  assert.ok(magic.some(c => c.literal === '42' && c.file === 'src/m.py'))
  assert.ok(!magic.some(c => c.literal === '0.2'), 'a named constant is the fix, not the problem')
  assert.ok(!magic.some(c => c.file.startsWith('tests/')))
  const names = scan.candidates.filter(c => c.kind === 'vague-name').flatMap(c => c.examples).join('\n')
  for (const want of [/data/, /tmp/, /UserInfo/, /m\.py:\d+ a:/, /m_size/]) assert.match(names, want)
  assert.doesNotMatch(names, /: x /, 'loop names are fine')
  const flags = scan.candidates.filter(c => c.kind === 'flag-argument')
  assert.ok(flags.some(c => c.name === 'total') && flags.some(c => c.name === 'run'))
  assert.ok(scan.summary.magicNumbers >= 2 && scan.summary.vagueNames >= 5 && scan.summary.flagArguments === 2)
})

test('options objects, expression arrows and constants are not reported as flag arguments, functions or vague names', () => {
  const dir = project({ 'src/ok.js': [
    'const PROCESS = /x/',
    'const isAssignment = word => /^[a-z]+=/.test(word)',
    'const fromEnv = (process.env.NAME ?? "").split(",")',
    'function build({ apply = false, force = false }) {',
    '  return [apply, force]',
    '}',
    'function install(target, dryRun) {',
    '  return [target, dryRun]',
    '}',
    '',
  ].join('\n') })
  const scan = scanProject(dir, { goals: ['split', 'naming'] })
  assert.deepEqual(scan.candidates.filter(c => c.kind === 'flag-argument').map(c => c.name), [])
  assert.equal(scan.candidates.filter(c => c.kind === 'vague-name').length, 0)
})
