#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_ROOT, assertInside, lexists, resolveDest } from './devops-setup.mjs'
import { git } from './devops-tags.mjs'

export const STATUSES = ['PROPOSED', 'DECIDED', 'REVISED', 'IN-PROGRESS', 'DONE', 'SUPERSEDED', 'DROPPED']
export const STORY_ID = /^[A-Z]{1,6}-\d{1,4}$/
const ID_IN_TEXT = /\b[A-Z]{1,6}-\d{1,4}\b/g
const RELATIONS = {
  'depends-on': { field: 'dependsOn', inverse: 'neededBy' },
  'absorbs': { field: 'absorbs', inverse: 'absorbedBy' },
  'supersedes': { field: 'supersedes', inverse: 'supersededBy' },
  'refines': { field: 'refines', inverse: 'refinedBy' },
  'shares-contract': { field: 'sharesContract', inverse: 'sharesContract' },
}
const LIST_FIELDS = ['dependsOn', 'neededBy', 'absorbs', 'absorbedBy', 'supersedes', 'supersededBy', 'refines', 'refinedBy', 'sharesContract', 'files', 'patterns']
const storiesDir = dest => path.join(dest, '.devops', 'stories')
const idsIn = text => [...new Set(text.match(ID_IN_TEXT) ?? [])]

