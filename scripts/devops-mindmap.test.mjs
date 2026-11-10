import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildMindMap, mindMapOverview, mindMapQuery, mindMapStatus, symbolsOf } from './devops-mindmap.mjs'

function project(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-mind-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

const SAMPLE = {
  'package.json': JSON.stringify({ name: 'sample', bin: { sample: 'src/api/routes.ts' }, scripts: { test: 'node --test' }, dependencies: { lodash: '^4.17.21', unused: '1.0.0' } }),
  'README.md': '# Sample\n\nA sample service that builds routes.\n',
  'src/util/strings.ts': "export function slugify(text: string) {\n  return text.toLowerCase()\n}\n\nfunction helper() {\n  const inner = () => 1\n  return inner()\n}\n",
  'src/api/routes.ts': "import { slugify } from '../util/strings'\nimport fs from 'node:fs'\nimport _ from 'lodash'\n\nexport function routeFor(name: string) {\n  return '/' + slugify(name)\n}\n",
  'src/web/other.ts': 'export function slugify(text: string) {\n  return text\n}\n',
  'src/api/routes.test.ts': "import { routeFor } from './routes'\nrouteFor('x')\n",
  'py/app/main.py': 'from .models import User\nimport requests\n\nclass Service:\n    def handle_user(self):\n        return User()\n\ndef make_service():\n    return Service()\n',
  'py/app/models.py': 'class User:\n    pass\n',
  'docs/guide.md': '---\ndescription: How routes are built\n---\n# Routing guide\n\nSee [the router](../src/api/routes.ts) and `src/util/strings.ts`.\n',
  '.env': 'API_KEY=hunter2hunter2\n',
  'node_modules/lodash/index.js': 'module.exports = {}\n',
}

test('symbols carry kind, export flag, signature and a line range; nested helpers are dropped', () => {
  const symbols = symbolsOf(SAMPLE['src/util/strings.ts'], 'typescript')
  assert.deepEqual(symbols.map(s => [s.name, s.line, s.end, s.exported]), [['slugify', 1, 3, true], ['helper', 5, 8, false]])
  assert.equal(symbols[0].signature, 'export function slugify(text: string) {')
  const py = symbolsOf(SAMPLE['py/app/main.py'], 'python')
  assert.deepEqual(py.map(s => [s.name, s.kind, s.line, s.end]), [['Service', 'class', 4, 6], ['handle_user', 'method', 5, 6], ['make_service', 'function', 8, 9]])
})

test('mind map links docs, files, imports, calls, libraries, tests and duplicates', () => {
  const dir = project(SAMPLE)
  const { map, summary } = buildMindMap(dir)
  assert.deepEqual(map.files['src/api/routes.ts'].imports, ['src/util/strings.ts'])
  assert.deepEqual(map.importedBy['src/util/strings.ts'], ['src/api/routes.ts'])
  assert.deepEqual(map.files['src/api/routes.ts'].libraries, ['lodash'], 'node builtins are not libraries')
  assert.deepEqual(map.files['py/app/main.py'].imports, ['py/app/models.py'])
  assert.deepEqual(map.libraries.lodash.usedBy, ['src/api/routes.ts'])
  assert.equal(map.libraries.unused.unusedInScannedCode, true)
  assert.equal(map.libraries.requests.undeclared, true)
  assert.ok(map.calls.some(c => c.from === 'src/api/routes.ts#routeFor' && c.to === 'src/util/strings.ts#slugify'), 'call resolved through the import, not to the other slugify')
  assert.ok(!map.calls.some(c => c.to === 'src/web/other.ts#slugify'))
  assert.ok(map.calls.some(c => c.from === 'py/app/main.py#make_service' && c.to === 'py/app/main.py#Service'))
  assert.deepEqual(map.testedBy['src/api/routes.ts'], ['src/api/routes.test.ts'])
  assert.deepEqual(map.docs['docs/guide.md'].links, ['src/api/routes.ts'])
  assert.equal(map.docs['docs/guide.md'].summary, 'How routes are built')
  assert.deepEqual(map.files['src/util/strings.ts'].documentedBy, ['docs/guide.md'])
  assert.deepEqual(map.duplicates.map(d => d.name), ['slugify'])
  assert.ok(!Object.keys(map.files).some(f => f.startsWith('node_modules')))
  assert.ok(!JSON.stringify(map).includes('hunter2'), 'secret files are never read')
  assert.match(summary, /```mermaid\ngraph TD/)
  assert.match(summary, /## Possible duplicates[\s\S]*`slugify`/)
})

test('saved map, status shows only what changed, query answers without reading files', () => {
  const dir = project(SAMPLE)
  const built = buildMindMap(dir, { save: true })
  assert.deepEqual(built.saved, ['mindmap.json', 'MINDMAP.md', 'OVERVIEW.md'].map(name => path.join('.devops', 'mindmap', name)))
  assert.equal(mindMapStatus(dir).stale, false)

  fs.appendFileSync(path.join(dir, 'src/util/strings.ts'), 'export const extra = 1\n')
  fs.writeFileSync(path.join(dir, 'src/api/new.ts'), 'export function added() {}\n')
  fs.rmSync(path.join(dir, 'py/app/models.py'))
  const status = mindMapStatus(dir)
  assert.equal(status.stale, true)
  assert.deepEqual(status.changed, ['src/util/strings.ts'])
  assert.deepEqual(status.added, ['src/api/new.ts'])
  assert.deepEqual(status.removed, ['py/app/models.py'])
  assert.deepEqual(status.modulesTouched, ['py', 'src/api', 'src/util'])

  const slug = mindMapQuery(dir, { symbol: 'slugify' })
  assert.match(slug.source, /^saved map/)
  assert.equal(slug.definitions.length, 2)
  assert.match(slug.warning, /duplicate/)
  assert.ok(slug.callers.some(c => c.caller === 'src/api/routes.ts#routeFor'))
  assert.deepEqual(mindMapQuery(dir, { symbol: 'slug' }).similarNames, ['slugify'])
  const file = mindMapQuery(dir, { file: 'src/api/routes.ts' })
  assert.deepEqual(file.testedBy, ['src/api/routes.test.ts'])
  assert.deepEqual(file.documentedBy, ['docs/guide.md'])
  assert.equal(mindMapQuery(dir, { module: 'src/util' }).files[0], 'src/util/strings.ts')
  assert.deepEqual(mindMapQuery(dir, { library: 'LODASH' }).usedBy, ['src/api/routes.ts'])
  assert.ok(mindMapQuery(dir, { search: 'route' }).symbols.some(s => s.name === 'routeFor'))
  assert.equal(mindMapQuery(dir, { symbol: 'added', fresh: true }).definitions[0].file, 'src/api/new.ts')
  assert.throws(() => mindMapQuery(dir, {}), /exactly one/)
  assert.throws(() => mindMapQuery(dir, { file: 'nope.ts' }), /not in the mind map/)
})

test('overview: a quick scan for plain chat, from the saved map or built without writing', () => {
  const dir = project(SAMPLE)
  const unsaved = mindMapOverview(dir)
  assert.match(unsaved.source, /not saved/)
  assert.ok(!fs.existsSync(path.join(dir, '.devops')), 'an overview never writes')
  const text = unsaved.overview
  assert.match(text, /^# sample: at a glance/)
  assert.match(text, /A sample service that builds routes\./)
  assert.match(text, /\*\*Starts at:\*\* `src\/api\/routes\.ts`/)
  assert.match(text, /`npm run test` \(node --test\)/)
  assert.match(text, /- `src\/api` \(2 files\): exports routeFor; uses src\/util/)
  assert.match(text, /\*\*Main libraries:\*\* lodash \(1 files\)/)
  assert.match(text, /\*\*Watch out:\*\* 1 name\(s\) defined in more than one file \(slugify\)/)
  assert.ok(text.split('\n').length < 50, 'short enough to scan')

  buildMindMap(dir, { save: true })
  assert.match(fs.readFileSync(path.join(dir, '.devops/mindmap/MINDMAP.md'), 'utf8'), /## sample: at a glance/)
  const fresh = mindMapOverview(dir)
  assert.equal(fresh.stale, false)
  assert.equal(fresh.overview, fs.readFileSync(path.join(dir, '.devops/mindmap/OVERVIEW.md'), 'utf8'))
  fs.appendFileSync(path.join(dir, 'src/api/routes.ts'), '// changed\n')
  const stale = mindMapOverview(dir)
  assert.equal(stale.changedFiles, 1)
  assert.match(stale.next, /src\/api\/routes\.ts/)
})
