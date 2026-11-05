import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildGraph, checkStory, emptyCatalog, guidance, linkStories, loadCatalog, newStory, parseStory } from './devops-stories.mjs'
import { install } from './devops-setup.mjs'

const FL22 = `> **Catalog entry FL-22** · project: **FLINSTONE · C** · from \`keyquorum-flinstone-change-catalog.md\`.
> **Re-baselined against \`develop\` e5ceb55.** The premise holds on \`develop\`.

### Dependencies

\`\`\`mermaid
flowchart LR
  THIS --> FL23["FL-23"]
  THIS --> FL24["FL-20 (absorbs FL-24)"]
  THIS --> FL25["FL-25"]
  THIS(["FL-22"])
\`\`\`

| | |
|---|---|
| **Project** | **Bailey-Forbes-Flinstone** |
| **File(s)** | \`Bailey-Forbes-Flinstone/Makefile\`<br>\`Bailey-Forbes-Flinstone/kernel/core/sched/bg_jobs.c\` |
| **Change** | modify + delete duplicates |
| **Status** | PROPOSED (separate story, requested) |
| **Depends on** | none (independent of the monitor stories) |
| **Needed by** | FL-23, FL-20 (absorbs FL-24), FL-25 |

**OLD** \`Bailey-Forbes-Flinstone/Makefile\` lines 2-3 (verbatim from \`develop\` e5ceb55)

\`\`\`make
threadpool.c priority_queue.c workqueue.c
all: build
\`\`\`

**NEW** (proposal, not compiled)

\`\`\`make
threadpool.c kernel/core/sched/priority_queue.c workqueue.c
\`\`\`

**Why**

- one queue.

### Not verified

emcc is not installed.
`

const KQ17 = `> **Catalog entry KQ-17** · project: **KEYQUORUM · Rust** · from \`keyquorum-flinstone-change-catalog.md\`.

### Dependencies

\`\`\`mermaid
flowchart LR
  KQ02["KQ-02"] --> THIS
  KQ14["KQ-14"] --> THIS
  KQ19["KQ-19"] --> THIS
  THIS --> FL12["FL-12"]
  THIS(["KQ-17"])
\`\`\`

| | |
|---|---|
| **Project** | **KeyQuorum** |
| **File(s)** | \`KeyQuorum/src/access.rs (NEW)\`<br>\`KeyQuorum/ffi/identity/include/keyquorum_access.h (NEW)\` |
| **Change** | new files |
| **Status** | DECIDED (crossing a private bridge needs the KQST of a bridge member) |
| **Depends on** | KQ-02, KQ-14, KQ-19 |
| **Needed by** | FL-12 |

**NEW** (proposal, not compiled)

\`\`\`rust
pub fn requirement() {}
\`\`\`

**Why**

- decided.
`

function repo(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-st-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir })
  return dir
}
const sha = dir => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

test('parse reads the structure of the real FL and KQ story format', () => {
  const fl = parseStory(FL22, { title: 'FL-22: Make the queue legitimate' })
  assert.equal(fl.id, 'FL-22')
  assert.equal(fl.title, 'Make the queue legitimate')
  assert.equal(fl.project, 'FLINSTONE · C')
  assert.deepEqual(fl.baseline, { branch: 'develop', sha: 'e5ceb55' })
  assert.equal(fl.status, 'PROPOSED')
  assert.deepEqual(fl.dependsOn, [])
  assert.deepEqual(fl.neededBy, ['FL-23', 'FL-20', 'FL-25'])
  assert.deepEqual(fl.relationNotes, ['FL-20 absorbs FL-24'])
  assert.deepEqual(fl.files, ['Bailey-Forbes-Flinstone/Makefile', 'Bailey-Forbes-Flinstone/kernel/core/sched/bg_jobs.c'])
  assert.equal(fl.oldBlocks.length, 1)
  assert.deepEqual([fl.oldBlocks[0].from, fl.oldBlocks[0].to, fl.oldBlocks[0].baselineSha], [2, 3, 'e5ceb55'])
  assert.equal(fl.newBlocks[0].compiled, false)
  assert.ok(fl.hasWhy && fl.hasNotVerified)

  const kq = parseStory(KQ17)
  assert.equal(kq.id, 'KQ-17')
  assert.equal(kq.status, 'DECIDED')
  assert.deepEqual(kq.dependsOn, ['KQ-02', 'KQ-14', 'KQ-19'])
  assert.deepEqual(kq.neededBy, ['FL-12'])
})

