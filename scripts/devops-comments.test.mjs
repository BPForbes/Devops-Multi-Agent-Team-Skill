import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  auditDiff, blockInterior, commentAudit, parseAdded, syntaxTable,
} from './devops-comments.mjs'
import { loadStandards } from './devops-standards.mjs'

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

test('prose that ends in a semicolon is not commented-out code', () => {
  const dir = repo({ 'a.ts': '// It runs only fixed lists (no shell, bare environment;\n// the second line of the same sentence goes on.\nconst x = 1\n// y = compute(x);\n' })
  const result = commentAudit(dir, { staged: true })
  assert.deepEqual(result.findings.filter(f => f.rule === 'commented-out-code').map(f => f.line), [4])
})

test('a directory named .claude is not a mention of an AI tool', () => {
  const dir = repo({ 'a.ts': '// Writes only to .claude/ and .cursor/ because the host reads them.\nconst x = 1\n' })
  assert.deepEqual(commentAudit(dir, { staged: true }).findings.map(f => f.rule), [])
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
  assert.ok(auditDiff('', loadStandards(dir), { syntaxFor: () => undefined }).findings.length === 0)
})

const WHO = ['-c', 'user.name=t', '-c', 'user.email=t@t']
const commitAll = (dir, message) => {
  execFileSync('git', [...WHO, 'commit', '-q', '-m', message], { cwd: dir })
}
const lines = (...rows) => `${rows.join('\n')}\n`
const filesWith = (result, rule) => result.findings.filter(f => f.rule === rule).map(f => f.file)
const RETRY_NOTE = '// Retries the send twice because the broker drops the first frame after '
  + 'reconnect.'
const HEADER = lines(RETRY_NOTE, 'int send_frame(int fd);')
const SOURCE = lines('#include "net.h"', RETRY_NOTE, 'int send_frame(int fd) { return fd; }')
const SAFE_RUST = lines(
  'fn f(p: *const u8) -> u8 {',
  '    // SAFETY: callers pass a pointer from a live slice.',
  '    unsafe { *p }',
  '}',
)

test('narrating the implementation fails the gate; naming the design choice passes', () => {
  const dir = repo({
    'src/n.ts': lines(
      '// First we read the header, then we parse it.',
      'const h = read()',
      '// Step 2: build the map.',
      'const m = build(h)',
      '// Parsing is delegated to net/header so retry limits stay in one place.',
      'const p = parseHeader(h)',
    ),
  })
  const result = commentAudit(dir, { staged: true })
  const at = line => result.findings.filter(f => f.line === line).map(f => f.rule)
  assert.ok(at(1).includes('narrates-code'))
  assert.ok(result.findings.find(f => f.line === 1 && f.rule === 'narrates-code').blocking)
  assert.ok(at(3).includes('narrates-code'))
  assert.deepEqual(at(5), [])
})

test('concept text blocks in a source file and is only a suggestion in an interface file', () => {
  const concept = '# Architecture: the queue feeds the workers, which write to the store.'
  const text = lines(concept, 'run()')
  const dir = repo({ 'src/s.py': text, 'src/t.pyi': text })
  const found = commentAudit(dir, { staged: true }).findings
    .filter(f => f.rule === 'docs-candidate')
  assert.equal(found.find(f => f.file === 'src/s.py').blocking, true)
  assert.equal(found.find(f => f.file === 'src/t.pyi').blocking, false)
})

test('interface files allow more comment density, but not unlimited', () => {
  const comment = i => `// Callers must hold the queue lock before slot ${i} is used.`
  const code = ['int run(void);', 'int stop(void);', 'int size(void);']
  const body = n => lines(...Array.from({ length: n }, (_, i) => comment(i)), ...code)
  const dir = repo({ 'q.h': body(6), 'q.cpp': body(6), 'z.h': body(12) })
  const density = commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'density')
  assert.equal(density.find(f => f.file === 'q.cpp').blocking, true)
  assert.equal(density.find(f => f.file === 'q.h').blocking, false)
  assert.equal(density.find(f => f.file === 'z.h').blocking, true)
})

test('a source comment repeating its interface is flagged, even if the header is committed', () => {
  const together = repo({ 'net.h': HEADER, 'net.c': SOURCE })
  const both = commentAudit(together, { staged: true })
  assert.deepEqual(filesWith(both, 'repeats-interface'), ['net.c'])
  const later = repo({ 'net.h': HEADER })
  commitAll(later, 'h')
  fs.writeFileSync(path.join(later, 'net.c'), SOURCE)
  execFileSync('git', ['add', '-A'], { cwd: later })
  assert.ok(rules(commentAudit(later, { staged: true })).includes('repeats-interface'))
})