export function parseStory(text, { title } = {}) {
  const story = { id: null, title: title ?? null, project: null, baseline: null, status: null, statusNote: '', dependsOn: [], neededBy: [], files: [], change: null, oldBlocks: [], newBlocks: [], sections: [], hasWhy: false, hasNotVerified: false }
  story.id = /\*\*Catalog entry\s+([A-Z]{1,6}-\d{1,4})\*\*/.exec(text)?.[1] ?? (title ? /^([A-Z]{1,6}-\d{1,4})\b/.exec(title)?.[1] ?? null : null)
  if (story.title) story.title = story.title.replace(/^[A-Z]{1,6}-\d{1,4}:\s*/, '')
  story.project = /project:\s+\*\*([^*]+)\*\*/.exec(text)?.[1]?.trim() ?? null
  const rebaselined = /Re-baselined against\s+`?([\w./-]+)`?\s+`?([0-9a-f]{7,40})`?/.exec(text)
  if (rebaselined) story.baseline = { branch: rebaselined[1], sha: rebaselined[2] }

  const cell = name => new RegExp(`\\|\\s*\\*\\*${name}\\*\\*\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm').exec(text)?.[1]
  const statusCell = cell('Status')
  if (statusCell) {
    const m = /^([A-Z][A-Z-]*)\s*(?:\((.*)\))?/.exec(statusCell)
    story.status = m?.[1] ?? statusCell
    story.statusNote = m?.[2] ?? ''
  }
  story.change = cell('Change') ?? null
  story.files = (cell('File\\(s\\)') ?? '').split(/<br\s*\/?>/).map(f => f.replace(/`/g, '').trim()).filter(Boolean)
  const dependsCell = cell('Depends on')
  const neededCell = cell('Needed by')
  const withoutNotes = cellText => cellText.replace(/\([^)]*\)/g, '')
  story.dependsOn = dependsCell ? idsIn(/^\s*none\b/i.test(dependsCell) ? '' : withoutNotes(dependsCell)) : []
  story.neededBy = neededCell ? idsIn(withoutNotes(neededCell)) : []
  story.relationNotes = [...(neededCell ?? '').matchAll(/([A-Z]{1,6}-\d{1,4})\s*\(absorbs\s+([A-Z]{1,6}-\d{1,4})\)/g)].map(m => `${m[1]} absorbs ${m[2]}`)

  const labels = new Map()
  for (const m of text.matchAll(/(\w+)(?:\(\[|\[)"([^"]*)"(?:\]\)|\])/g)) labels.set(m[1], m[2])
  const flow = /```mermaid\s*\n([\s\S]*?)```/.exec(text)?.[1] ?? ''
  const graphDepends = []
  const graphNeeded = []
  for (const line of flow.split('\n')) {
    const edge = /^\s*(\w+)(?:\(\[[^\]]*\]\)|\[[^\]]*\])?\s*-->\s*(\w+)/.exec(line)
    if (!edge) continue
    const [, from, to] = edge
    if (to === 'THIS' && from !== 'THIS') graphDepends.push(idsIn(labels.get(from) ?? '')[0])
    if (from === 'THIS' && to !== 'THIS') graphNeeded.push(idsIn(labels.get(to) ?? '')[0])
  }
  story.dependsOn = [...new Set([...story.dependsOn, ...graphDepends.filter(Boolean)])]
  story.neededBy = [...new Set([...story.neededBy, ...graphNeeded.filter(Boolean)])]
  story.dependsOn = story.dependsOn.filter(id => id !== story.id)
  story.neededBy = story.neededBy.filter(id => id !== story.id)

  for (const m of text.matchAll(/\*\*OLD\*\*\s+`([^`]+)`\s+lines\s+(\d+)-(\d+)\s*\(([^)]*)\)\s*\n+```(\w*)\n([\s\S]*?)\n```/g)) {
    story.oldBlocks.push({ path: m[1], from: Number(m[2]), to: Number(m[3]), source: m[4], language: m[5], text: m[6], baselineSha: /\b([0-9a-f]{7,40})\b/.exec(m[4])?.[1] ?? null })
  }
  for (const m of text.matchAll(/\*\*NEW\*\*\s*\(([^)]*)\)/g)) story.newBlocks.push({ note: m[1], compiled: /\bcompiled\b/.test(m[1]) && !/not compiled/.test(m[1]) })
  story.sections = [...text.matchAll(/^###\s+(.+)$/gm)].map(m => m[1].trim())
  story.hasWhy = /^\*\*Why\*\*|^###\s+Why/m.test(text)
  story.hasNotVerified = /Not verified|Not run/i.test(text)
  return story
}

export function loadCatalog(destInput, roots) {
  const dest = resolveDest(destInput, roots)
  const file = path.join(storiesDir(dest), 'catalog.json')
  if (!lexists(file)) throw new Error(`no story catalog at ${file} (run the installer, or create one with story_new)`)
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  catalog.stories = (catalog.stories ?? []).map(s => ({ ...Object.fromEntries(LIST_FIELDS.map(f => [f, []])), ...s }))
  return { dest, file, catalog }
}

function saveCatalog(dest, catalog) {
  const file = path.join(storiesDir(dest), 'catalog.json')
  assertInside(dest, file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n')
  return file
}

export function emptyCatalog(code, name) {
  return { schemaVersion: 1, project: { code, name, language: '', baseline: { branch: 'main', sha: '' } }, projects: {}, stories: [] }
}

function topoLevels(stories) {
  const byId = new Map(stories.map(s => [s.id, s]))
  const level = new Map()
  const visiting = new Set()
  const cycles = []
  const visit = (id, trail) => {
    if (level.has(id)) return level.get(id)
    if (visiting.has(id)) { cycles.push([...trail.slice(trail.indexOf(id)), id]); return 0 }
    visiting.add(id)
    const deps = (byId.get(id)?.dependsOn ?? []).filter(d => byId.has(d))
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(d => visit(d, [...trail, id])))
    visiting.delete(id)
    level.set(id, value)
    return value
  }
  for (const s of stories) visit(s.id, [])
  return { level, cycles }
}

export function buildGraph(catalogs) {
  const stories = catalogs.flatMap(c => c.stories.map(s => ({ ...s, project: c.project?.code ?? s.id.split('-')[0] })))
  const byId = new Map()
  const problems = []
  const warnings = []
  for (const s of stories) {
    if (!STORY_ID.test(s.id)) problems.push(`story ${s.id}: id must look like SRV-22`)
    if (byId.has(s.id)) problems.push(`story ${s.id}: duplicate id`)
    byId.set(s.id, s)
    if (!STATUSES.includes(s.status)) problems.push(`story ${s.id}: status ${s.status} is not one of ${STATUSES.join(', ')}`)
  }
  const merged = catalogs.length > 1
  for (const s of stories) {
    for (const field of ['dependsOn', 'neededBy', 'absorbs', 'absorbedBy', 'supersedes', 'supersededBy', 'refines', 'refinedBy', 'sharesContract']) {
      for (const id of s[field]) {
        if (id === s.id) problems.push(`story ${s.id}: ${field} names itself`)
        else if (!byId.has(id)) (merged || id.split('-')[0] === s.project ? problems : warnings).push(`story ${s.id}: ${field} ${id} is not in ${merged ? 'any loaded catalog' : 'this catalog'}`)
      }
    }
    for (const [relation, { field, inverse }] of Object.entries(RELATIONS)) {
      for (const id of s[field]) {
        const other = byId.get(id)
        if (other && !other[inverse].includes(s.id)) problems.push(`inverse-missing: ${s.id} ${relation} ${id}, but ${id}.${inverse} lacks ${s.id}`)
      }
    }
    if (s.status === 'SUPERSEDED' && s.supersededBy.length === 0) problems.push(`story ${s.id}: SUPERSEDED but no supersededBy`)
    for (const dep of s.dependsOn) {
      const d = byId.get(dep)
      if (!d) continue
      if (s.status === 'DONE' && !['DONE', 'SUPERSEDED', 'DROPPED'].includes(d.status)) warnings.push(`done-before-dependency: ${s.id} is DONE but ${dep} is ${d.status}`)
      if (s.status === 'IN-PROGRESS' && ['PROPOSED'].includes(d.status)) warnings.push(`blocked: ${s.id} is in progress but ${dep} is still PROPOSED`)
    }
  }
  const { level, cycles } = topoLevels(stories)
  for (const c of cycles) problems.push(`cycle in dependsOn: ${c.join(' -> ')}`)
  const cleared = new Set(stories.filter(s => ['DONE', 'SUPERSEDED', 'DROPPED'].includes(s.status)).map(s => s.id))
  const ready = stories.filter(s => ['PROPOSED', 'DECIDED', 'REVISED'].includes(s.status) && s.dependsOn.filter(d => byId.has(d)).every(d => cleared.has(d))).map(s => s.id)
  const levels = []
  for (const s of stories) (levels[level.get(s.id) ?? 0] ??= []).push(s.id)
  const critical = (() => {
    let best = []
    const walk = (id, trail) => {
      const next = trail.length > 40 ? [] : [...trail, id]
      const users = stories.filter(x => x.dependsOn.includes(id) && !trail.includes(x.id))
      if (users.length === 0 && next.length > best.length) best = next
      for (const u of users) walk(u.id, next)
    }
    for (const s of stories.filter(x => x.dependsOn.filter(d => byId.has(d)).length === 0)) walk(s.id, [])
    return best
  })()
  const patterns = {}
  for (const s of stories) for (const p of s.patterns) (patterns[p] ??= []).push(s.id)
  const cross = []
  for (const s of stories) for (const d of s.dependsOn) if (byId.get(d) && byId.get(d).project !== s.project) cross.push({ from: d, to: s.id })

  const node = id => `s_${id.replace(/-/g, '_')}`
  const lines = ['flowchart LR']
  for (const s of stories) lines.push(`  ${node(s.id)}["${s.id}: ${(s.title ?? '').replace(/["\[\]]/g, '').slice(0, 44)}<br/>${s.status}"]:::${s.status.toLowerCase().replace(/[^a-z]/g, '')}`)
  for (const s of stories) for (const d of s.dependsOn) if (byId.has(d)) lines.push(`  ${node(d)} ${byId.get(d).project !== s.project ? '-.->' : '-->'} ${node(s.id)}`)
  for (const s of stories) for (const a of s.absorbs) if (byId.has(a)) lines.push(`  ${node(s.id)} -. absorbs .-> ${node(a)}`)
  lines.push('  classDef done fill:#d4edda,stroke:#2e7d32', '  classDef proposed fill:#fff3cd,stroke:#b8860b', '  classDef decided fill:#d1ecf1,stroke:#0c5460', '  classDef revised fill:#e2d9f3,stroke:#5b3e96', '  classDef inprogress fill:#cfe2ff,stroke:#084298', '  classDef superseded fill:#eee,stroke:#888', '  classDef dropped fill:#eee,stroke:#888')
  return { stories: stories.length, projects: catalogs.map(c => c.project?.code), levels, ready, critical, crossProject: cross, patterns, problems, warnings, mermaid: lines.join('\n') }
}