test('the graph orders stories, lists what is ready, links two projects and finds every kind of mistake', () => {
  const fl = { project: { code: 'FL' }, stories: [
    { id: 'FL-12', title: 'login', status: 'PROPOSED', dependsOn: ['KQ-17'], neededBy: [] },
    { id: 'FL-22', title: 'queue', status: 'PROPOSED', dependsOn: [], neededBy: ['FL-25'] },
    { id: 'FL-25', title: 'durable', status: 'PROPOSED', dependsOn: ['FL-22'], neededBy: [] },
  ] }
  const kq = { project: { code: 'KQ' }, stories: [
    { id: 'KQ-02', title: 'x', status: 'DONE', dependsOn: [], neededBy: ['KQ-17'] },
    { id: 'KQ-17', title: 'access', status: 'DECIDED', dependsOn: ['KQ-02'], neededBy: ['FL-12'], patterns: ['pure-function-over-supplied-facts'] },
  ] }
  const norm = c => ({ ...c, stories: c.stories.map(s => ({ dependsOn: [], neededBy: [], absorbs: [], absorbedBy: [], supersedes: [], supersededBy: [], refines: [], refinedBy: [], sharesContract: [], files: [], patterns: [], ...s })) })
  const merged = buildGraph([norm(fl), norm(kq)])
  assert.deepEqual(merged.problems, [])
  assert.deepEqual(merged.levels[0].sort(), ['FL-22', 'KQ-02'])
  assert.deepEqual(merged.ready.sort(), ['FL-22', 'KQ-17'])
  assert.deepEqual(merged.crossProject, [{ from: 'KQ-17', to: 'FL-12' }])
  assert.ok(merged.critical.length >= 3)
  assert.match(merged.mermaid, /s_KQ_17 -\.-> s_FL_12/)
  assert.deepEqual(merged.patterns, { 'pure-function-over-supplied-facts': ['KQ-17'] })

  const alone = buildGraph([norm(fl)])
  assert.ok(alone.warnings.some(w => w.includes('KQ-17')), 'a foreign id is only a warning in one catalog')
  assert.ok(alone.problems.some(p => p.startsWith('inverse-missing') && p.includes('FL-12')) === false)

  const broken = norm({ project: { code: 'FL' }, stories: [
    { id: 'FL-01', title: 'a', status: 'DONE', dependsOn: ['FL-02'], neededBy: [] },
    { id: 'FL-02', title: 'b', status: 'PROPOSED', dependsOn: ['FL-01'], neededBy: [] },
    { id: 'FL-03', title: 'c', status: 'SUPERSEDED', dependsOn: [], neededBy: [] },
    { id: 'FL-04', title: 'd', status: 'WHATEVER', dependsOn: ['FL-99'], neededBy: [] },
  ] })
  const bad = buildGraph([broken])
  const text = bad.problems.join('\n')
  assert.match(text, /cycle in dependsOn/)
  assert.match(text, /inverse-missing/)
  assert.match(text, /SUPERSEDED but no supersededBy/)
  assert.match(text, /status WHATEVER/)
  assert.match(text, /FL-99/)
  assert.ok(bad.warnings.some(w => w.startsWith('done-before-dependency')))
})

