import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildMindMap, loadText, mindMapNote, mindMapOverview, mindMapQuery, mindMapStatus, mindMapTree, symbolsOf } from './devops-mindmap.mjs'

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
  assert.deepEqual(built.saved, ['mindmap.json', 'MINDMAP.md', 'OVERVIEW.md', 'graph.json'].map(name => path.join('.devops', 'mindmap', name)))
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

const DOCUMENTED = {
  'README.md': '# Shop\n\nA small shop.\n',
  'src/cart/README.md': '# Cart\n\nThe cart keeps line items and totals them.\n',
  'src/cart/cart.ts': [
    '/** Line items and their total. */',
    "import { money } from '../util/money'",
    '',
    '/**',
    ' * Adds up every line item, rounding once at the end.',
    ' * @param items the lines',
    ' */',
    'export function total(items: number[]) {',
    '  return money(items.reduce((a, b) => a + b, 0))',
    '}',
    '',
    'export class Cart {',
    '  // Appends one line item.',
    '  add(item: number) {',
    '    return item',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/util/money.ts': '// Rounds to cents.\nexport function money(n: number) {\n  return Math.round(n * 100) / 100\n}\n',
  'py/tax.py': '"""Tax rules."""\n\ndef vat(amount):\n    """Value added tax at the standard rate.\n\n    Args:\n      amount: net\n    """\n    return amount * 0.2\n',
  'docs/design.md': '# Design\n\n## Totals\n\n`total()` calls `money()` once, see [cart](../src/cart/cart.ts); the `status` word links nothing.\n\n### Tax\n\nTax is `tax.vat`.\n',
}

test('documentation is part of the map: doc comments, docstrings, file headers, READMEs and doc sections', () => {
  const dir = project(DOCUMENTED)
  const { map } = buildMindMap(dir)
  const cart = map.files['src/cart/cart.ts']
  assert.equal(cart.doc, 'Line items and their total.')
  const total = cart.symbols.find(s => s.name === 'total')
  assert.equal(total.doc, 'Adds up every line item, rounding once at the end.')
  assert.equal(cart.symbols.find(s => s.name === 'add').doc, 'Appends one line item.')
  assert.equal(map.files['src/util/money.ts'].doc, undefined, 'a comment on the first function is its doc, not the file\'s')
  assert.equal(map.files['src/util/money.ts'].symbols[0].doc, 'Rounds to cents.')
  assert.equal(map.files['py/tax.py'].doc, 'Tax rules.')
  assert.equal(map.files['py/tax.py'].symbols[0].doc, 'Value added tax at the standard rate.')
  assert.equal(map.modules['src/cart'].doc, 'The cart keeps line items and totals them.')
  assert.deepEqual(total.documentedIn, [{ doc: 'docs/design.md', section: 'Totals', line: 3 }])
  const totals = map.docs['docs/design.md'].sections.find(s => s.heading === 'Totals')
  assert.deepEqual(totals.refs, ['src/cart/cart.ts#total', 'src/util/money.ts#money', 'src/cart/cart.ts'])
  assert.deepEqual(map.docs['docs/design.md'].sections.find(s => s.heading === 'Tax').refs, ['py/tax.py#vat'])
})

test('the map is a tree with cross links; a node explains how it works with its neighbours\' docs and notes', () => {
  const dir = project(DOCUMENTED)
  const { graph, summary } = buildMindMap(dir, { save: true })
  const node = id => graph.nodes.find(n => n.id === id)
  assert.equal(node('module:src/cart').parent, 'project')
  assert.equal(node('file:src/cart/cart.ts').parent, 'module:src/cart')
  assert.equal(node('symbol:src/cart/cart.ts#add').parent, 'symbol:src/cart/cart.ts#Cart', 'a method sits under its class')
  assert.equal(node('section:docs/design.md#L7').parent, 'section:docs/design.md#L3', 'sections nest by level')
  assert.equal(node('doc:docs/design.md').parent, 'folder:docs')
  assert.ok(graph.edges.some(e => e.kind === 'documents' && e.from === 'section:docs/design.md#L3' && e.to === 'symbol:src/cart/cart.ts#total'))
  assert.ok(graph.edges.some(e => e.kind === 'calls' && e.from === 'symbol:src/cart/cart.ts#total' && e.to === 'symbol:src/util/money.ts#money'))
  assert.ok(fs.existsSync(path.join(dir, '.devops/mindmap/graph.json')))
  assert.match(summary, /```mermaid\nmindmap\n {2}root\(\(Shop\)\)/)
  assert.match(summary, /- export function total\(items: number\[\]\) \{ \[function\] L8-10 — Adds up every line item/)
  assert.match(summary, /Totals \(L3\): `src\/cart\/cart\.ts#total`/)

  const planned = mindMapNote(dir, { node: 'total', text: 'Rounds once so totals match the receipt.' })
  assert.equal(planned.applied, false)
  assert.equal(planned.key, 'src/cart/cart.ts#total')
  mindMapNote(dir, { node: 'total', text: 'Rounds once so totals match the receipt.', apply: true })
  mindMapNote(dir, { node: 'src/cart', text: 'Owns pricing of a basket.', apply: true })
  mindMapNote(dir, { node: 'total', text: 'Rounds once, at the end.', apply: true })
  const notes = fs.readFileSync(path.join(dir, '.devops/mindmap/NOTES.md'), 'utf8')
  assert.equal(notes.match(/## src\/cart\/cart\.ts#total/g).length, 1, 'a note is replaced, not duplicated')
  assert.match(notes, /Rounds once, at the end\./)
  assert.throws(() => mindMapNote(dir, { node: 'nothing-like-this', text: 'x' }), /no single node/)

  const tree = mindMapTree(dir, { node: 'total' })
  assert.deepEqual(tree.path, ['Shop', 'src/cart', 'cart.ts'])
  assert.equal(tree.node.summary, 'Adds up every line item, rounding once at the end.')
  assert.equal(tree.node.notes, 'Rounds once, at the end.', 'notes are read live, no rebuild needed')
  assert.deepEqual(tree.links.out.calls, [{ id: 'symbol:src/util/money.ts#money', name: 'money', summary: 'Rounds to cents.' }])
  assert.equal(tree.links.in['documented by'][0].name, 'docs/design.md > Totals')
  const module = mindMapTree(dir, { node: 'src/cart', depth: 2 })
  assert.equal(module.node.notes, 'Owns pricing of a basket.')
  assert.match(module.text, /cart\.ts \[file\] — Line items and their total\.\n {4}- export function total/)
  assert.equal(mindMapTree(dir, { node: 'docs/design.md', depth: 3 }).tree.children[0].children[0].children[0].name, 'Tax', 'doc > Design > Totals > Tax')
  assert.equal(mindMapQuery(dir, { symbol: 'total' }).definitions[0].notes, 'Rounds once, at the end.')
  assert.equal(mindMapQuery(dir, { symbol: 'total' }).callees[0].calleeDoc, 'Rounds to cents.')
})

test('no sentence is in the code: the wording and word lists come from mindmap-text.json, overridable per project', () => {
  const defaults = JSON.parse(fs.readFileSync(new URL('../mindmap-text.json', import.meta.url), 'utf8'))
  const source = fs.readFileSync(new URL('./devops-mindmap.mjs', import.meta.url), 'utf8')
  for (const [key, value] of Object.entries(defaults.text)) {
    const sentence = value.split(/\{\w+\}/).sort((a, b) => b.length - a.length)[0].trim()
    if (sentence.length >= 16) assert.ok(!source.includes(sentence), `"${key}" is written in the code: ${sentence}`)
  }
  for (const match of source.matchAll(/T\.t\('(\w+)'/g)) assert.ok(match[1] in defaults.text, `the code uses "${match[1]}", which mindmap-text.json lacks`)

  const dir = project({
    ...DOCUMENTED,
    '.devops/mindmap/text.json': JSON.stringify({
      text: { overviewTitle: '# {title} : vue d\'ensemble', overviewParts: '**Parties du code :**', nodeDocumentation: 'documentation (fr)' },
      words: { docSectionLabels: ['Paramètres'], notDocumentationStarts: ['à faire'] },
    }),
    'src/fr.ts': '/** Additionne tout.\nParamètres:\n  x le nombre */\nexport function somme(x: number) {\n  return x\n}\n// à faire: nettoyer\nexport function brouillon() {}\n',
  })
  const { overview, graph, map } = buildMindMap(dir)
  assert.match(overview, /^# Shop : vue d'ensemble/)
  assert.match(overview, /\*\*Parties du code :\*\*/)
  assert.match(overview, /\*\*Size:\*\*/, 'keys the project leaves out keep the default')
  assert.equal(graph.nodes.find(n => n.id === 'docs').name, 'documentation (fr)')
  const fr = map.files['src/fr.ts'].symbols
  assert.equal(fr.find(s => s.name === 'somme').doc, 'Additionne tout.', 'a project\'s own section label ends the summary')
  assert.equal(fr.find(s => s.name === 'brouillon').doc, undefined, 'a project\'s own not-documentation marker is skipped')

  fs.writeFileSync(path.join(dir, '.devops/mindmap/text.json'), JSON.stringify({ text: { noSuchKey: 'x' }, words: { genericNames: 'run' } }))
  assert.throws(() => loadText(dir), /unknown text key "noSuchKey".*words\.genericNames has the wrong type/)
})