test('a new doc file blocks unless the docs row names the new system', () => {
  const dir = repo({ 'docs/queue.md': lines('# Queue', '', 'Workers pull from one queue.') })
  assert.ok(rules(commentAudit(dir, { staged: true })).includes('new-doc'))
  const row = {
    file: 'docs/queue.md', section: 'Queue', from: null, why: 'new queue system', new: 'job queue',
  }
  const named = commentAudit(dir, { staged: true, docs: [row] })
  assert.ok(!rules(named).includes('new-doc'))
})

test('style checks: marker space, PEP 8, Go docs, Rust SAFETY, JSDoc types, C#, Terraform', () => {
  const dir = repo({
    'a.py': lines('x = 1 # Offset because the API counts from one.', '#Tight comment.', 'y = 2'),
    'b.go': lines('package b', '', '// Parses the frame because callers pass raw bytes.',
      'func Parse() {}'),
    'c.rs': lines('fn f(p: *const u8) -> u8 {', '    unsafe { *p }', '}'),
    'd.ts': lines(
      '/** @param {string} id The order number from the billing system. */',
      'export function load(id: string) {}',
    ),
    'e.cs': lines('var n = 1; // Starts at one because the ledger is one-based.'),
    'f.tf': lines('// Pinned because 5.x renames the bucket argument.', 'resource "x" "y" {}'),
  })
  const found = commentAudit(dir, { staged: true }).findings
  const has = (file, rule) => found.some(f => f.file === file && f.rule === rule && f.blocking)
  assert.ok(has('a.py', 'inline-gap'))
  assert.ok(has('a.py', 'marker-space'))
  assert.ok(has('b.go', 'go-doc-name'))
  assert.ok(has('c.rs', 'rust-safety'))
  assert.ok(has('d.ts', 'jsdoc-types'))
  assert.ok(has('e.cs', 'trailing'))
  assert.ok(has('f.tf', 'hash-only'))
  const goDoc = lines('package g', '', '// Parse reads the frame because callers pass raw bytes.',
    'func Parse() {}')
  const good = repo({ 'g.go': goDoc, 'h.rs': SAFE_RUST })
  assert.deepEqual(commentAudit(good, { staged: true }).findings.map(f => f.rule), [])
})

test('doc lines are counted; with a Push JSON docs list an unlisted doc change is reported', () => {
  const retry = lines('# Retry', '', 'The client retries twice.')
  const dir = repo({ 'docs/retry.md': retry, 'README.md': 'Intro.\n', 'a.ts': 'const x = 1\n' })
  const plain = commentAudit(dir, { staged: true })
  assert.equal(plain.docLinesAdded, 3)
  assert.ok(!rules(plain).includes('unlisted-doc'), 'no list given: doc budget check skipped')
  assert.ok(rules(plain).includes('new-doc'), 'a new doc file is refused unless a system is named')
  const row = { file: 'docs/retry.md', section: 'Retry', from: null, why: 'shared by every client' }
  const listed = commentAudit(dir, { staged: true, docs: [row] })
  assert.deepEqual(filesWith(listed, 'unlisted-doc'), ['README.md'])
})

test('narratives are blocked in comments and in docs', () => {
  const dir = repo({
    'a.ts': lines('// Originally we tried a map, but it turned out to be slow.', 'const x = 1'),
    'README.md': lines('Intro.', '', 'After much debate we decided to use one queue.'),
  })
  const found = commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'narrative')
  assert.deepEqual(found.map(f => `${f.file}:${f.line}`).sort(), ['README.md:3', 'a.ts:1'])
  const quoted = repo({ 'b.md': 'No story ("originally", "we tried").\n' })
  const quotedRules = rules(commentAudit(quoted, { staged: true }))
  assert.ok(!quotedRules.includes('narrative'), 'quoted examples are not narratives')
  assert.ok(found.every(f => f.blocking))
})

test('a C++ source and its .h share one check; SAFETY above an unchanged line counts', () => {
  const dir = repo({ 'net.h': HEADER, 'net.cpp': SOURCE })
  assert.deepEqual(filesWith(commentAudit(dir, { staged: true }), 'repeats-interface'), ['net.cpp'])

  const rust = repo({ 'r.rs': SAFE_RUST })
  commitAll(rust, 'r')
  fs.writeFileSync(path.join(rust, 'r.rs'), SAFE_RUST.replace('*p }', '*p.add(0) }'))
  execFileSync('git', ['add', '-A'], { cwd: rust })
  assert.ok(!rules(commentAudit(rust, { staged: true })).includes('rust-safety'))
})

