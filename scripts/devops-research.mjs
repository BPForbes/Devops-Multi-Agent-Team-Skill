#!/usr/bin/env node
// Research helpers: a module map (Mermaid) and a reuse search. Read-only, in-process, no subprocess,
// no network. Used by the MCP tools `module_map` and `reuse_search` and by the Researcher seat.
//
//   node scripts/devops-research.mjs module-map --dest DIR [--json]
//   node scripts/devops-research.mjs reuse-search --dest DIR term [term...]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLanguages, resolveDest, walk } from './devops-setup.mjs'

const CONTAINERS = new Set(['src', 'packages', 'crates', 'apps', 'services', 'lib', 'libs', 'internal', 'cmd', 'modules', 'projects', 'plugins', 'drivers', 'kernel', 'userland'])
const MAX_FILE_BYTES = 200 * 1024
const MAX_SEARCH_BYTES = 512 * 1024
const MAX_FILES_READ = 3000
const MAX_FILES_SEARCHED = 6000
const DOC_EXTENSIONS = ['.md', '.markdown', '.tex', '.rst', '.adoc', '.txt']
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|kqkey|kqcert|kqrl|kqpb)|id_(rsa|dsa|ecdsa|ed25519)|credentials?(\..*)?|secrets?(\..*)?)$/i
const SECRET_VALUE = /((?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*)(["']?)[^\s"',;]{4,}/gi

function extensionTable(dest) {
  const table = new Map()
  for (const lang of loadLanguages(dest).languages) for (const ext of lang.detect?.extensions ?? []) if (!table.has(ext)) table.set(ext, lang.id)
  return table
}

const languageOf = (rel, table) => {
  const lower = rel.toLowerCase()
  let best
  for (const [ext, id] of table) if (lower.endsWith(ext.toLowerCase()) && (best === undefined || ext.length > best.ext.length)) best = { ext, id }
  return best?.id
}

/** The module a repository-relative path belongs to: its top-level directory, or the one under a container directory. */
export function moduleOf(rel) {
  const parts = rel.split('/')
  if (parts.length === 1) return '(root)'
  if (CONTAINERS.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`
  return parts[0]
}

const safeId = id => 'm_' + id.replace(/[^A-Za-z0-9]/g, '_')
const safeLabel = text => text.replace(/["\[\]()]/g, '')

function importsOf(rel, text, language) {
  const dir = path.posix.dirname(rel)
  const out = []
  const relative = spec => path.posix.normalize(path.posix.join(dir, spec))
  const add = target => { if (target && !target.startsWith('..')) out.push(target) }
  if (['typescript', 'javascript'].includes(language)) {
    for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*|import\s+)['"](\.{1,2}\/[^'"]*)['"]/g)) add(relative(m[1]))
  } else if (language === 'python') {
    for (const m of text.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import/gm)) add(path.posix.normalize(path.posix.join(dir, '../'.repeat(m[1].length - 1), m[2].replace(/\./g, '/'))))
    for (const m of text.matchAll(/^\s*(?:from|import)\s+([A-Za-z_]\w*)/gm)) out.push({ name: m[1] })
  } else if (['c', 'cpp'].includes(language)) {
    for (const m of text.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)) { add(relative(m[1])); out.push({ rootRelative: m[1] }) }
  } else if (language === 'rust') {
    for (const m of text.matchAll(/^\s*(?:pub\s+)?(?:use|extern\s+crate)\s+([A-Za-z_]\w*)/gm)) out.push({ name: m[1] })
  } else if (language === 'go') {
    for (const m of text.matchAll(/"([\w./-]+\/[\w./-]+)"/g)) out.push({ segments: m[1].split('/') })
  } else if (language === 'terraform') {
    for (const m of text.matchAll(/source\s*=\s*"(\.{1,2}\/[^"]+)"/g)) add(relative(m[1]))
  } else if (language === 'csharp' && rel.endsWith('.csproj')) {
    for (const m of text.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) add(path.posix.dirname(relative(m[1].replace(/\\/g, '/'))))
  }
  return out
}

/** Modules, their languages and the imports between them, as data and as a Mermaid graph. */
export function moduleMap(destInput, roots) {
  const dest = resolveDest(destInput, roots)
  const found = walk(dest)
  const table = extensionTable(dest)
  const modules = new Map()
  const moduleNames = new Map()
  for (const rel of found.files) {
    const id = moduleOf(rel)
    const entry = modules.get(id) ?? { id, files: 0, languages: {}, manifests: [] }
    entry.files += 1
    const language = languageOf(rel, table)
    if (language) entry.languages[language] = (entry.languages[language] ?? 0) + 1
    const name = rel.split('/').pop()
    if (['package.json', 'Cargo.toml', 'go.mod', 'pom.xml', 'pyproject.toml', 'composer.json', 'Gemfile', 'mix.exs', 'pubspec.yaml', 'CMakeLists.txt', 'Makefile'].includes(name) || /\.(csproj|fsproj|sln)$/.test(name)) entry.manifests.push(name)
    modules.set(id, entry)
  }
  for (const id of modules.keys()) moduleNames.set(id.split('/').pop().replace(/-/g, '_').toLowerCase(), id)

  const edges = new Map()
  let read = 0
  for (const rel of found.files) {
    const language = languageOf(rel, table)
    if (!language && !rel.endsWith('.csproj')) continue
    if (read >= MAX_FILES_READ) break
    const full = path.join(dest, rel)
    let text
    try {
      if (fs.statSync(full).size > MAX_FILE_BYTES) continue
      text = fs.readFileSync(full, 'utf8')
    } catch { continue }
    read += 1
    const from = moduleOf(rel)
    for (const imp of importsOf(rel, text, rel.endsWith('.csproj') ? 'csharp' : language)) {
      let to
      if (typeof imp === 'string') to = moduleOf(imp)
      else if (imp.rootRelative) to = moduleOf(imp.rootRelative)
      else if (imp.name) to = moduleNames.get(imp.name.toLowerCase())
      else if (imp.segments) to = imp.segments.map(seg => moduleNames.get(seg.toLowerCase())).find(Boolean)
      if (to && modules.has(to) && to !== from) {
        const key = `${from}\u0000${to}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
  }

  const list = [...modules.values()].sort((a, b) => b.files - a.files)
  const shown = list.slice(0, 40)
  const shownIds = new Set(shown.map(m => m.id))
  const edgeList = [...edges].map(([key, count]) => { const [from, to] = key.split('\u0000'); return { from, to, count } }).filter(e => shownIds.has(e.from) && shownIds.has(e.to)).sort((a, b) => b.count - a.count).slice(0, 120)
  const lines = ['graph TD']
  for (const m of shown) {
    const langs = Object.entries(m.languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l).join(', ')
    lines.push(`  ${safeId(m.id)}["${safeLabel(m.id)}<br/>${m.files} files${langs ? ' — ' + safeLabel(langs) : ''}"]`)
  }
  for (const e of edgeList) lines.push(`  ${safeId(e.from)} -->|${e.count}| ${safeId(e.to)}`)
  return { dest, modules: list, edges: edgeList, truncated: list.length > shown.length || edges.size > edgeList.length, mermaid: lines.join('\n'), note: 'Edges come from relative imports, includes, crate/package names and project references; reflection, dynamic imports and namespaces are not seen. Add extension points and forbidden edges by hand from the docs.' }
}

const DECLARATION = /^\s*(?:export\s+|pub(?:\([^)]*\))?\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|abstract\s+|final\s+)*(?:def|fn|func|function|class|struct|interface|trait|enum|impl|type|const|let|var|module|defmodule|defp?|sub|proc|procedure|record|object)\b/
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#|--|;|!|'''|"""|%|\(\*|<!--)/

const redact = line => line.replace(SECRET_VALUE, '$1$2***')

/** Where each term (or a spelling variant of it) already appears, grouped as definition, doc or use. */
export function reuseSearch(destInput, terms, roots, { maxPerTerm = 20 } = {}) {
  const dest = resolveDest(destInput, roots)
  if (!Array.isArray(terms) || terms.length === 0 || terms.length > 12) throw new Error('give 1 to 12 terms')
  for (const term of terms) if (typeof term !== 'string' || !/^[A-Za-z0-9_.:$ -]{2,60}$/.test(term)) throw new Error(`term not searchable: ${JSON.stringify(term)}`)
  const found = walk(dest)
  const table = extensionTable(dest)
  const wanted = terms.map(term => ({ term, lower: term.toLowerCase(), squashed: term.toLowerCase().replace(/[\s_.\-:$]/g, '') }))
  const results = wanted.map(w => ({ term: w.term, files: new Set(), matches: [] }))
  let searched = 0
  for (const rel of found.files) {
    if (searched >= MAX_FILES_SEARCHED) break
    if (SECRET_FILE.test(rel)) continue
    const isDoc = DOC_EXTENSIONS.some(ext => rel.toLowerCase().endsWith(ext))
    if (!isDoc && !languageOf(rel, table)) continue
    const full = path.join(dest, rel)
    let text
    try {
      if (fs.statSync(full).size > MAX_SEARCH_BYTES) continue
      text = fs.readFileSync(full, 'utf8')
    } catch { continue }
    if (text.includes('\0')) continue
    searched += 1
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase()
      const squashed = lower.replace(/[\s_.\-:$]/g, '')
      for (let w = 0; w < wanted.length; w++) {
        const hit = lower.includes(wanted[w].lower) || (wanted[w].squashed.length >= 4 && squashed.includes(wanted[w].squashed))
        if (!hit) continue
        results[w].files.add(rel)
        if (results[w].matches.length < maxPerTerm) {
          const kind = isDoc ? 'doc' : COMMENT.test(lines[i]) ? 'doc' : DECLARATION.test(lines[i]) ? 'definition' : 'use'
          results[w].matches.push({ file: rel, line: i + 1, kind, text: redact(lines[i].trim()).slice(0, 160) })
        }
      }
    }
  }
  const order = { definition: 0, doc: 1, use: 2 }
  return {
    dest, searchedFiles: searched,
    results: results.map(r => ({ term: r.term, files: r.files.size, matches: r.matches.sort((a, b) => order[a.kind] - order[b.kind]) })),
    note: 'Name matches only. Also look for the same behaviour under another name (callers of the nearest neighbour) before writing "new, because ...".',
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const command = args.shift()
  const destIndex = args.indexOf('--dest')
  const dest = destIndex === -1 ? process.cwd() : path.resolve(args.splice(destIndex, 2)[1])
  const json = args.includes('--json') && args.splice(args.indexOf('--json'), 1)
  try {
    if (command === 'module-map') {
      const result = moduleMap(dest)
      console.log(json ? JSON.stringify(result) : result.mermaid)
    } else if (command === 'reuse-search') {
      console.log(JSON.stringify(reuseSearch(dest, args), null, 2))
    } else {
      console.error('usage: devops-research module-map|reuse-search --dest DIR [terms...]')
      process.exitCode = 2
    }
  } catch (error) {
    console.error(`devops-research: ${error.message}`)
    process.exitCode = 1
  }
}