test('new and link keep the catalog and both sides of a relation in step, and refuse a cycle', () => {
  const dir = repo()
  install({ dest: dir, target: 'claude' })
  const { catalog } = loadCatalog(dir)
  assert.equal(catalog.stories.length, 0)

  assert.equal(newStory(dir, { id: 'KQ-01', title: 'first' }).applied, false)
  assert.ok(!fs.existsSync(path.join(dir, '.devops/stories/KQ-01.md')))
  newStory(dir, { id: 'KQ-01', title: 'first story' }, { apply: true })
  newStory(dir, { id: 'KQ-02', title: 'second story', dependsOn: ['KQ-01'], patterns: ['append-only-codes'] }, { apply: true })
  assert.throws(() => newStory(dir, { id: 'KQ-02', title: 'again' }, { apply: true }), /already exists/)
  assert.throws(() => newStory(dir, { id: '../etc', title: 'x' }, { apply: true }), /id must look like/)
  const body = fs.readFileSync(path.join(dir, '.devops/stories/KQ-02.md'), 'utf8')
  assert.match(body, /^# KQ-02: second story/)
  assert.match(body, /KQ01\["KQ-01"\] --> THIS/)
  assert.match(body, /\*\*Depends on\*\* \| KQ-01/)

  const link = linkStories(dir, { from: 'KQ-02', to: 'KQ-01', relation: 'depends-on' }, { apply: true })
  assert.deepEqual(link.changes, ['KQ-01.neededBy += KQ-02'], 'dependsOn was already set; the missing inverse is filled in')
  assert.deepEqual(loadCatalog(dir).catalog.stories.find(s => s.id === 'KQ-01').neededBy, ['KQ-02'])
  assert.throws(() => linkStories(dir, { from: 'KQ-01', to: 'KQ-02', relation: 'depends-on' }, { apply: true }), /cycle/)
  assert.deepEqual(loadCatalog(dir).catalog.stories.find(s => s.id === 'KQ-01').dependsOn, [], 'a refused link changes nothing')
  assert.throws(() => linkStories(dir, { from: 'KQ-01', to: 'KQ-02', relation: 'bogus' }), /relation must be/)
  const foreign = linkStories(dir, { from: 'KQ-02', to: 'FL-12', relation: 'shares-contract' }, { apply: true })
  assert.deepEqual(foreign.foreign, ['FL-12'])
  assert.equal(buildGraph([loadCatalog(dir).catalog]).problems.length, 0)
})

test('check proves OLD blocks are verbatim from the baseline and catches drift', () => {
  const dir = repo({ 'Makefile': 'CC=cc\nthreadpool.c priority_queue.c workqueue.c\nall: build\n' })
  const base = sha(dir)
  const story = FL22.replaceAll('e5ceb55', base).replaceAll('Bailey-Forbes-Flinstone/', '')
  fs.mkdirSync(path.join(dir, '.devops/stories'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.devops/stories/FL-22.md'), story)
  const good = checkStory(dir, 'FL-22')
  assert.equal(good.blocks[0].status, 'verbatim', JSON.stringify(good))
  assert.deepEqual(good.problems.filter(p => p.startsWith('OLD')), [])

  fs.writeFileSync(path.join(dir, '.devops/stories/FL-22.md'), story.replace(`lines 2-3 (verbatim from \`develop\` ${base})`, 'lines 2-3 (verbatim from the repo)'))
  fs.writeFileSync(path.join(dir, 'Makefile'), 'CC=cc\nthreadpool.c CHANGED workqueue.c\nall: build\n')
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'drift'], { cwd: dir })
  assert.equal(checkStory(dir, 'FL-22').blocks[0].status, 'verbatim', 'pinned to the baseline sha, later edits do not matter')
  const drifted = checkStory(dir, 'FL-22', { ref: 'HEAD' })
  assert.equal(drifted.blocks[0].status, 'changed')
  assert.equal(drifted.blocks[0].firstDifferentLine, 2)
  assert.ok(!drifted.ok)

  fs.writeFileSync(path.join(dir, '.devops/stories/FL-23.md'), '# FL-23\n\n| **Status** | PROPOSED |\n')
  const thin = checkStory(dir, 'FL-23')
  for (const want of [/no OLD block/, /no NEW block/, /no Why section/, /Not verified/, /Dependencies section/]) assert.match(thin.problems.join('\n'), want)
  assert.throws(() => checkStory(dir, '../../etc/passwd'), /ENOENT|no such/)
})

test('guidance gathers order, ready work, patterns and decisions, and writes only on apply', () => {
  const dir = repo()
  install({ dest: dir, target: 'claude' })
  newStory(dir, { id: 'KQ-01', title: 'pure access', patterns: ['pure-function-over-supplied-facts'] }, { apply: true })
  newStory(dir, { id: 'KQ-02', title: 'uses it', dependsOn: ['KQ-01'] }, { apply: true })
  linkStories(dir, { from: 'KQ-02', to: 'KQ-01', relation: 'depends-on' }, { apply: true })
  const plan = guidance(dir)
  assert.equal(plan.applied, false)
  assert.ok(!fs.existsSync(path.join(dir, '.devops/stories/guidance.md')))
  assert.match(plan.text, /Ready to start: KQ-01/)
  assert.match(plan.text, /\*\*pure-function-over-supplied-facts\*\*: KQ-01/)
  assert.match(plan.text, /```mermaid/)
  guidance(dir, { apply: true })
  assert.ok(fs.existsSync(path.join(dir, '.devops/stories/guidance.md')))
  assert.equal(emptyCatalog('XX', 'x').stories.length, 0)
})