function replaceTokens(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '')
}

export function newStory(destInput, spec, { apply = false, roots } = {}) {
  const { dest, catalog } = loadCatalog(destInput, roots)
  const id = spec?.id
  if (!STORY_ID.test(id ?? '')) throw new Error(`id must look like ${catalog.project.code}-01`)
  if (catalog.stories.some(s => s.id === id)) throw new Error(`story ${id} already exists`)
  const status = spec.status ?? 'PROPOSED'
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
  const title = String(spec.title ?? '').trim()
  if (title === '' || title.length > 160 || /[\n\r]/.test(title)) throw new Error('title must be one line under 160 characters')
  const list = name => (spec[name] ?? []).map(String).filter(x => STORY_ID.test(x))
  const entry = {
    id, title, status, statusNote: spec.statusNote ?? '', dependsOn: list('dependsOn'), neededBy: list('neededBy'), absorbs: list('absorbs'), absorbedBy: [], supersedes: list('supersedes'), supersededBy: [], refines: list('refines'), refinedBy: [], sharesContract: list('sharesContract'),
    files: (spec.files ?? []).map(String).slice(0, 40), change: spec.change ?? '', issue: Number.isInteger(spec.issue) ? spec.issue : null, file: `${id}.md`, patterns: (spec.patterns ?? []).map(String).filter(p => /^[a-z][a-z0-9-]*$/.test(p)), decisions: [],
  }
  const baseline = catalog.project.baseline?.sha ? `${catalog.project.baseline.branch} ${catalog.project.baseline.sha}` : `${catalog.project.baseline?.branch ?? 'main'} <sha>`
  const edges = [...entry.dependsOn.map(d => `${d.replace(/-/g, '')}["${d}"] --> THIS`), ...entry.neededBy.map(n => `THIS --> ${n.replace(/-/g, '')}["${n}"]`)].join('\n  ')
  const template = fs.readFileSync(path.join(PACKAGE_ROOT, 'skills', 'devops-multi-agent-team', 'references', 'story-template.md'), 'utf8')
  const body = replaceTokens(template, {
    ID: id, PROJECT: `${catalog.project.name}${catalog.project.language ? ` · ${catalog.project.language}` : ''}`, BASELINE: baseline, STATUS: entry.statusNote ? `${status} (${entry.statusNote})` : status,
    DEPENDENCY_EDGES: edges || 'THIS', DEPENDS_ON: entry.dependsOn.join(', ') || 'none', NEEDED_BY: entry.neededBy.join(', ') || 'none',
  })
  const target = path.join(storiesDir(dest), entry.file)
  if (apply) {
    if (lexists(target)) throw new Error(`${entry.file} already exists`)
    assertInside(dest, target)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `# ${id}: ${title}\n\n${body}`)
    catalog.stories.push(entry)
    saveCatalog(dest, catalog)
  }
  return { dest, applied: apply, story: entry, file: path.relative(dest, target) }
}

