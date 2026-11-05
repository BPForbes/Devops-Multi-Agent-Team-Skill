import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { formalCheck, scanLeanText, stripLean } from './devops-formal.mjs'

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-formal-'))
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
  return fs.realpathSync(dir)
}

const GOOD = 'theorem t (n : Nat) : n + 0 = n := by simp\n'
const WITH_HOLE = 'theorem t (n : Nat) : n = n + 0 := by\n  sorry\n'

test('comments, nested block comments and strings never count as findings', () => {
  const text = '-- sorry\n/- a /- nested sorry -/ still comment sorry -/\ndef s := "sorry and axiom"\ntheorem t : True := trivial\n'
  assert.equal(stripLean(text).split('\n').length, text.split('\n').length)
  assert.deepEqual(scanLeanText(text), [])
})

test('holes and the places a proof does not cover are reported with their line', () => {
  const kinds = scanLeanText('axiom magic : False\ntheorem a : True := by native_decide\nunsafe def u := 1\n@[extern "c_fn"] def e := 1\npartial def loop (n : Nat) : Nat := loop n\ntheorem b : 1 = 1 := by\n  admit\n')
  assert.deepEqual(kinds.map(k => [k.line, k.kind, k.severity]), [[1, 'axiom', 'hole'], [2, 'native_decide', 'review'], [3, 'unsafe', 'review'], [4, 'extern', 'review'], [5, 'partial', 'review'], [7, 'sorry', 'hole']])
})

test('a scan walks .lean files and skips .lake, node_modules and symlinks', () => {
  const dir = project({ 'src/A.lean': WITH_HOLE, '.lake/packages/x/B.lean': WITH_HOLE, 'node_modules/C.lean': WITH_HOLE, 'notes.md': 'sorry' })
  const result = formalCheck(dir, { roots: [dir] })
  assert.equal(result.files, 1)
  assert.equal(result.holes, 1)
  assert.equal(result.findings[0].file, path.join('src', 'A.lean'))
  assert.equal(result.ok, true)
  assert.throws(() => formalCheck(dir, { paths: ['../x'], roots: [dir] }), /outside the project|no such path/)
})

test('Push JSON formal rows are validated against the files and the holes', () => {
  const row = (extra = {}) => ({ id: 'F1', claim: 'old and new agree', status: 'proved', lean: 'devops-skill/thoughts/non-final/formal-c1/f1.lean', writeup: 'devops-skill/thoughts/non-final/formal-c1/f1.md', covers: 'src/a.ts:10', notCovers: 'the TypeScript caller', ...extra })
  const dir = project({
    'devops-skill/thoughts/non-final/formal-c1/f1.lean': GOOD,
    'devops-skill/thoughts/non-final/formal-c1/f1.md': '# F1\n',
    'devops-skill/thoughts/non-final/formal-c1/f2.lean': WITH_HOLE,
    'push.json': JSON.stringify({ topic: 't', formal: [row()] }),
    'push-hole.json': JSON.stringify({ topic: 't', formal: [row({ lean: 'devops-skill/thoughts/non-final/formal-c1/f2.lean' })] }),
    'push-bad.json': JSON.stringify({ topic: 't', formal: [row({ status: 'done', covers: 'somewhere', notCovers: '', writeup: 'missing.md' }), row({ id: 'F2', status: 'disproved' })] }),
    'push-escape.json': JSON.stringify({ topic: 't', formal: [row({ lean: '../outside.lean' })] }),
    'push-gaveup.json': JSON.stringify({ topic: 't', formal: [row({ status: 'gave-up', lean: 'devops-skill/thoughts/non-final/formal-c1/f2.lean' }), row({ id: 'F2', status: 'not-attempted', lean: undefined, writeup: undefined })] }),
  })
  const check = push => formalCheck(dir, { paths: ['devops-skill'], push, roots: [dir] })
  assert.equal(check('push.json').ok, true)
  assert.deepEqual(check('push.json').records, [{ id: 'F1', status: 'proved', lean: path.join('devops-skill/thoughts/non-final/formal-c1/f1.lean') }])
  assert.match(check('push-hole.json').problems.join('\n'), /marked proved but .*f2\.lean has sorry at line 2/)
  const bad = check('push-bad.json').problems.join('\n')
  for (const part of ['status must be one of', 'covers must name', 'notCovers must say', 'writeup not found', 'counterexampleTest']) assert.match(bad, new RegExp(part))
  assert.match(check('push-escape.json').problems.join('\n'), /lean file not found inside the project/)
  assert.equal(check('push-gaveup.json').ok, true)
  assert.match(check('nope.json').problems.join('\n'), /push file not found/)
  assert.equal(check('push.json').files, 2)
})
