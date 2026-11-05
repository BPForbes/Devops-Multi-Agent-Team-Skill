import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { auditDiff, commentAudit, parseAdded } from './devops-comments.mjs'
import { loadLanguages } from './devops-setup.mjs'

function repo(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-cm-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}
const rules = result => result.findings.map(f => f.rule)

test('parseAdded reads file names and new line numbers from a unified diff', () => {
  const rows = parseAdded('diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,0 +5,2 @@\n+a\n+b\n@@ -9 +20 @@\n-old\n+new\n')
  assert.deepEqual(rows.map(r => `${r.file}:${r.line}:${r.text}`), ['x.ts:5:a', 'x.ts:6:b', 'x.ts:20:new'])
})

test('the audit flags restating, commented-out code, questions, process notes, bare markers and signature-only docs', () => {
  const dir = repo({
    'src/a.ts': [
      '// Increment i by 1',
      'i++',
      '// const x = foo(bar);',
      '// Why does this retry? Not sure.',
      '// TODO fix later',
      '/** @param name the name */',
      'function f(name) { return 1 }',
      '// Retry once because the driver returns EBUSY after resume (see #123).',
      'const delay = 5',
      '// reviewer: please check this',
      '',
    ].join('\n'),
  })
  const result = commentAudit(dir, { staged: true })
  const at = line => result.findings.filter(f => f.line === line).map(f => f.rule)
  assert.ok(at(1).includes('restates-code'))
  assert.ok(at(3).includes('commented-out-code'))
  assert.ok(at(4).includes('question'))
  assert.ok(at(5).includes('marker'))
  assert.ok(at(6).includes('doc-repeats-signature'))
  assert.deepEqual(at(8), [], 'a reason, a constraint and an issue reference earn the comment')
  assert.ok(at(10).includes('process-note') && at(10).includes('question'))
  assert.ok(result.blocking >= 5)
  assert.match(result.findings.find(f => f.line === 1).remark, /^issue \(blocking\): /)
})

test('directives, shebangs, preprocessor lines and license headers are not comments', () => {
  const dir = repo({
    'run.sh': '#!/usr/bin/env bash\n# shellcheck disable=SC2086\necho hi\n',
    'x.c': '#include <stdio.h>\n#define N 1\n// Copyright (c) 2026 Someone\nint main(void) { return 0; }\n',
    'b.py': '# -*- coding: utf-8 -*-\n# type: ignore\nx = 1\n',
  })
  assert.equal(commentAudit(dir, { staged: true }).findings.length, 0)
})

test('Python docstrings are documentation, and a docstring that repeats the signature is flagged', () => {
  const dir = repo({ 'm.py': 'def add(a, b):\n    """Return the sum of a and b because callers need an int."""\n    return a + b\n\n\ndef mul(a, b):\n    """\n    :param a: the a\n    """\n    return a * b\n' })
  const result = commentAudit(dir, { staged: true })
  assert.ok(rules(result).includes('doc-repeats-signature'))
  assert.ok(!result.findings.some(f => f.line === 2))
})

test('a file that is mostly comments is over-commented, and long prose is reported', () => {
  const lines = []
  for (let i = 0; i < 8; i++) lines.push(`// Explanation number ${i} about the next statement.`)
  lines.push('run()')
  const dir = repo({ 'src/loud.js': lines.join('\n') + '\n' })
  const result = commentAudit(dir, { staged: true })
  assert.ok(rules(result).includes('density'))
  assert.ok(result.findings.find(f => f.rule === 'density').blocking)
  assert.ok(rules(result).includes('long-prose'))
})

test('with a Push JSON comments list, an unlisted comment is blocking and a listed one is not', () => {
  const dir = repo({ 'src/a.rs': '// Retry because the NIC drops the first frame after resume.\nfn go() {}\n// Cache the parse because it is called per packet.\nfn two() {}\n' })
  const unlisted = commentAudit(dir, { staged: true, listed: [{ file: 'src/a.rs', line: '1', why: 'hardware quirk' }] })
  const flagged = unlisted.findings.filter(f => f.rule === 'unlisted')
  assert.deepEqual(flagged.map(f => f.line), [3])
  assert.equal(commentAudit(dir, { staged: true, listed: [{ file: 'src/a.rs', line: '1' }, { file: 'src/a.rs', line: '3-3' }] }).findings.filter(f => f.rule === 'unlisted').length, 0)
  assert.equal(commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'unlisted').length, 0, 'no list given: budget check skipped')
})

test('a commit range is audited, and a bad ref is refused', () => {
  const dir = repo({ 'a.go': 'package a\n' })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'a.go'), 'package a\n// Set x to 1\nvar x = 1\n')
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'two'], { cwd: dir })
  const result = commentAudit(dir, { base: 'HEAD~1', head: 'HEAD' })
  assert.ok(rules(result).includes('restates-code'))
  assert.throws(() => commentAudit(dir, { base: '--upload-pack=x' }), /plain ref/)
  assert.ok(auditDiff('', loadLanguages(dir), { syntaxFor: () => undefined }).findings.length === 0)
})