export function linkStories(destInput, { from, to, relation }, { apply = false, roots } = {}) {
  const rel = RELATIONS[relation]
  if (!rel) throw new Error(`relation must be one of ${Object.keys(RELATIONS).join(', ')}`)
  for (const id of [from, to]) if (!STORY_ID.test(id ?? '')) throw new Error(`not a story id: ${id}`)
  if (from === to) throw new Error('a story cannot relate to itself')
  const { dest, catalog } = loadCatalog(destInput, roots)
  const a = catalog.stories.find(s => s.id === from)
  const b = catalog.stories.find(s => s.id === to)
  if (!a && !b) throw new Error(`neither ${from} nor ${to} is in this catalog`)
  const changes = []
  if (a && !a[rel.field].includes(to)) { a[rel.field].push(to); changes.push(`${from}.${rel.field} += ${to}`) }
  if (b && !b[rel.inverse].includes(from)) { b[rel.inverse].push(from); changes.push(`${to}.${rel.inverse} += ${from}`) }
  const graph = buildGraph([catalog])
  const cycle = graph.problems.filter(p => p.startsWith('cycle'))
  if (cycle.length > 0) throw new Error(`that link would create a ${cycle[0]}`)
  if (apply && changes.length > 0) saveCatalog(dest, catalog)
  return { applied: apply && changes.length > 0, changes, foreign: [!a && from, !b && to].filter(Boolean) }
}

