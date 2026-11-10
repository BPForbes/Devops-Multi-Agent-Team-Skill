#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInside, resolveDest, walk } from './devops-setup.mjs'
import { SECRET_FILE, extensionTable, languageOf, moduleOf, redact, safeId, safeLabel } from './devops-research.mjs'

export const MINDMAP_DIR = path.join('.devops', 'mindmap')
const MAP_FILE = 'mindmap.json'
const SUMMARY_FILE = 'MINDMAP.md'
const FORMAT = 1
const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 4000
const MAX_SYMBOLS_PER_FILE = 200
const MAX_SIGNATURE = 140
const DOC_EXTENSIONS = ['.md', '.markdown', '.rst', '.tex', '.adoc']
const IGNORED_PREFIXES = ['.devops/mindmap/', 'devops-skill/thoughts/']
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+$|_test\.[^/]+$/i
const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx', '.py', '.h', '.hpp', '.d.ts', '/index.ts', '/index.tsx', '/index.d.ts', '/index.js', '/index.mjs', '/__init__.py']
const NODE_BUILTINS = new Set(builtinModules.map(name => name.replace(/^node:/, '').split('/')[0]))
/** Names too generic to link: a call to `run(` says nothing about which `run` it is. */
const GENERIC_NAMES = new Set(['main', 'init', 'new', 'get', 'set', 'run', 'start', 'stop', 'call', 'apply', 'test', 'setup', 'teardown', 'constructor', 'toString', 'render', 'update', 'create', 'handle', 'execute', 'process', 'build', 'load', 'save', 'read', 'write', 'open', 'close', 'parse', 'format', 'check', 'reset', 'clear', 'size', 'len', 'next', 'value', 'default', 'index', 'describe', 'it', 'expect', 'assert', 'if', 'for', 'while', 'switch', 'return', 'catch', 'function', 'super', 'self', 'this', 'print', 'println', 'printf', 'require', 'import', 'export', 'from', 'type'])

const isDoc = rel => DOC_EXTENSIONS.some(ext => rel.toLowerCase().endsWith(ext))
const hashOf = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)
const tracked = rel => !SECRET_FILE.test(rel) && !IGNORED_PREFIXES.some(prefix => rel.startsWith(prefix))

/**
 * Declaration patterns per language. Group 1 is always the name; `kind` is what
 * the line declares. Heuristic: no parser, so a macro or generated code is missed.
 */