test('file types a human edits are audited with their language syntax', () => {
  const dir = repo({
    'build.gradle.kts': lines('// Pinned because plugin 2.x drops the task name.', 'plugins {}'),
    'Rakefile': lines('# Runs the suite because CI calls rake by default.', 'task :test'),
    'Containerfile': lines('# Pins the base because 3.x lacks the CA bundle.', 'FROM alpine'),
    'lib/mod.cppm': lines('// Exports the queue because consumers import it.', 'export module q;'),
    'lib/mod.ipp': lines('// Keeps the fast path inline because it runs per packet.',
      'template <class T> void f();'),
    'src/x.pyx': lines('# Releases the GIL because the callback re-enters Python.', 'cdef int f()'),
    'src/x.pxd': lines('# Declares the C type because the .pyx needs it.', 'cdef int f()'),
  })
  const found = commentAudit(dir, { staged: true })
  assert.equal(found.findings.filter(f => f.blocking).length, 0, JSON.stringify(found.findings))
  assert.equal(found.commentLinesAdded, 7)
})

test('a spaced Go assignment after `*` is code; prose after `*` is a comment continuation', () => {
  const long = `* out = ${'value + '.repeat(15)}1`
  const dir = repo({ 'a.go': `package a\n\nfunc f(out *int, value int) {\n\t${long}\n}\n` })
  assert.ok(rules(commentAudit(dir, { staged: true })).includes('long-code-line'))
  const prose = `/*\n * ${'word '.repeat(30)}\n */\n`
  const commented = repo({ 'b.go': `package b\n${prose}` })
  assert.ok(!rules(commentAudit(commented, { staged: true })).includes('long-code-line'))
})

test('a Go pointer assignment is a code row, and `++ x` inside a hunk is an added line', () => {
  const long = `*out = ${'value + '.repeat(15)}1`
  const dir = repo({ 'a.go': `package a\n\nfunc f(out *int, value int) {\n\t${long}\n}\n` })
  assert.ok(rules(commentAudit(dir, { staged: true })).includes('long-code-line'))
  const rows = parseAdded('--- a/a.js\n+++ b/a.js\n@@ -1,0 +1,2 @@\n+++ x\n+y\n')
  assert.deepEqual(rows.map(r => `${r.file}:${r.line}:${r.text}`), ['a.js:1:++ x', 'a.js:2:y'])
})

test('a staged audit reads the staged file, not an unstaged edit', () => {
  const dir = repo({ 'c.rs': 'fn f(p: *const u8) -> u8 {\n\n    unsafe { *p }\n}\n' })
  const unstaged = 'fn f(p: *const u8) -> u8 {\n    // SAFETY: callers pass a live pointer.\n'
    + '    unsafe { *p }\n}\n'
  fs.writeFileSync(path.join(dir, 'c.rs'), unstaged)
  assert.ok(rules(commentAudit(dir, { staged: true })).some(r => /safety/i.test(r)))
})

test('a Go `*` statement is code; a long line inside a block comment is not', () => {
  const statement = `\t* out++ + ${'value + '.repeat(12)}1`
  const code = repo({ 'a.go': `package a\n\nfunc f(out *int, value int) {\n${statement}\n}\n` })
  assert.ok(rules(commentAudit(code, { staged: true })).includes('long-code-line'))
  const prose = ` * ${'word '.repeat(30)}`
  const block = repo({ 'b.go': `package b\n\n/*\n${prose}\n*/\nfunc g() {}\n` })
  assert.ok(!rules(commentAudit(block, { staged: true })).includes('long-code-line'))
})

test('a continuation is recognised when its opener is in the file, not the diff', () => {
  const dir = repo({ 'c.go': 'package c\n\n/*\n * short\n*/\nfunc h() {}\n' })
  const who = ['-c', 'user.name=t', '-c', 'user.email=t@t']
  execFileSync('git', [...who, 'commit', '-q', '-m', 'base'], { cwd: dir })
  const long = ` * ${'word '.repeat(30)}`
  fs.writeFileSync(path.join(dir, 'c.go'), `package c\n\n/*\n * short\n${long}\n*/\nfunc h() {}\n`)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  assert.ok(!rules(commentAudit(dir, { staged: true })).includes('long-code-line'))
})

test('a /* inside a string or after a line comment does not open a block', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
  const syntax = syntaxTable(root)('x.go')
  const text = 'func f(out *int) {\n\tprintln("/*")\n\t// see /* here\n\t* out++\n}\n'
  assert.equal(blockInterior(text, syntax).has(4), false)
})