export function checkStory(destInput, idOrFile, { ref, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const dir = storiesDir(dest)
  const file = path.join(dir, /^[A-Z]{1,6}-\d{1,4}$/.test(idOrFile) ? `${idOrFile}.md` : path.basename(idOrFile))
  assertInside(dest, file)
  const text = fs.readFileSync(file, 'utf8')
  const story = parseStory(text)
  const repoName = path.basename(dest).toLowerCase()
  const problems = []
  const blocks = story.oldBlocks.map(block => {
    const chosen = ref ?? block.baselineSha ?? story.baseline?.sha ?? 'HEAD'
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}(?:[~^]\d{0,3})*$/.test(chosen)) return { path: block.path, status: 'bad-ref', ref: chosen }
    const candidates = [block.path, block.path.split('/').slice(1).join('/')].filter(p => p && !p.includes('..') && !path.isAbsolute(p))
    if (block.path.split('/')[0].toLowerCase() !== repoName && candidates.length > 1) candidates.pop()
    let content = null
    let usedRef = chosen
    for (const candidate of candidates) {
      let shown = git(dest, ['show', `${chosen}:${candidate}`])
      if (!shown.ok && chosen !== 'HEAD') { shown = git(dest, ['show', `HEAD:${candidate}`]); if (shown.ok) usedRef = 'HEAD' }
      if (shown.ok) { content = shown.out; break }
    }
    if (content === null) return { path: block.path, status: 'missing', ref: chosen }
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    if (block.to > lines.length) return { path: block.path, status: 'out-of-range', fileLines: lines.length, ref: usedRef }
    const actual = lines.slice(block.from - 1, block.to).map(l => l.replace(/\s+$/, ''))
    const claimed = block.text.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''))
    const diffAt = claimed.findIndex((l, i) => l !== actual[i])
    if (diffAt === -1 && claimed.length === actual.length) return { path: block.path, status: 'verbatim', ref: usedRef, from: block.from, to: block.to }
    const at = diffAt === -1 ? claimed.length : diffAt
    return { path: block.path, status: 'changed', ref: usedRef, from: block.from, to: block.to, firstDifferentLine: block.from + at, claimed: claimed[at] ?? '(block is shorter)', actual: actual[at] ?? '(file range is shorter)' }
  })
  for (const b of blocks) if (b.status !== 'verbatim') problems.push(`OLD block ${b.path}: ${b.status}${b.firstDifferentLine ? ` at line ${b.firstDifferentLine}` : ''}`)
  const template = fs.readFileSync(path.join(PACKAGE_ROOT, 'skills', 'devops-multi-agent-team', 'references', 'story-template.md'), 'utf8')
  const placeholders = [...new Set(template.match(/<[^<>\n]{3,}>/g) ?? [])].filter(token => !/^<\/?br/.test(token) && text.includes(token))
  for (const token of placeholders.slice(0, 5)) problems.push(`unfilled template placeholder ${token.slice(0, 40)}`)
  if (story.oldBlocks.length === 0 && !/\(NEW\)|^new files|^new file/i.test(story.change ?? '')) problems.push('no OLD block (a story that changes existing code needs one)')
  if (story.newBlocks.length === 0) problems.push('no NEW block')
  for (const b of story.newBlocks) if (!/proposal|compiled/i.test(b.note)) problems.push('a NEW block does not say whether it was compiled')
  if (!story.hasWhy) problems.push('no Why section')
  if (!story.hasNotVerified) problems.push('no "Not verified" statement')
  if (!story.sections.some(s => /^Dependencies/i.test(s))) problems.push('no Dependencies section')
  return { story: { id: story.id, status: story.status, dependsOn: story.dependsOn, neededBy: story.neededBy }, blocks, problems, ok: problems.length === 0 }
}