const JS_LIKE = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, 'function'],
  [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
  [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/, 'type'],
  [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'enum'],
  [/^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b|function\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/, 'method'],
]
const C_FAMILY_TYPES = [[/^\s*(?:typedef\s+)?(?:struct|union|enum|class)\s+([A-Za-z_]\w*)\s*(?:[:{]|$)/, 'type']]
const JVM_LIKE = [
  [/^\s*(?:@\w+\s+)*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|readonly)\s+)*(?:class|interface|enum|record|struct|object|trait)\s+([A-Za-z_]\w*)/, 'class'],
  [/^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized|suspend|inline|open)\s+)+(?:<[^>]+>\s+)?[\w<>\[\],.? ]+?\s+([A-Za-z_]\w*)\s*\([^;]*$/, 'method'],
  [/^\s*(?:(?:public|private|protected|internal|override|suspend|inline|open)\s+)*fun\s+(?:<[^>]+>\s+)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/, 'function'],
  [/^\s*(?:(?:private|protected|override|final)\s+)*def\s+([A-Za-z_]\w*)/, 'function'],
]
const PATTERNS = {
  typescript: JS_LIKE,
  javascript: JS_LIKE,
  python: [[/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, 'function', 2], [/^(\s*)class\s+([A-Za-z_]\w*)/, 'class', 2]],
  go: [[/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, 'function'], [/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, 'type'], [/^type\s+([A-Za-z_]\w*)\s/, 'type']],
  rust: [[/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/, 'function'], [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union|type)\s+([A-Za-z_]\w*)/, 'type'], [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*\{/, 'module']],
  c: [...C_FAMILY_TYPES, [/^(?!\s)(?!return\b|if\b|else\b|while\b|for\b|switch\b|typedef\b|#)[\w\s*&:<>,]+?[\s*&]([A-Za-z_]\w*)\s*\([^;]*$/, 'function']],
  cpp: [...C_FAMILY_TYPES, [/^\s*namespace\s+([A-Za-z_]\w*)/, 'module'], [/^(?!\s)(?!return\b|if\b|else\b|while\b|for\b|switch\b|typedef\b|#)[\w\s*&:<>,~]+?[\s*&:]([A-Za-z_~]\w*)\s*\([^;]*$/, 'function']],
  java: JVM_LIKE, kotlin: JVM_LIKE, scala: JVM_LIKE, csharp: JVM_LIKE, fsharp: [[/^\s*(?:let|member)\s+(?:rec\s+|inline\s+|private\s+)*(?:\w+\.)?([A-Za-z_]\w*)/, 'function'], [/^\s*type\s+([A-Za-z_]\w*)/, 'type'], [/^\s*module\s+([A-Za-z_][\w.]*)/, 'module']],
  swift: [[/^\s*(?:(?:public|private|internal|open|fileprivate|static|final|override|mutating)\s+)*func\s+([A-Za-z_]\w*)/, 'function'], [/^\s*(?:(?:public|private|internal|open|final)\s+)*(?:class|struct|enum|protocol|actor|extension)\s+([A-Za-z_]\w*)/, 'type']],
  dart: [[/^\s*(?:abstract\s+)?(?:class|mixin|enum|extension)\s+([A-Za-z_]\w*)/, 'class'], [/^\s*(?:static\s+)?(?:Future<[^>]*>|[\w<>?]+)\s+([A-Za-z_]\w*)\s*\([^;]*\{?\s*$/, 'function']],
  ruby: [[/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/, 'function'], [/^\s*(?:class|module)\s+([A-Z]\w*)/, 'class']],
  php: [[/^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+([A-Za-z_]\w*)/, 'function'], [/^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/, 'class']],
  perl: [[/^\s*sub\s+([A-Za-z_]\w*)/, 'function'], [/^\s*package\s+([\w:]+)/, 'module']],
  lua: [[/^\s*(?:local\s+)?function\s+(?:[\w.:]+[.:])?([A-Za-z_]\w*)/, 'function']],
  elixir: [[/^\s*defp?\s+([a-z_]\w*[?!]?)/, 'function'], [/^\s*defmodule\s+([\w.]+)/, 'module']],
  erlang: [[/^([a-z]\w*)\s*\(.*\)\s*(?:when\b.*)?->/, 'function']],
  haskell: [[/^([a-z_]\w*)\s*::/, 'function'], [/^(?:data|newtype|class|type)\s+([A-Z]\w*)/, 'type']],
  ocaml: [[/^\s*let\s+(?:rec\s+)?([a-z_]\w*)/, 'function'], [/^\s*(?:type|module)\s+([A-Za-z_]\w*)/, 'type']],
  julia: [[/^\s*function\s+([A-Za-z_]\w*!?)/, 'function'], [/^\s*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/, 'type']],
  r: [[/^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\b/, 'function']],
  shell: [[/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/, 'function'], [/^\s*function\s+([A-Za-z_][\w-]*)/, 'function']],
  powershell: [[/^\s*function\s+([A-Za-z_][\w-]*)/i, 'function'], [/^\s*class\s+([A-Za-z_]\w*)/i, 'class']],
  zig: [[/^\s*(?:pub\s+)?(?:inline\s+)?fn\s+([A-Za-z_]\w*)/, 'function'], [/^\s*(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:struct|enum|union)/, 'type']],
  gdscript: [[/^\s*(?:static\s+)?func\s+([A-Za-z_]\w*)/, 'function'], [/^\s*class(?:_name)?\s+([A-Za-z_]\w*)/, 'class']],
  sql: [[/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure|view|table|trigger)\s+(?:if\s+not\s+exists\s+)?([\w.]+)/i, 'function']],
  terraform: [[/^\s*(?:resource|data)\s+"[\w-]+"\s+"([\w-]+)"/, 'resource'], [/^\s*module\s+"([\w-]+)"/, 'module'], [/^\s*variable\s+"([\w-]+)"/, 'variable']],
}

function isExported(language, line, name, indent) {
  if (['typescript', 'javascript'].includes(language)) return /^\s*export\b/.test(line)
  if (language === 'python') return indent === 0 && !name.startsWith('_')
  if (language === 'go') return /^[A-Z]/.test(name)
  if (language === 'rust' || language === 'zig') return /^\s*pub\b/.test(line)
  if (['java', 'kotlin', 'scala', 'csharp', 'swift', 'php', 'dart'].includes(language)) return !/\b(private|fileprivate|internal)\b/.test(line) && !name.startsWith('_')
  if (language === 'elixir') return !/^\s*defp\b/.test(line)
  return true
}

export function symbolsOf(text, language) {
  const patterns = PATTERNS[language]
  if (!patterns) return []
  const symbols = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && symbols.length < MAX_SYMBOLS_PER_FILE; i++) {
    const line = lines[i]
    if (/^\s*(?:\/\/|#(?!include)|\*|\/\*|--)/.test(line) && language !== 'c' && language !== 'cpp') continue
    for (const [pattern, kind, group = 1] of patterns) {
      const m = line.match(pattern)
      if (!m) continue
      const name = m[group]
      if (!name || GENERIC_NAMES.has(name) && kind === 'method') break
      const indent = (line.match(/^\s*/)?.[0] ?? '').length
      const resolvedKind = language === 'python' && kind === 'function' && indent > 0 ? 'method' : kind
      symbols.push({ name, kind: resolvedKind, line: i + 1, end: i + 1, exported: isExported(language, line, name, indent), signature: redact(line.trim()).slice(0, MAX_SIGNATURE), indent })
      break
    }
  }
  symbols.forEach((s, i) => {
    const sibling = symbols.slice(i + 1).find(next => next.indent <= s.indent)
    s.end = Math.min(endOf(lines, s.line - 1, language, s.indent), sibling ? sibling.line - 1 : lines.length)
  })
  const callable = kind => kind === 'function' || kind === 'method'
  return symbols
    .filter(s => !symbols.some(outer => outer !== s && callable(outer.kind) && outer.line < s.line && outer.end >= s.end))
    .map(({ indent, ...s }) => s)
}

const INDENT_BLOCKS = new Set(['python', 'gdscript', 'fsharp', 'haskell'])
const END_KEYWORD = new Set(['ruby', 'lua', 'elixir', 'julia'])

/** Last line of the declaration starting at index `start`: by indentation, `end` keywords or brace balance. */
function endOf(lines, start, language, indent) {
  const blank = line => line.trim() === '' || /^\s*(#|--|\/\/)/.test(line)
  const width = line => (line.match(/^\s*/)?.[0] ?? '').length
  if (INDENT_BLOCKS.has(language) || END_KEYWORD.has(language)) {
    let last = start
    for (let i = start + 1; i < lines.length; i++) {
      if (blank(lines[i])) continue
      if (width(lines[i]) <= indent) return END_KEYWORD.has(language) && /^\s*end\b/.test(lines[i]) ? i + 1 : last + 1
      last = i
    }
    return last + 1
  }
  let depth = 0
  let opened = false
  for (let i = start; i < lines.length; i++) {
    if (!opened && i > start && (i - start >= 3 || !blank(lines[i]) && width(lines[i]) <= indent)) return i
    const code = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '')
    for (const ch of code) {
      if (ch === '{') { depth += 1; opened = true } else if (ch === '}') depth -= 1
    }
    if (opened && depth <= 0) return i + 1
    if (i === start && !opened && !/(?:[=(,{[:]|=>)\s*$/.test(code.trimEnd())) return start + 1
  }
  return opened ? lines.length : start + 1
}

function packageRoot(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/')
  return spec.split('/')[0]
}

/** Raw import statements: relative specs to resolve to files, and bare names (libraries or local packages). */
function rawImports(rel, text, language) {
  const relative = []
  const bare = []
  if (['typescript', 'javascript'].includes(language)) {
    for (const m of text.matchAll(/(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)) {
      if (m[1].startsWith('.')) relative.push(m[1])
      else bare.push(m[1].startsWith('node:') ? m[1] : packageRoot(m[1]))
    }
  } else if (language === 'python') {
    for (const m of text.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import\s+([\w, ]+)/gm)) {
      const base = '../'.repeat(m[1].length - 1) + m[2].replace(/\./g, '/')
      relative.push(base === '' ? '.' : base.startsWith('../') ? base : './' + base)
      if (m[2] === '') for (const name of m[3].split(',').map(s => s.trim()).filter(Boolean)) relative.push('./' + name)
    }
    for (const m of text.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import/gm)) bare.push(m[1])
    for (const m of text.matchAll(/^\s*import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*)/gm)) for (const name of m[1].split(',')) bare.push(name.trim())
  } else if (['c', 'cpp'].includes(language)) {
    for (const m of text.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)) relative.push(m[1].startsWith('.') ? m[1] : './' + m[1])
    for (const m of text.matchAll(/^\s*#\s*include\s+<([^>]+)>/gm)) bare.push('<' + m[1] + '>')
  } else if (language === 'rust') {
    for (const m of text.matchAll(/^\s*(?:pub\s+)?(?:use|extern\s+crate)\s+([A-Za-z_]\w*)/gm)) if (!['crate', 'self', 'super', 'std', 'core', 'alloc'].includes(m[1])) bare.push(m[1])
    for (const m of text.matchAll(/^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm)) relative.push('./' + m[1] + '.rs', './' + m[1] + '/mod.rs')
  } else if (language === 'go') {
    const block = text.match(/^import\s*\(([\s\S]*?)\)/m)?.[1] ?? ''
    for (const m of (block + '\n' + [...text.matchAll(/^import\s+(?:\w+\s+)?"[^"]+"/gm)].map(x => x[0]).join('\n')).matchAll(/"([^"]+)"/g)) bare.push(m[1])
  } else if (['java', 'kotlin', 'scala'].includes(language)) {
    for (const m of text.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)/gm)) bare.push(m[1])
  } else if (language === 'csharp') {
    for (const m of text.matchAll(/^\s*using\s+(?:static\s+)?([A-Z][\w.]*)\s*;/gm)) bare.push(m[1])
  } else if (language === 'ruby') {
    for (const m of text.matchAll(/^\s*require_relative\s+['"]([^'"]+)['"]/gm)) relative.push((m[1].startsWith('.') ? m[1] : './' + m[1]) + (m[1].endsWith('.rb') ? '' : '.rb'))
    for (const m of text.matchAll(/^\s*require\s+['"]([^'"]+)['"]/gm)) bare.push(m[1].split('/')[0])
  } else if (language === 'php') {
    for (const m of text.matchAll(/^\s*use\s+([A-Z][\w\\]*)/gm)) bare.push(m[1].split('\\')[0])
    for (const m of text.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*__DIR__\s*\.\s*['"]\/?([^'"]+)['"]/g)) relative.push('./' + m[1])
  } else if (language === 'terraform') {
    for (const m of text.matchAll(/source\s*=\s*"(\.{1,2}\/[^"]+)"/g)) relative.push(m[1])
  } else if (language === 'shell') {
    for (const m of text.matchAll(/^\s*(?:source|\.)\s+["']?(\.{0,2}\/?[\w./-]+\.(?:sh|bash))/gm)) relative.push(m[1].startsWith('.') ? m[1] : './' + m[1])
  }
  return { relative, bare }
}

function resolveRelative(fromRel, spec, fileSet, dirSet) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  if (base.startsWith('..')) return undefined
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '')
  for (const candidate of [base, stripped]) for (const ext of RESOLVE_EXTENSIONS) if (fileSet.has(candidate + ext)) return candidate + ext
  return dirSet.has(base) ? base + '/' : undefined
}

function readManifests(dest, files) {
  const declared = new Map()
  const declare = (name, manifest, version, dev = false) => {
    const key = name.toLowerCase()
    const entry = declared.get(key) ?? { name, declaredIn: [], usedBy: new Set() }
    entry.declaredIn.push({ manifest, version: version ?? null, ...(dev ? { dev: true } : {}) })
    declared.set(key, entry)
  }
  const local = { goModules: [], jsPackages: [], pythonPackages: [], crates: [] }
  for (const rel of files) {
    const name = rel.split('/').pop()
    if (!['package.json', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json', 'pubspec.yaml'].includes(name)) continue
    let text
    try { text = fs.readFileSync(path.join(dest, rel), 'utf8') } catch { continue }
    try {
      if (name === 'package.json') {
        const pkg = JSON.parse(text)
        if (pkg.name) local.jsPackages.push(pkg.name)
        for (const [field, dev] of [['dependencies', false], ['peerDependencies', false], ['optionalDependencies', false], ['devDependencies', true]]) for (const [dep, version] of Object.entries(pkg[field] ?? {})) declare(dep, rel, version, dev)
      } else if (name.startsWith('requirements')) {
        for (const line of text.split('\n')) { const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*([<>=!~].*)?$/); if (m && !line.trim().startsWith('#')) declare(m[1], rel, m[2]?.trim(), name.includes('dev')) }
      } else if (name === 'pyproject.toml') {
        const project = text.match(/^name\s*=\s*"([^"]+)"/m)
        if (project) local.pythonPackages.push(project[1])
        const list = text.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? ''
        for (const m of list.matchAll(/"([A-Za-z0-9_.-]+)\s*([^"]*)"/g)) declare(m[1], rel, m[2].trim() || null)
        const poetry = text.match(/^\[tool\.poetry\.dependencies\]([\s\S]*?)(?=^\[)/m)?.[1] ?? ''
        for (const m of poetry.matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*"?([^"\n]*)"?/gm)) if (m[1] !== 'python') declare(m[1], rel, m[2])
      } else if (name === 'Cargo.toml') {
        const crate = text.match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)
        if (crate) local.crates.push(crate[1])
        for (const section of text.matchAll(/^\[((?:dev-|build-)?dependencies)\]([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)) for (const m of section[2].matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/gm)) declare(m[1], rel, m[2].match(/"([^"]+)"/)?.[1] ?? m[2].trim(), section[1] !== 'dependencies')
      } else if (name === 'go.mod') {
        const mod = text.match(/^module\s+(\S+)/m)
        if (mod) local.goModules.push(mod[1])
        for (const m of text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w./-]+)\s+(v[\w.+-]+)/gm)) declare(m[1], rel, m[2])
      } else if (name === 'Gemfile') {
        for (const m of text.matchAll(/^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm)) declare(m[1], rel, m[2])
      } else if (name === 'composer.json') {
        const pkg = JSON.parse(text)
        for (const [field, dev] of [['require', false], ['require-dev', true]]) for (const [dep, version] of Object.entries(pkg[field] ?? {})) if (dep.includes('/')) declare(dep, rel, version, dev)
      } else if (name === 'pubspec.yaml') {
        const deps = text.match(/^dependencies:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? ''
        for (const m of deps.matchAll(/^[ \t]{2}([a-z_]\w*):\s*(.*)$/gm)) declare(m[1], rel, m[2] || null)
      }
    } catch { /* an unreadable manifest declares nothing */ }
  }
  return { declared, local }
}

/** Maps a bare import to a library key, or `null` when it is the standard library or the project itself. */
function libraryKey(spec, language, declared, local, localTopNames) {
  if (spec.startsWith('<')) return null
  if (['typescript', 'javascript'].includes(language)) {
    if (spec.startsWith('node:') || NODE_BUILTINS.has(spec)) return null
    if (local.jsPackages.includes(spec)) return null
    return spec
  }
  if (language === 'python') {
    const top = spec.split('.')[0]
    if (localTopNames.has(top.toLowerCase())) return null
    for (const key of declared.keys()) if (key.replace(/-/g, '_') === top.toLowerCase()) return declared.get(key).name
    return top
  }
  if (language === 'go') {
    if (local.goModules.some(mod => spec === mod || spec.startsWith(mod + '/'))) return null
    if (!spec.split('/')[0].includes('.')) return null
    for (const key of declared.keys()) if (spec === key || spec.startsWith(key + '/')) return declared.get(key).name
    return spec.split('/').slice(0, 3).join('/')
  }
  if (language === 'rust') {
    if (local.crates.some(crate => crate.replace(/-/g, '_') === spec)) return null
    for (const key of declared.keys()) if (key.replace(/-/g, '_') === spec.toLowerCase()) return declared.get(key).name
    return localTopNames.has(spec.toLowerCase()) ? null : spec
  }
  if (['java', 'kotlin', 'scala', 'csharp'].includes(language)) {
    const top = spec.split('.').slice(0, 2).join('.')
    if (/^(java|javax|kotlin|scala|System|Microsoft)\b/.test(spec)) return null
    return localTopNames.has(spec.split('.')[0].toLowerCase()) ? null : top
  }
  return spec
}

function docInfo(rel, text, fileSet) {
  const headings = []
  const links = new Set()
  const mentions = new Set()
  let title
  for (const line of text.split('\n')) {
    const md = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/) ?? line.match(/^\\(section|subsection|chapter)\*?\{(.+)\}/)
    if (md) {
      const heading = md[2].trim()
      title ??= heading
      if (headings.length < 15) headings.push(heading)
    }
  }
  if (!title) title = text.match(/^(.+)\n[=]{3,}\s*$/m)?.[1]?.trim() ?? text.match(/^=\s+(.+)$/m)?.[1]?.trim()
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const frontField = key => {
    const m = front.match(new RegExp(`^${key}:[ \\t]*(.*)\\n?((?:[ \\t]+.*\\n?)*)`, 'm'))
    if (!m) return undefined
    const value = /^[>|][-+]?$/.test(m[1].trim()) || m[1].trim() === '' ? m[2] : m[1]
    return value.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '') || undefined
  }
  title = frontField('title') ?? frontField('name') ?? title
  const body = text.slice(front ? front.length + 8 : 0)
  const paragraph = body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(#|\\|=|```|\||<|!\[|-{3,})/.test(p))
  const summary = (frontField('description') ?? paragraph?.replace(/\s+/g, ' '))?.slice(0, 200) ?? null
  const dir = path.posix.dirname(rel)
  for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue
    const target = path.posix.normalize(path.posix.join(dir, decodeURI(m[1])))
    if (fileSet.has(target) && target !== rel) links.add(target)
  }
  for (const m of text.matchAll(/`([\w./-]+\.[A-Za-z]{1,6})`/g)) {
    const candidates = [m[1], path.posix.normalize(path.posix.join(dir, m[1]))]
    const hit = candidates.find(c => fileSet.has(c))
    if (hit && hit !== rel) mentions.add(hit)
  }
  return { title: title ?? null, summary, headings, links: [...links].sort(), mentions: [...mentions].sort() }
}

/** The innermost function or method whose line range contains `line`. */
function enclosing(symbols, line) {
  let best
  for (const s of symbols) if (s.line <= line && s.end >= line && (s.kind === 'function' || s.kind === 'method') && (!best || s.line >= best.line)) best = s
  return best
}

/**
 * Builds the mind map: docs, modules, files, symbols, imports, libraries, call
 * links, tests and possible duplicates. Pure reading; `save` writes only
 * `.devops/mindmap/`.
 */
export function buildMindMap(destInput, { roots, save = false } = {}) {
  const dest = resolveDest(destInput, roots)
  const found = walk(dest)
  const table = extensionTable(dest)
  const all = found.files.filter(tracked).sort()
  const fileSet = new Set(all)
  const dirSet = new Set(found.dirs)
  const { declared, local } = readManifests(dest, all)
  const localTopNames = new Set()
  for (const rel of all) {
    const first = rel.split('/')[0].replace(/\.\w+$/, '').toLowerCase()
    localTopNames.add(first)
    if (/^(src|lib|pkg|internal)\//.test(rel)) localTopNames.add(rel.split('/')[1]?.replace(/\.\w+$/, '').toLowerCase())
  }

  const files = {}
  const docs = {}
  const texts = new Map()
  let skipped = 0
  for (const rel of all) {
    const language = languageOf(rel, table)
    const doc = isDoc(rel)
    if (!language && !doc) continue
    if (Object.keys(files).length + Object.keys(docs).length >= MAX_FILES) { skipped += 1; continue }
    let text
    try {
      if (fs.statSync(path.join(dest, rel)).size > MAX_FILE_BYTES) { skipped += 1; continue }
      text = fs.readFileSync(path.join(dest, rel), 'utf8')
    } catch { continue }
    if (text.includes('\0')) continue
    const lines = text.split('\n').length
    if (doc) {
      docs[rel] = { hash: hashOf(text), lines, ...docInfo(rel, text, fileSet) }
      continue
    }
    const { relative, bare } = rawImports(rel, text, language)
    const imports = [...new Set(relative.map(spec => resolveRelative(rel, spec, fileSet, dirSet)).filter(Boolean))].filter(target => target !== rel)
    const libraries = new Set()
    for (const spec of bare) {
      const key = libraryKey(spec, language, declared, local, localTopNames)
      if (key) libraries.add(key)
    }
    files[rel] = { language, module: moduleOf(rel), hash: hashOf(text), lines, test: TEST_FILE.test(rel), imports, libraries: [...libraries].sort(), symbols: symbolsOf(text, language) }
    texts.set(rel, text)
  }

  const importedBy = {}
  for (const [rel, info] of Object.entries(files)) for (const target of info.imports) (importedBy[target] ??= []).push(rel)

  const definitions = new Map()
  for (const [rel, info] of Object.entries(files)) for (const s of info.symbols) {
    if (GENERIC_NAMES.has(s.name) || s.name.length < 3) continue
    const list = definitions.get(s.name) ?? []
    list.push({ file: rel, line: s.line, kind: s.kind, exported: s.exported })
    definitions.set(s.name, list)
  }

  const calls = new Map()
  let unresolvedCalls = 0
  for (const [rel, text] of texts) {
    const info = files[rel]
    const reachable = new Set([rel, ...info.imports])
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:\/\/|#|\*|--)/.test(lines[i])) continue
      for (const m of lines[i].matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(|\.([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[1] ?? m[2]
        const targets = definitions.get(name)
        if (!targets) continue
        if (targets.some(t => t.file === rel && t.line === i + 1)) continue
        const dotted = m[2] !== undefined
        const linkable = dotted ? targets.filter(t => t.kind === 'method' || t.exported && t.file !== rel && reachable.has(t.file)) : targets
        const nearby = linkable.filter(t => reachable.has(t.file))
        const chosen = nearby.length > 0 ? nearby : linkable.length === 1 ? linkable : []
        if (chosen.length === 0) { unresolvedCalls += 1; continue }
        const caller = enclosing(info.symbols, i + 1)
        const from = `${rel}#${caller?.name ?? '(top level)'}`
        for (const t of chosen.slice(0, 3)) {
          const to = `${t.file}#${name}`
          if (to === from) continue
          const key = `${from}\u0000${to}`
          calls.set(key, (calls.get(key) ?? 0) + 1)
        }
      }
    }
  }
  const callList = [...calls].map(([key, count]) => { const [from, to] = key.split('\u0000'); return { from, to, count } }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

  const libraries = {}
  for (const [rel, info] of Object.entries(files)) for (const lib of info.libraries) {
    const key = lib.toLowerCase()
    const entry = declared.get(key) ?? { name: lib, declaredIn: [], usedBy: new Set() }
    entry.usedBy.add(rel)
    declared.set(key, entry)
  }
  for (const entry of declared.values()) {
    const usedBy = [...entry.usedBy].sort()
    libraries[entry.name] = { declaredIn: entry.declaredIn, usedBy, ...(entry.declaredIn.length === 0 ? { undeclared: true } : {}), ...(usedBy.length === 0 ? { unusedInScannedCode: true } : {}) }
  }

  const modules = {}
  for (const [rel, info] of Object.entries(files)) {
    const m = modules[info.module] ??= { files: [], languages: {}, dependsOn: {}, usedBy: {}, libraries: new Set(), exports: [] }
    m.files.push(rel)
    m.languages[info.language] = (m.languages[info.language] ?? 0) + 1
    for (const lib of info.libraries) m.libraries.add(lib)
    if (!info.test) for (const s of info.symbols) if (s.exported && s.kind !== 'method' && m.exports.length < 40) m.exports.push(`${s.name} (${rel}:${s.line})`)
    for (const target of info.imports) {
      const to = files[target]?.module ?? moduleOf(target.replace(/\/$/, '/x'))
      if (to !== info.module) {
        m.dependsOn[to] = (m.dependsOn[to] ?? 0) + 1
        const other = modules[to] ??= { files: [], languages: {}, dependsOn: {}, usedBy: {}, libraries: new Set(), exports: [] }
        other.usedBy[info.module] = (other.usedBy[info.module] ?? 0) + 1
      }
    }
  }
  for (const [rel, info] of Object.entries(docs)) {
    const id = moduleOf(rel)
    if (modules[id]) (modules[id].docs ??= []).push(rel)
    for (const target of [...info.links, ...info.mentions]) if (files[target]) (files[target].documentedBy ??= []).push(rel)
  }
  for (const m of Object.values(modules)) m.libraries = [...m.libraries].sort()

  const testedBy = {}
  for (const [rel, info] of Object.entries(files)) if (info.test) for (const target of info.imports) if (files[target] && !files[target].test) (testedBy[target] ??= []).push(rel)

  const duplicates = [...definitions].filter(([, defs]) => {
    const sources = defs.filter(d => !files[d.file].test && d.kind !== 'method' && !/\.d\.ts$/.test(d.file))
    return new Set(sources.map(d => d.file)).size > 1
  }).map(([name, defs]) => ({ name, definitions: defs.filter(d => !files[d.file].test).map(d => `${d.file}:${d.line}`) })).sort((a, b) => b.definitions.length - a.definitions.length || a.name.localeCompare(b.name))

  const map = {
    format: FORMAT, generatedAt: new Date().toISOString(),
    counts: { codeFiles: Object.keys(files).length, docs: Object.keys(docs).length, modules: Object.keys(modules).length, symbols: Object.values(files).reduce((n, f) => n + f.symbols.length, 0), calls: callList.length, libraries: Object.keys(libraries).length, skippedFiles: skipped, unresolvedCalls },
    modules, files, importedBy, testedBy, docs, libraries, calls: callList, duplicates,
    note: 'Heuristic (regular expressions, no compiler): dynamic imports, reflection, macros, overloads and same-named methods on different types are not told apart. A call is linked only when the callee is in the same file, a file it imports, or defined once in the project. Read the file before relying on a link for a change.',
  }
  const result = { dest, map, summary: renderSummary(map) }
  if (save) {
    const dir = path.join(dest, MINDMAP_DIR)
    for (const [name, body] of [[MAP_FILE, JSON.stringify(map) + '\n'], [SUMMARY_FILE, result.summary]]) {
      const file = path.join(dir, name)
      assertInside(dest, file)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, body)
    }
    result.saved = [path.join(MINDMAP_DIR, MAP_FILE), path.join(MINDMAP_DIR, SUMMARY_FILE)]
  }
  return result
}

const cell = text => String(text).replace(/\|/g, '\\|')
const top = (object, n) => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, n)

/** The Markdown an agent reads first: small, bounded, pointing at `mindmap_query` for detail. */
export function renderSummary(map) {
  const out = []
  const c = map.counts
  out.push('# Repository mind map', '')
  out.push(`Generated ${map.generatedAt} by \`mindmap_build\` (\`devops-mindmap build --save\`). Do not edit by hand.`, '')
  out.push(`${c.codeFiles} code files, ${c.docs} docs, ${c.modules} modules, ${c.symbols} symbols, ${c.calls} call links, ${c.libraries} libraries.`, '')
  out.push('**How to use it.** Read this file before opening source files. Ask `mindmap_query` (symbol, file, module, library, search) for exact definitions, signatures, callers, importers, tests and docs instead of reading files to find them. Run `mindmap_status` first: only the files it lists as changed need re-reading. Before writing a new function, look it up here and in **Possible duplicates**.', '')

  const modules = Object.entries(map.modules).sort((a, b) => b[1].files.length - a[1].files.length)
  const shown = modules.slice(0, 30)
  const shownIds = new Set(shown.map(([id]) => id))
  out.push('## Module graph', '', '```mermaid', 'graph TD')
  for (const [id, m] of shown) out.push(`  ${safeId(id)}["${safeLabel(id)}<br/>${m.files.length} files — ${safeLabel(top(m.languages, 2).map(([l]) => l).join(', '))}"]`)
  for (const [id, m] of shown) for (const [to, count] of top(m.dependsOn, 8)) if (shownIds.has(to)) out.push(`  ${safeId(id)} -->|${count}| ${safeId(to)}`)
  out.push('```', '')

  out.push('## Modules', '', '| Module | Files | Languages | Depends on | Used by | Libraries | Key exports |', '|---|---|---|---|---|---|---|')
  for (const [id, m] of shown) {
    out.push(`| \`${cell(id)}\` | ${m.files.length} | ${cell(top(m.languages, 3).map(([l, n]) => `${l} ${n}`).join(', '))} | ${cell(top(m.dependsOn, 5).map(([d]) => d).join(', ') || '—')} | ${cell(top(m.usedBy, 5).map(([d]) => d).join(', ') || '—')} | ${cell(m.libraries.slice(0, 6).join(', ') || '—')} | ${cell(m.exports.slice(0, 6).map(e => e.split(' ')[0]).join(', ') || '—')} |`)
  }
  if (modules.length > shown.length) out.push('', `${modules.length - shown.length} smaller modules omitted; query them by name.`)
  out.push('')

  const docs = Object.entries(map.docs)
  if (docs.length > 0) {
    out.push('## Documentation', '', '| Doc | Title | What it says |', '|---|---|---|')
    for (const [rel, d] of docs.slice(0, 60)) out.push(`| \`${cell(rel)}\` | ${cell(d.title ?? '—')} | ${cell((d.summary ?? '—').slice(0, 120))} |`)
    if (docs.length > 60) out.push('', `${docs.length - 60} more docs; query a file to see which docs cover it.`)
    out.push('')
  }

  const hubs = Object.entries(map.importedBy).map(([rel, list]) => [rel, list.length]).sort((a, b) => b[1] - a[1]).slice(0, 15)
  if (hubs.length > 0) {
    out.push('## Most imported files', '', '| File | Imported by | Symbols |', '|---|---|---|')
    for (const [rel, n] of hubs) out.push(`| \`${cell(rel)}\` | ${n} | ${cell((map.files[rel]?.symbols ?? []).filter(s => s.exported).slice(0, 8).map(s => s.name).join(', ') || '—')} |`)
    out.push('')
  }

  const inbound = {}
  for (const call of map.calls) inbound[call.to] = (inbound[call.to] ?? 0) + call.count
  const called = top(inbound, 15)
  if (called.length > 0) {
    out.push('## Most called functions', '', '| Function | Calls |', '|---|---|')
    for (const [fn, n] of called) out.push(`| \`${cell(fn)}\` | ${n} |`)
    out.push('')
  }

  const libs = Object.entries(map.libraries).sort((a, b) => b[1].usedBy.length - a[1].usedBy.length)
  if (libs.length > 0) {
    out.push('## Libraries', '', '| Library | Declared in | Used by files | Note |', '|---|---|---|---|')
    for (const [name, l] of libs.slice(0, 40)) out.push(`| \`${cell(name)}\` | ${cell(l.declaredIn.map(d => d.manifest).join(', ') || '—')} | ${l.usedBy.length} | ${l.undeclared ? 'not in a manifest (standard library, or missing)' : l.unusedInScannedCode ? 'not imported by scanned code' : ''} |`)
    out.push('')
  }

  if (map.duplicates.length > 0) {
    out.push('## Possible duplicates', '', 'The same name is defined in more than one file. Check before adding another; extend one instead.', '')
    for (const d of map.duplicates.slice(0, 25)) out.push(`- \`${d.name}\`: ${d.definitions.slice(0, 5).join(', ')}`)
    out.push('')
  }
  out.push('## Limits', '', map.note, '')
  return out.join('\n')
}

function loadSaved(dest) {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(dest, MINDMAP_DIR, MAP_FILE), 'utf8'))
    return map.format === FORMAT ? map : undefined
  } catch { return undefined }
}

/** Which files changed since the saved map, so an agent re-reads only those. */
export function mindMapStatus(destInput, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const saved = loadSaved(dest)
  if (!saved) return { dest, saved: false, stale: true, next: 'No saved mind map: run mindmap_build with save=true.' }
  const fresh = buildMindMap(dest).map
  const before = { ...Object.fromEntries(Object.entries(saved.files).map(([k, v]) => [k, v.hash])), ...Object.fromEntries(Object.entries(saved.docs).map(([k, v]) => [k, v.hash])) }
  const after = { ...Object.fromEntries(Object.entries(fresh.files).map(([k, v]) => [k, v.hash])), ...Object.fromEntries(Object.entries(fresh.docs).map(([k, v]) => [k, v.hash])) }
  const changed = Object.keys(after).filter(k => k in before && before[k] !== after[k]).sort()
  const added = Object.keys(after).filter(k => !(k in before)).sort()
  const removed = Object.keys(before).filter(k => !(k in after)).sort()
  const touched = [...changed, ...added, ...removed]
  const modulesTouched = [...new Set(touched.map(rel => fresh.files[rel]?.module ?? saved.files[rel]?.module ?? moduleOf(rel)))].sort()
  const stale = touched.length > 0
  return {
    dest, saved: true, generatedAt: saved.generatedAt, stale, changed, added, removed, modulesTouched,
    next: stale ? 'Re-read only the files listed, then run mindmap_build with save=true so the next seat starts from a current map.' : 'The saved map is current: trust it and do not re-read files to rediscover structure.',
  }
}

const parseRef = ref => { const i = ref.lastIndexOf('#'); return { file: ref.slice(0, i), name: ref.slice(i + 1) } }

/**
 * Answers one question from the map so an agent does not open files to find
 * it. Uses the saved map when there is one (`fresh` rebuilds in memory).
 */
export function mindMapQuery(destInput, { symbol, file, module, library, search, fresh = false, limit = 30 } = {}, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const asked = [symbol, file, module, library, search].filter(v => v !== undefined)
  if (asked.length !== 1) throw new Error('ask exactly one of: symbol, file, module, library, search')
  if (typeof asked[0] !== 'string' || asked[0].length < 1 || asked[0].length > 300) throw new Error('the query must be a string of 1 to 300 characters')
  const saved = fresh ? undefined : loadSaved(dest)
  const map = saved ?? buildMindMap(dest).map
  const source = saved ? `saved map from ${saved.generatedAt} (run mindmap_status to see what changed since)` : 'built now, not saved'
  const cap = list => list.slice(0, limit)

  if (symbol !== undefined) {
    const definitions = []
    for (const [rel, info] of Object.entries(map.files)) for (const s of info.symbols) if (s.name === symbol) definitions.push({ file: rel, line: s.line, kind: s.kind, exported: s.exported, signature: s.signature, module: info.module, testedBy: map.testedBy[rel] ?? [], documentedBy: info.documentedBy ?? [] })
    const callers = map.calls.filter(c => parseRef(c.to).name === symbol).map(c => ({ caller: c.from, callee: c.to, count: c.count }))
    const callees = map.calls.filter(c => parseRef(c.from).name === symbol).map(c => ({ caller: c.from, callee: c.to, count: c.count }))
    const lower = symbol.toLowerCase()
    const similar = definitions.length > 0 ? [] : cap([...new Set(Object.values(map.files).flatMap(f => f.symbols.map(s => s.name)).filter(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()) && n.length > 3))])
    return { dest, source, symbol, definitions: cap(definitions), callers: cap(callers), callees: cap(callees), ...(similar.length > 0 ? { similarNames: similar } : {}), ...(definitions.length > 1 ? { warning: 'defined in more than one place: check for duplicate implementations' } : {}) }
  }
  if (file !== undefined) {
    const rel = file.replace(/^\.\//, '')
    const info = map.files[rel]
    const doc = map.docs[rel]
    if (!info && !doc) throw new Error(`not in the mind map: ${rel} (not a code or doc file, skipped, or the map is stale)`)
    if (doc) return { dest, source, file: rel, doc, linkedFrom: Object.entries(map.docs).filter(([, d]) => d.links.includes(rel)).map(([r]) => r) }
    return { dest, source, file: rel, language: info.language, module: info.module, lines: info.lines, test: info.test, symbols: info.symbols, imports: info.imports, importedBy: map.importedBy[rel] ?? [], libraries: info.libraries, testedBy: map.testedBy[rel] ?? [], documentedBy: info.documentedBy ?? [], callsOut: cap(map.calls.filter(c => parseRef(c.from).file === rel)), callsIn: cap(map.calls.filter(c => parseRef(c.to).file === rel && parseRef(c.from).file !== rel)) }
  }
  if (module !== undefined) {
    const m = map.modules[module]
    if (!m) throw new Error(`no module ${module}; modules: ${Object.keys(map.modules).slice(0, 40).join(', ')}`)
    return { dest, source, module, ...m, files: cap(m.files) }
  }
  if (library !== undefined) {
    const key = Object.keys(map.libraries).find(name => name.toLowerCase() === library.toLowerCase())
    if (!key) return { dest, source, library, found: false, note: 'Not declared in a manifest and not imported by scanned code.' }
    return { dest, source, library: key, ...map.libraries[key], usedBy: cap(map.libraries[key].usedBy) }
  }
  const lower = search.toLowerCase()
  const symbols = []
  for (const [rel, info] of Object.entries(map.files)) for (const s of info.symbols) if (s.name.toLowerCase().includes(lower)) symbols.push({ name: s.name, kind: s.kind, file: rel, line: s.line, signature: s.signature })
  const filesHit = Object.keys(map.files).filter(rel => rel.toLowerCase().includes(lower))
  const docsHit = Object.entries(map.docs).filter(([rel, d]) => rel.toLowerCase().includes(lower) || (d.title ?? '').toLowerCase().includes(lower) || d.headings.some(h => h.toLowerCase().includes(lower))).map(([rel, d]) => ({ file: rel, title: d.title }))
  return { dest, source, search, symbols: cap(symbols), files: cap(filesHit), docs: cap(docsHit), libraries: Object.keys(map.libraries).filter(n => n.toLowerCase().includes(lower)) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const command = args.shift()
  const opt = name => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
  const dest = path.resolve(opt('--dest') ?? process.cwd())
  try {
    if (command === 'build') {
      const result = buildMindMap(dest, { save: args.includes('--save') })
      if (args.includes('--json')) console.log(JSON.stringify(result.map))
      else console.log(result.saved ? `saved ${result.saved.join(' and ')}\n${JSON.stringify(result.map.counts)}` : result.summary)
    } else if (command === 'status') {
      console.log(JSON.stringify(mindMapStatus(dest), null, 2))
    } else if (command === 'query') {
      const query = Object.fromEntries(['symbol', 'file', 'module', 'library', 'search'].map(k => [k, opt('--' + k)]).filter(([, v]) => v !== undefined))
      console.log(JSON.stringify(mindMapQuery(dest, { ...query, fresh: args.includes('--fresh') }), null, 2))
    } else {
      console.error('usage: devops-mindmap build [--save] [--json] | status | query --symbol NAME|--file PATH|--module ID|--library NAME|--search TEXT [--fresh]   [--dest DIR]')
      process.exitCode = 2
    }
  } catch (error) {
    console.error(`devops-mindmap: ${error.message}`)
    process.exitCode = 1
  }
}
