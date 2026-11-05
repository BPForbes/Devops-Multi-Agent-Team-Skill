import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildGraph, checkStory, emptyCatalog, guidance, linkStories, loadCatalog, newStory, parseStory } from './devops-stories.mjs'
import { install } from './devops-setup.mjs'

const SRV22 = `> **Catalog entry SRV-22** · project: **SERVER · C** · from \`change-catalog.md\`.
> **Re-baselined against \`develop\` a1b2c3d.** The premise holds on \`develop\`.

### Dependencies

\`\`\`mermaid
flowchart LR
  THIS --> SRV23["SRV-23"]
  THIS --> SRV24["SRV-20 (absorbs SRV-24)"]
  THIS --> SRV25["SRV-25"]
  THIS(["SRV-22"])
\`\`\`

| | |
|---|---|
| **Project** | **server-app** |
| **File(s)** | \`server-app/Makefile\`<br>\`server-app/kernel/core/sched/bg_jobs.c\` |
| **Change** | modify + delete duplicates |
| **Status** | PROPOSED (separate story, requested) |
| **Depends on** | none (independent of the monitor stories) |
| **Needed by** | SRV-23, SRV-20 (absorbs SRV-24), SRV-25 |

**OLD** \`server-app/Makefile\` lines 2-3 (verbatim from \`develop\` a1b2c3d)

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

const CLI17 = `> **Catalog entry CLI-17** · project: **CLIENT · Rust** · from \`change-catalog.md\`.

### Dependencies

\`\`\`mermaid
flowchart LR
  CLI02["CLI-02"] --> THIS
  CLI14["CLI-14"] --> THIS
  CLI19["CLI-19"] --> THIS
  THIS --> SRV12["SRV-12"]
  THIS(["CLI-17"])
\`\`\`

| | |
|---|---|
| **Project** | **client-app** |
| **File(s)** | \`client-app/src/access.rs (NEW)\`<br>\`client-app/ffi/identity/include/client_access.h (NEW)\` |
| **Change** | new files |
| **Status** | DECIDED (crossing a private bridge needs the CLIST of a bridge member) |
| **Depends on** | CLI-02, CLI-14, CLI-19 |
| **Needed by** | SRV-12 |

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

test('parse reads the structure of the real SRV and CLI story format', () => {
  const server = parseStory(SRV22, { title: 'SRV-22: Make the queue legitimate' })
  assert.equal(server.id, 'SRV-22')
  assert.equal(server.title, 'Make the queue legitimate')
  assert.equal(server.project, 'SERVER · C')
  assert.deepEqual(server.baseline, { branch: 'develop', sha: 'a1b2c3d' })
  assert.equal(server.status, 'PROPOSED')
  assert.deepEqual(server.dependsOn, [])
  assert.deepEqual(server.neededBy, ['SRV-23', 'SRV-20', 'SRV-25'])
  assert.deepEqual(server.relationNotes, ['SRV-20 absorbs SRV-24'])
  assert.deepEqual(server.files, ['server-app/Makefile', 'server-app/kernel/core/sched/bg_jobs.c'])
  assert.equal(server.oldBlocks.length, 1)
  assert.deepEqual([server.oldBlocks[0].from, server.oldBlocks[0].to, server.oldBlocks[0].baselineSha], [2, 3, 'a1b2c3d'])
  assert.equal(server.newBlocks[0].compiled, false)
  assert.ok(server.hasWhy && server.hasNotVerified)

  const client = parseStory(CLI17)
  assert.equal(client.id, 'CLI-17')
  assert.equal(client.status, 'DECIDED')
  assert.deepEqual(client.dependsOn, ['CLI-02', 'CLI-14', 'CLI-19'])
  assert.deepEqual(client.neededBy, ['SRV-12'])
})

test('the graph orders stories, lists what is ready, links two projects and finds every kind of mistake', () => {
  const server = { project: { code: 'SRV' }, stories: [
    { id: 'SRV-12', title: 'login', status: 'PROPOSED', dependsOn: ['CLI-17'], neededBy: [] },
    { id: 'SRV-22', title: 'queue', status: 'PROPOSED', dependsOn: [], neededBy: ['SRV-25'] },
    { id: 'SRV-25', title: 'durable', status: 'PROPOSED', dependsOn: ['SRV-22'], neededBy: [] },
  ] }
  const client = { project: { code: 'CLI' }, stories: [
    { id: 'CLI-02', title: 'x', status: 'DONE', dependsOn: [], neededBy: ['CLI-17'] },
    { id: 'CLI-17', title: 'access', status: 'DECIDED', dependsOn: ['CLI-02'], neededBy: ['SRV-12'], patterns: ['pure-function-over-supplied-facts'] },
  ] }
  const norm = c => ({ ...c, stories: c.stories.map(s => ({ dependsOn: [], neededBy: [], absorbs: [], absorbedBy: [], supersedes: [], supersededBy: [], refines: [], refinedBy: [], sharesContract: [], files: [], patterns: [], ...s })) })
  const merged = buildGraph([norm(server), norm(client)])
  assert.deepEqual(merged.problems, [])
  assert.deepEqual(merged.levels[0].sort(), ['CLI-02', 'SRV-22'])
  assert.deepEqual(merged.ready.sort(), ['CLI-17', 'SRV-22'])
  assert.deepEqual(merged.crossProject, [{ from: 'CLI-17', to: 'SRV-12' }])
  assert.ok(merged.critical.length >= 3)
  assert.match(merged.mermaid, /s_CLI_17 -\.-> s_SRV_12/)
  assert.deepEqual(merged.patterns, { 'pure-function-over-supplied-facts': ['CLI-17'] })

  const alone = buildGraph([norm(server)])
  assert.ok(alone.warnings.some(w => w.includes('CLI-17')), 'a foreign id is only a warning in one catalog')
  assert.ok(alone.problems.some(p => p.startsWith('inverse-missing') && p.includes('SRV-12')) === false)

  const broken = norm({ project: { code: 'SRV' }, stories: [
    { id: 'SRV-01', title: 'a', status: 'DONE', dependsOn: ['SRV-02'], neededBy: [] },
    { id: 'SRV-02', title: 'b', status: 'PROPOSED', dependsOn: ['SRV-01'], neededBy: [] },
    { id: 'SRV-03', title: 'c', status: 'SUPERSEDED', dependsOn: [], neededBy: [] },
    { id: 'SRV-04', title: 'd', status: 'WHATEVER', dependsOn: ['SRV-99'], neededBy: [] },
  ] })
  const bad = buildGraph([broken])
  const text = bad.problems.join('\n')
  assert.match(text, /cycle in dependsOn/)
  assert.match(text, /inverse-missing/)
  assert.match(text, /SUPERSEDED but no supersededBy/)
  assert.match(text, /status WHATEVER/)
  assert.match(text, /SRV-99/)
  assert.ok(bad.warnings.some(w => w.startsWith('done-before-dependency')))
})

test('new and link keep the catalog and both sides of a relation in step, and refuse a cycle', () => {
  const dir = repo()
  install({ dest: dir, target: 'claude' })
  const { catalog } = loadCatalog(dir)
  assert.equal(catalog.stories.length, 0)

  assert.equal(newStory(dir, { id: 'CLI-01', title: 'first' }).applied, false)
  assert.ok(!fs.existsSync(path.join(dir, '.devops/stories/CLI-01.md')))
  newStory(dir, { id: 'CLI-01', title: 'first story' }, { apply: true })
  newStory(dir, { id: 'CLI-02', title: 'second story', dependsOn: ['CLI-01'], patterns: ['append-only-codes'] }, { apply: true })
  assert.throws(() => newStory(dir, { id: 'CLI-02', title: 'again' }, { apply: true }), /already exists/)
  assert.throws(() => newStory(dir, { id: '../etc', title: 'x' }, { apply: true }), /id must look like/)
  const body = fs.readFileSync(path.join(dir, '.devops/stories/CLI-02.md'), 'utf8')
  assert.match(body, /^# CLI-02: second story/)
  assert.match(body, /CLI01\["CLI-01"\] --> THIS/)
  assert.match(body, /\*\*Depends on\*\* \| CLI-01/)

  const link = linkStories(dir, { from: 'CLI-02', to: 'CLI-01', relation: 'depends-on' }, { apply: true })
  assert.deepEqual(link.changes, ['CLI-01.neededBy += CLI-02'], 'dependsOn was already set; the missing inverse is filled in')
  assert.deepEqual(loadCatalog(dir).catalog.stories.find(s => s.id === 'CLI-01').neededBy, ['CLI-02'])
  assert.throws(() => linkStories(dir, { from: 'CLI-01', to: 'CLI-02', relation: 'depends-on' }, { apply: true }), /cycle/)
  assert.deepEqual(loadCatalog(dir).catalog.stories.find(s => s.id === 'CLI-01').dependsOn, [], 'a refused link changes nothing')
  assert.throws(() => linkStories(dir, { from: 'CLI-01', to: 'CLI-02', relation: 'bogus' }), /relation must be/)
  const foreign = linkStories(dir, { from: 'CLI-02', to: 'SRV-12', relation: 'shares-contract' }, { apply: true })
  assert.deepEqual(foreign.foreign, ['SRV-12'])
  assert.equal(buildGraph([loadCatalog(dir).catalog]).problems.length, 0)
})

test('check proves OLD blocks are verbatim from the baseline and catches drift', () => {
  const dir = repo({ 'Makefile': 'CC=cc\nthreadpool.c priority_queue.c workqueue.c\nall: build\n' })
  const base = sha(dir)
  const story = SRV22.replaceAll('a1b2c3d', base).replaceAll('server-app/', '')
  fs.mkdirSync(path.join(dir, '.devops/stories'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.devops/stories/SRV-22.md'), story)
  const good = checkStory(dir, 'SRV-22')
  assert.equal(good.blocks[0].status, 'verbatim', JSON.stringify(good))
  assert.deepEqual(good.problems.filter(p => p.startsWith('OLD')), [])

  fs.writeFileSync(path.join(dir, '.devops/stories/SRV-22.md'), story.replace(`lines 2-3 (verbatim from \`develop\` ${base})`, 'lines 2-3 (verbatim from the repo)'))
  fs.writeFileSync(path.join(dir, 'Makefile'), 'CC=cc\nthreadpool.c CHANGED workqueue.c\nall: build\n')
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'drift'], { cwd: dir })
  assert.equal(checkStory(dir, 'SRV-22').blocks[0].status, 'verbatim', 'pinned to the baseline sha, later edits do not matter')
  const drifted = checkStory(dir, 'SRV-22', { ref: 'HEAD' })
  assert.equal(drifted.blocks[0].status, 'changed')
  assert.equal(drifted.blocks[0].firstDifferentLine, 2)
  assert.ok(!drifted.ok)

  fs.writeFileSync(path.join(dir, '.devops/stories/SRV-23.md'), '# SRV-23\n\n| **Status** | PROPOSED |\n')
  const thin = checkStory(dir, 'SRV-23')
  for (const want of [/no OLD block/, /no NEW block/, /no Why section/, /Not verified/, /Dependencies section/]) assert.match(thin.problems.join('\n'), want)
  assert.throws(() => checkStory(dir, '../../etc/passwd'), /ENOENT|no such/)
})

test('guidance gathers order, ready work, patterns and decisions, and writes only on apply', () => {
  const dir = repo()
  install({ dest: dir, target: 'claude' })
  newStory(dir, { id: 'CLI-01', title: 'pure access', patterns: ['pure-function-over-supplied-facts'] }, { apply: true })
  newStory(dir, { id: 'CLI-02', title: 'uses it', dependsOn: ['CLI-01'] }, { apply: true })
  linkStories(dir, { from: 'CLI-02', to: 'CLI-01', relation: 'depends-on' }, { apply: true })
  const plan = guidance(dir)
  assert.equal(plan.applied, false)
  assert.ok(!fs.existsSync(path.join(dir, '.devops/stories/guidance.md')))
  assert.match(plan.text, /Ready to start: CLI-01/)
  assert.match(plan.text, /\*\*pure-function-over-supplied-facts\*\*: CLI-01/)
  assert.match(plan.text, /```mermaid/)
  guidance(dir, { apply: true })
  assert.ok(fs.existsSync(path.join(dir, '.devops/stories/guidance.md')))
  assert.equal(emptyCatalog('XX', 'x').stories.length, 0)
})