export function guidance(destInput, { apply = false, roots } = {}) {
  const { dest, catalog } = loadCatalog(destInput, roots)
  const graph = buildGraph([catalog])
  const byId = new Map(catalog.stories.map(s => [s.id, s]))
  const out = [`# Story guidance: ${catalog.project.name}`, '', 'How the stories in this catalog relate, and what a future story should reuse. Generated from `catalog.json`; edit the stories, not this file.', '']
  out.push('## Dependency order', '')
  graph.levels.forEach((ids, i) => out.push(`${i}. ${ids.map(id => `${id} (${byId.get(id)?.status})`).join(', ')}`))
  out.push('', `Ready to start: ${graph.ready.join(', ') || 'none'}`, `Longest chain: ${graph.critical.join(' → ') || 'none'}`, '')
  out.push('## Patterns', '')
  for (const [p, ids] of Object.entries(graph.patterns).sort()) out.push(`- **${p}**: ${ids.map(id => `${id} ${byId.get(id)?.title ?? ''}`.trim()).join('; ')}`)
  if (Object.keys(graph.patterns).length === 0) out.push('_None recorded yet. Fill in each story\'s Guidance section and its `patterns` tags._')
  out.push('', '## Decisions', '')
  const decisions = catalog.stories.flatMap(s => (s.decisions ?? []).map(d => `- **${s.id}** ${d.q} → ${d.a}`))
  out.push(...(decisions.length > 0 ? decisions : ['_None recorded yet._']))
  out.push('', '## Cross-project links', '')
  out.push(...(graph.crossProject.length > 0 ? graph.crossProject.map(c => `- ${c.from} → ${c.to}`) : ['_None._']))
  out.push('', '## Graph', '', '```mermaid', graph.mermaid, '```', '')
  const target = path.join(storiesDir(dest), 'guidance.md')
  if (apply) {
    assertInside(dest, target)
    fs.writeFileSync(target, out.join('\n'))
  }
  return { applied: apply, file: path.relative(dest, target), patterns: Object.keys(graph.patterns).length, text: out.join('\n') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  try {
    let result
    if (command === 'parse') result = parseStory(fs.readFileSync(argv[0], 'utf8'), { title: opt('--title') })
    else if (command === 'graph') result = buildGraph([dest, ...argv.filter((a, i) => argv[i - 1] === '--with')].map(d => loadCatalog(d.startsWith('/') ? d : path.resolve(d)).catalog))
    else if (command === 'check') result = checkStory(dest, argv[0], { ref: opt('--ref') })
    else if (command === 'guide') result = guidance(dest, { apply: argv.includes('--apply') })
    else throw new Error('usage: devops-stories parse FILE | graph [--dest D] [--with D2] | check ID [--ref REF] | guide [--apply]')
    console.log(JSON.stringify(result, null, 2))
    if (result.problems?.length > 0) process.exitCode = 1
  } catch (error) {
    console.error(`devops-stories: ${error.message}`)
    process.exitCode = 2
  }
}
