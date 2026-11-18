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
  assert.ok(auditDiff('', loadLanguages(dir), { syntaxFor: () => undefined }).findings.length === 0)
})

test('a comment that narrates the implementation step by step fails the gate, and a design-choice comment passes', () => {
  const dir = repo({
    'src/n.ts': [
      '// First we read the header, then we parse it.',
      'const h = read()',
      '// Step 2: build the map.',
      'const m = build(h)',
      '// Parsing is delegated to net/header so retry limits stay in one place.',
      'const p = parseHeader(h)',
      '',
    ].join('\n'),
  })
  const result = commentAudit(dir, { staged: true })
  const at = line => result.findings.filter(f => f.line === line).map(f => f.rule)
  assert.ok(at(1).includes('narrates-code'))
  assert.ok(result.findings.find(f => f.line === 1 && f.rule === 'narrates-code').blocking)
  assert.ok(at(3).includes('narrates-code'))
  assert.deepEqual(at(5), [])
})

test('concept or usage text blocks in a source file and is only a suggestion in an interface file', () => {
  const text = '# Architecture: the queue feeds the workers, which write to the store.\nrun()\n'
  const dir = repo({ 'src/s.py': text, 'src/t.pyi': text })
  const found = commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'docs-candidate')
  assert.equal(found.find(f => f.file === 'src/s.py').blocking, true)
  assert.equal(found.find(f => f.file === 'src/t.pyi').blocking, false)
})

test('interface files allow more comment density, but not unlimited', () => {
  const comment = i => `// Callers must hold the queue lock before slot ${i} is used.`
  const body = n => [...Array.from({ length: n }, (_, i) => comment(i)), 'int run(void);', 'int stop(void);', 'int size(void);', ''].join('\n')
  const dir = repo({ 'q.h': body(6), 'q.cpp': body(6), 'z.h': body(12) })
  const density = commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'density')
  assert.equal(density.find(f => f.file === 'q.cpp').blocking, true)
  assert.equal(density.find(f => f.file === 'q.h').blocking, false)
  assert.equal(density.find(f => f.file === 'z.h').blocking, true)
})

test('a source comment that repeats its interface comment is flagged, also when the header is already committed', () => {
  const header = '// Retries the send twice because the broker drops the first frame after reconnect.\nint send_frame(int fd);\n'
  const source = '#include "net.h"\n// Retries the send twice because the broker drops the first frame after reconnect.\nint send_frame(int fd) { return fd; }\n'
  const together = repo({ 'net.h': header, 'net.c': source })
  assert.deepEqual(commentAudit(together, { staged: true }).findings.filter(f => f.rule === 'repeats-interface').map(f => f.file), ['net.c'])
  const later = repo({ 'net.h': header })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'h'], { cwd: later })
  fs.writeFileSync(path.join(later, 'net.c'), source)
  execFileSync('git', ['add', '-A'], { cwd: later })
  assert.ok(rules(commentAudit(later, { staged: true })).includes('repeats-interface'))
})

test('a new doc file blocks unless the docs row names the new system', () => {
  const dir = repo({ 'docs/queue.md': '# Queue\n\nWorkers pull from one queue.\n' })
  assert.ok(rules(commentAudit(dir, { staged: true })).includes('new-doc'))
  const named = commentAudit(dir, { staged: true, docs: [{ file: 'docs/queue.md', section: 'Queue', from: null, why: 'new queue system', new: 'job queue' }] })
  assert.ok(!rules(named).includes('new-doc'))
})

test('language style-guide checks: marker spacing, PEP 8 inline gap, Go doc names, Rust SAFETY, TS JSDoc types, C# and Terraform', () => {
  const dir = repo({
    'a.py': 'x = 1 # Offset because the API counts from one.\n#Tight comment here.\ny = 2\n',
    'b.go': 'package b\n\n// Parses the frame header because callers pass raw bytes.\nfunc Parse() {}\n',
    'c.rs': 'fn f(p: *const u8) -> u8 {\n    unsafe { *p }\n}\n',
    'd.ts': '/** @param {string} id The order number from the billing system. */\nexport function load(id: string) {}\n',
    'e.cs': 'var n = 1; // Starts at one because the ledger is one-based.\n',
    'f.tf': '// Pinned because 5.x renames the bucket argument.\nresource "x" "y" {}\n',
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
  const good = repo({ 'g.go': 'package g\n\n// Parse reads the header because callers pass raw bytes.\nfunc Parse() {}\n', 'h.rs': 'fn f(p: *const u8) -> u8 {\n    // SAFETY: callers pass a pointer from a live slice.\n    unsafe { *p }\n}\n' })
  assert.deepEqual(commentAudit(good, { staged: true }).findings.map(f => f.rule), [])
})

test('doc lines are counted, and with a Push JSON docs list an unlisted doc change is reported', () => {
  const dir = repo({ 'docs/retry.md': '# Retry\n\nThe client retries twice.\n', 'README.md': 'Intro.\n', 'a.ts': 'const x = 1\n' })
  const plain = commentAudit(dir, { staged: true })
  assert.equal(plain.docLinesAdded, 3)
  assert.ok(!rules(plain).includes('unlisted-doc'), 'no list given: doc budget check skipped')
  assert.ok(rules(plain).includes('new-doc'), 'new doc files are refused unless a new system is named')
  const listed = commentAudit(dir, { staged: true, docs: [{ file: 'docs/retry.md', section: 'Retry', from: null, why: 'shared by every client' }] })
  assert.deepEqual(listed.findings.filter(f => f.rule === 'unlisted-doc').map(f => f.file), ['README.md'])
})

test('narratives are blocked in comments and in docs', () => {
  const dir = repo({ 'a.ts': '// Originally we tried a map, but it turned out to be slow.\nconst x = 1\n', 'README.md': 'Intro.\n\nAfter much debate we decided to use one queue.\n' })
  const found = commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'narrative')
  assert.deepEqual(found.map(f => `${f.file}:${f.line}`).sort(), ['README.md:3', 'a.ts:1'])
  const quoted = repo({ 'b.md': 'No story ("originally", "we tried").\n' })
  assert.ok(!rules(commentAudit(quoted, { staged: true })).includes('narrative'), 'quoted examples are not narratives')
  assert.ok(found.every(f => f.blocking))
})

test('a C++ source and its .h interface share one check, and a SAFETY comment above an unchanged line counts', () => {
  const header = '// Retries the send twice because the broker drops the first frame after reconnect.\nint send_frame(int fd);\n'
  const source = '#include "net.h"\n// Retries the send twice because the broker drops the first frame after reconnect.\nint send_frame(int fd) { return fd; }\n'
  const dir = repo({ 'net.h': header, 'net.cpp': source })
  assert.deepEqual(commentAudit(dir, { staged: true }).findings.filter(f => f.rule === 'repeats-interface').map(f => f.file), ['net.cpp'])

  const rust = repo({ 'r.rs': 'fn f(p: *const u8) -> u8 {\n    // SAFETY: callers pass a pointer from a live slice.\n    unsafe { *p }\n}\n' })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'r'], { cwd: rust })
  fs.writeFileSync(path.join(rust, 'r.rs'), 'fn f(p: *const u8) -> u8 {\n    // SAFETY: callers pass a pointer from a live slice.\n    unsafe { *p.add(0) }\n}\n')
  execFileSync('git', ['add', '-A'], { cwd: rust })
  assert.ok(!rules(commentAudit(rust, { staged: true })).includes('rust-safety'))
})
