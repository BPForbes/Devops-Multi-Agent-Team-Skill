#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_ROOT, assertInside, resolveDest, walk } from './devops-setup.mjs'
import { SECRET_FILE, extensionTable, languageOf, moduleOf, redact, safeId, safeLabel } from './devops-research.mjs'

export const MINDMAP_DIR = path.join('.devops', 'mindmap')
const MAP_FILE = 'mindmap.json'
const SUMMARY_FILE = 'MINDMAP.md'
const OVERVIEW_FILE = 'OVERVIEW.md'
const GRAPH_FILE = 'graph.json'
/** Hand-written; never generated, so it survives every rebuild. */
const NOTES_FILE = 'NOTES.md'
const MAX_DOC = 280
const ENTRY_FILE = /(^|\/)(main\.(go|rs|py|c|cc|cpp|java|kt|cs|swift|zig|dart|ts|js|mjs)|__main__\.py|manage\.py|Program\.cs|(index|app|server|cli)\.(ts|tsx|js|mjs|py|rb|php))$/
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
const TEXT_DEFAULTS_FILE = path.join(PACKAGE_ROOT, 'mindmap-text.json')
/** A project's own wording, same shape as mindmap-text.json, any subset of keys. */
const TEXT_OVERRIDE_FILE = 'text.json'
const MAX_TEMPLATE = 8000
const MAX_WORDS = 500
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
let defaultText

function compileText(source) {
  const words = source.words
  const never = '(?!)'
  return {
    text: source.text,
    words,
    /** Fills `{name}` placeholders; an unknown key is a bug in the code, not in the wording. */
    t(key, vars = {}) {
      const template = source.text[key]
      if (template === undefined) throw new Error(source.text.errMissingKey?.replace('{key}', key) ?? key)
      return template.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])))
    },
    genericNames: new Set(words.genericNames),
    notDocumentation: new RegExp([
      ...words.notDocumentationContains.map(escapeRegExp),
      ...words.notDocumentationStarts.map(w => `^\\s*${escapeRegExp(w)}${/\w$/.test(w) ? '\\b' : ''}`),
    ].join('|') || never, 'i'),
    docSectionLabel: new RegExp(`^(${words.docSectionLabels.map(escapeRegExp).join('|') || never}):?$`, 'i'),
  }
}

/**
 * The mind map's wording: mindmap-text.json from the package, with the
 * project's .devops/mindmap/text.json laid over it key by key. Nothing the
 * mind map says is written in the code.
 */
export function loadText(dest) {
  const defaults = JSON.parse(fs.readFileSync(TEXT_DEFAULTS_FILE, 'utf8'))
  if (dest === undefined) return (defaultText ??= compileText(defaults))
  const file = path.join(dest, MINDMAP_DIR, TEXT_OVERRIDE_FILE)
  let override
  try {
    override = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return (defaultText ??= compileText(defaults))
    throw new Error(compileText(defaults).t('errTextFile', { file: path.join(MINDMAP_DIR, TEXT_OVERRIDE_FILE), problem: error.message }))
  }
  const base = compileText(defaults)
  const problems = []
  if (typeof override !== 'object' || override === null || Array.isArray(override)) problems.push(base.t('errTextShape'))
  for (const [section, check] of [['text', v => typeof v === 'string' && v.length <= MAX_TEMPLATE], ['words', v => Array.isArray(v) && v.length <= MAX_WORDS && v.every(w => typeof w === 'string' && w !== '')]]) {
    const given = override?.[section]
    if (given === undefined) continue
    if (typeof given !== 'object' || given === null || Array.isArray(given)) { problems.push(base.t('errTextSection', { section })); continue }
    for (const [key, value] of Object.entries(given)) {
      if (!(key in defaults[section])) problems.push(base.t('errTextUnknownKey', { section, key }))
      else if (!check(value)) problems.push(base.t('errTextValue', { section, key }))
    }
  }
  if (problems.length > 0) throw new Error(base.t('errTextFile', { file: path.join(MINDMAP_DIR, TEXT_OVERRIDE_FILE), problem: problems.join('; ') }))
  return compileText({ text: { ...defaults.text, ...override.text }, words: { ...defaults.words, ...override.words } })
}

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

const HASH_COMMENTS = new Set(['python', 'ruby', 'shell', 'perl', 'r', 'julia', 'elixir', 'powershell', 'terraform', 'gdscript', 'nim', 'crystal'])
const DASH_COMMENTS = new Set(['sql', 'lua', 'haskell', 'ada', 'elm'])

function lineComment(language) {
  if (HASH_COMMENTS.has(language)) return /^\s*#(?![!\[]|include)\s?(.*)$/
  if (DASH_COMMENTS.has(language)) return /^\s*--+\s?(.*)$/
  return /^\s*\/\/[\/!]?\s?(.*)$/
}

/** The first paragraph of a comment, without markers or @tags, cut to whole sentences. */
export function cleanDoc(raw, T = loadText()) {
  const kept = []
  for (const line of raw.split('\n')) {
    const text = line.replace(/^\s*\*+\s?/, '').trim()
    if (/^[@:]\w|^\.\.\s/.test(text) || T.docSectionLabel.test(text)) break
    if (text === '' && kept.length > 0) break
    if (text !== '') kept.push(text)
  }
  const joined = kept.join(' ').replace(/\{@link\s+([^}]+)\}/g, '$1').replace(/\s+/g, ' ').trim()
  if (joined === '' || T.notDocumentation.test(joined) || /^[-=*#~_]{3,}$/.test(joined)) return undefined
  if (joined.length <= MAX_DOC) return joined
  const cut = joined.slice(0, MAX_DOC)
  const stop = cut.lastIndexOf('. ')
  return stop > 60 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + ' ...'
}

/** The documentation comment that ends right above line `index`, skipping decorators and attributes. */
function docAbove(lines, index, language, T) {
  let i = index - 1
  while (i >= 0 && /^\s*(@[\w.]+|#\[|\[\w)/.test(lines[i])) i -= 1
  if (i < 0 || lines[i].trim() === '') return undefined
  let raw
  if (/\*\/\s*$/.test(lines[i]) && !HASH_COMMENTS.has(language)) {
    let j = i
    while (j >= 0 && !/\/\*/.test(lines[j])) j -= 1
    if (j < 0 || i - j > 80) return undefined
    raw = lines.slice(j, i + 1).join('\n').replace(/^\s*\/\*+!?/, '').replace(/\*+\/\s*$/, '')
  } else {
    const style = lineComment(language)
    const block = []
    while (i >= 0 && style.test(lines[i])) { block.unshift(lines[i].match(style)[1]); i -= 1 }
    if (block.length === 0) return undefined
    raw = block.join('\n')
  }
  return cleanDoc(raw, T)
}

const DOCSTRING_OPEN = /^\s*[rubRUB]?("{3}|'{3})(.*)$/

/** A docstring as the first statement of the block whose header starts at line `index` (Python and friends). */
function docstringAfter(lines, index, T) {
  let i = index
  while (i < lines.length && i < index + 20 && !/:\s*(#.*)?$/.test(lines[i])) i += 1
  i += 1
  while (i < lines.length && lines[i].trim() === '') i += 1
  return docstringAt(lines, i, T)
}

function docstringAt(lines, i, T) {
  const open = lines[i]?.match(DOCSTRING_OPEN)
  if (!open) return undefined
  const quote = open[1]
  if (open[2].includes(quote)) return cleanDoc(open[2].slice(0, open[2].indexOf(quote)), T)
  const body = [open[2]]
  for (let j = i + 1; j < lines.length && j < i + 200; j++) {
    if (lines[j].includes(quote)) { body.push(lines[j].slice(0, lines[j].indexOf(quote))); break }
    body.push(lines[j])
  }
  return cleanDoc(body.join('\n'), T)
}

/** What a file says about itself: a module docstring, a `// Package` comment, or a header comment not tied to the first declaration. */
export function fileDocOf(text, language, symbols = [], T = loadText()) {
  const lines = text.split('\n')
  if (language === 'go') {
    const pkg = lines.findIndex(line => /^package\s+\w+/.test(line))
    return pkg === -1 ? undefined : docAbove(lines, pkg, language, T)
  }
  let k = 0
  while (k < lines.length && (lines[k].trim() === '' || /^#!|^\s*['"]use strict['"]|^\s*#\s*-\*-|^\s*\/\/\s*@ts-|^\s*<\?php/.test(lines[k]))) k += 1
  if (HASH_COMMENTS.has(language)) { const ds = docstringAt(lines, k, T); if (ds) return ds }
  let end = k
  if (/^\s*\/\*/.test(lines[k] ?? '') && !HASH_COMMENTS.has(language)) {
    while (end < lines.length && !/\*\//.test(lines[end])) end += 1
  } else {
    const style = lineComment(language)
    if (!style.test(lines[k] ?? '')) return undefined
    while (end + 1 < lines.length && style.test(lines[end + 1])) end += 1
  }
  if (symbols.some(sym => sym.line === end + 2)) return undefined
  return docAbove(lines, end + 1, language, T)
}

export function symbolsOf(text, language, T = loadText()) {
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
      if (!name || T.genericNames.has(name) && kind === 'method') break
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
  for (const s of symbols) {
    const doc = (HASH_COMMENTS.has(language) && language !== 'shell' ? docstringAfter(lines, s.line - 1, T) : undefined) ?? docAbove(lines, s.line - 1, language, T)
    if (doc) s.doc = doc
  }
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
  const sections = []
  let fenced = false
  const latexLevel = { chapter: 1, section: 2, subsection: 3 }
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) return
    const md = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/) ?? line.match(/^\\(section|subsection|chapter)\*?\{(.+)\}/)
    if (!md) return
    const heading = md[2].trim()
    title ??= heading
    if (headings.length < 15 && md[1].length <= 3) headings.push(heading)
    if (sections.length < 80) sections.push({ heading, level: md[1].startsWith('#') ? md[1].length : latexLevel[md[1]], line: i + 1 })
  })
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
  const blocks = body.split(/\n\s*\n/).map(p => p.trim())
  const at = blocks.findIndex(p => p && !/^(#|\\|=|```|\||<|!\[|-{3,})/.test(p))
  let paragraph = at === -1 ? undefined : blocks[at]
  if (paragraph?.endsWith(':') && blocks[at + 1]) paragraph += ' ' + blocks[at + 1].split(/\n(?=\s*(?:[-*+]|\d+\.)\s)/).map(item => item.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/\s+/g, ' ')).join('; ')
  const plain = text => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim()
  const summary = plain(frontField('description') ?? paragraph ?? '').slice(0, 200) || null
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
  return { title: title ?? null, summary, headings, sections, links: [...links].sort(), mentions: [...mentions].sort() }
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
  const T = loadText(dest)
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
  const docTexts = new Map()
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
      docTexts.set(rel, text)
      continue
    }
    const { relative, bare } = rawImports(rel, text, language)
    const imports = [...new Set(relative.map(spec => resolveRelative(rel, spec, fileSet, dirSet)).filter(Boolean))].filter(target => target !== rel)
    const libraries = new Set()
    for (const spec of bare) {
      const key = libraryKey(spec, language, declared, local, localTopNames)
      if (key) libraries.add(key)
    }
    const symbols = symbolsOf(text, language, T)
    const fileDoc = fileDocOf(text, language, symbols, T)
    files[rel] = { language, module: moduleOf(rel), hash: hashOf(text), lines, test: TEST_FILE.test(rel), ...(fileDoc ? { doc: fileDoc } : {}), imports, libraries: [...libraries].sort(), symbols }
    texts.set(rel, text)
  }

  const importedBy = {}
  for (const [rel, info] of Object.entries(files)) for (const target of info.imports) (importedBy[target] ??= []).push(rel)

  const definitions = new Map()
  for (const [rel, info] of Object.entries(files)) for (const s of info.symbols) {
    if (T.genericNames.has(s.name) || s.name.length < 3) continue
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
        const from = `${rel}#${caller?.name ?? T.t('topLevel')}`
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

  linkDocsToCode(docs, docTexts, files, definitions)
  for (const [id, m] of Object.entries(modules)) {
    const doc = moduleDocOf(id, m, docs, files)
    if (doc) m.doc = doc
  }

  const project = projectFacts(dest, all, files)
  const map = {
    format: FORMAT, generatedAt: new Date().toISOString(), project,
    counts: { codeFiles: Object.keys(files).length, docs: Object.keys(docs).length, modules: Object.keys(modules).length, symbols: Object.values(files).reduce((n, f) => n + f.symbols.length, 0), calls: callList.length, libraries: Object.keys(libraries).length, skippedFiles: skipped, unresolvedCalls },
    modules, files, importedBy, testedBy, docs, libraries, calls: callList, duplicates,
  }
  const notes = readNotes(dest)
  const overview = renderOverview(map, notes, T)
  const graph = graphOf(map, notes, T)
  const result = { dest, map, graph, overview, summary: renderSummary(map, overview, graph, T) }
  if (save) {
    const dir = path.join(dest, MINDMAP_DIR)
    for (const [name, body] of [[MAP_FILE, JSON.stringify(map) + '\n'], [SUMMARY_FILE, result.summary], [OVERVIEW_FILE, overview], [GRAPH_FILE, JSON.stringify(graph) + '\n']]) {
      const file = path.join(dir, name)
      assertInside(dest, file)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, body)
    }
    result.saved = [path.join(MINDMAP_DIR, MAP_FILE), path.join(MINDMAP_DIR, SUMMARY_FILE), path.join(MINDMAP_DIR, OVERVIEW_FILE), path.join(MINDMAP_DIR, GRAPH_FILE)]
  }
  return result
}

const DOC_CODE_REF = /`([A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$]*)*)(?:\([^)`]*\))?`/g
const DOC_PATH_REF = /\]\(([^)\s#]+)(?:#[^)]*)?\)|`([\w./-]+\.[A-Za-z]{1,6})`/g

/**
 * Ties documentation to code: each doc section lists the functions, types and
 * files it talks about (`refs`), each symbol lists the doc sections that
 * describe it (`documentedIn`), and each doc lists what it `describes`.
 * A name defined in more than three places is too ambiguous to link.
 */
function linkDocsToCode(docs, docTexts, files, definitions) {
  const symbolsByRef = new Map()
  for (const [rel, info] of Object.entries(files)) for (const s of info.symbols) if (!symbolsByRef.has(`${rel}#${s.name}`)) symbolsByRef.set(`${rel}#${s.name}`, s)
  const known = rel => files[rel] !== undefined || docs[rel] !== undefined
  for (const [rel, text] of docTexts) {
    const doc = docs[rel]
    const describes = new Set()
    let section
    let next = 0
    const dir = path.posix.dirname(rel)
    text.split('\n').forEach((line, i) => {
      while (next < doc.sections.length && doc.sections[next].line <= i + 1) section = doc.sections[next++]
      const refer = ref => {
        describes.add(ref)
        if (section && !(section.refs ??= []).includes(ref) && section.refs.length < 30) section.refs.push(ref)
      }
      for (const m of line.matchAll(DOC_CODE_REF)) {
        const name = m[1].split(/\.|::|#/).pop()
        const codeLike = m[0].includes('(') || m[1] !== name || /[A-Z_]/.test(name.slice(1)) || /^[A-Z]\w{3,}/.test(name)
        if (!codeLike) continue
        const defs = definitions.get(name)?.filter(d => !files[d.file].test)
        if (!defs || defs.length === 0 || defs.length > 3) continue
        for (const d of defs) {
          const ref = `${d.file}#${name}`
          const s = symbolsByRef.get(ref)
          if (!s) continue
          refer(ref)
          const where = { doc: rel, section: section?.heading ?? doc.title ?? rel, line: section?.line ?? 1 }
          s.documentedIn ??= []
          if (s.documentedIn.length < 8 && !s.documentedIn.some(x => x.doc === where.doc && x.line === where.line)) s.documentedIn.push(where)
        }
      }
      for (const m of line.matchAll(DOC_PATH_REF)) {
        const spec = m[1] ?? m[2]
        if (/^[a-z]+:/i.test(spec)) continue
        let target
        try { target = [path.posix.normalize(path.posix.join(dir, decodeURI(spec))), spec].find(known) } catch { continue }
        if (target && target !== rel && files[target]) refer(target)
      }
    })
    doc.describes = [...describes].sort().slice(0, 60)
  }
}

const CONTAINER_KINDS = new Set(['class', 'type', 'interface', 'enum', 'module', 'object', 'trait'])
const EDGE_KEYS = { imports: 'Imports', calls: 'Calls', uses: 'Uses', documents: 'Documents', links: 'Links', tests: 'Tests' }
const edgeName = (T, kind, dir) => T.t(`edge${EDGE_KEYS[kind]}${dir === 'out' ? 'Out' : 'In'}`)

/**
 * The mind map as one tree with cross links. The tree (`parent`) is
 * project > module > file > class > function, and project or module > doc >
 * section; libraries hang under one `libraries` node. Edges add imports,
 * calls, uses, documents, links and tests. Every node carries its own
 * documentation (`summary`) and the hand-written `notes` for it.
 */
export function graphOf(map, notes = {}, T = loadText()) {
  const nodes = new Map()
  const edges = []
  const add = node => { if (!nodes.has(node.id)) nodes.set(node.id, Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined && v !== null))); return node.id }
  const link = (from, to, kind, count) => { if (nodes.has(from) && nodes.has(to) && from !== to) edges.push({ from, to, kind, ...(count > 1 ? { count } : {}) }) }
  const readme = Object.keys(map.docs).filter(rel => README.test(rel)).sort((a, b) => a.length - b.length)[0]
  add({ id: 'project', kind: 'project', name: map.project?.name ?? (readme ? map.docs[readme].title : null) ?? T.t('nodeProject'), parent: null, summary: readme ? map.docs[readme].summary : undefined })
  for (const [id, m] of Object.entries(map.modules)) add({ id: `module:${id}`, kind: 'module', name: id, parent: 'project', summary: m.doc })
  const symbolId = new Map()
  for (const [rel, f] of Object.entries(map.files)) {
    add({ id: `file:${rel}`, kind: f.test ? 'test' : 'file', name: rel.split('/').pop(), path: rel, parent: nodes.has(`module:${f.module}`) ? `module:${f.module}` : 'project', summary: f.doc, lines: f.lines, language: f.language })
    const containers = f.symbols.filter(s => CONTAINER_KINDS.has(s.kind))
    for (const s of f.symbols) {
      const owner = containers.filter(c => c !== s && c.line <= s.line && c.end >= s.end && c.line !== s.line).pop()
      let id = `symbol:${rel}#${s.name}`
      if (nodes.has(id)) id += `@${s.line}`
      if (!symbolId.has(`${rel}#${s.name}`)) symbolId.set(`${rel}#${s.name}`, id)
      add({ id, kind: s.kind, name: s.name, path: rel, line: s.line, end: s.end, parent: owner ? symbolId.get(`${rel}#${owner.name}`) : `file:${rel}`, summary: s.doc, signature: s.signature, exported: s.exported })
    }
  }
  if (Object.keys(map.docs).length > 0) add({ id: 'docs', kind: 'group', name: T.t('nodeDocumentation'), parent: 'project' })
  const folderOf = dir => {
    if (dir === '.') return 'docs'
    const id = `folder:${dir}`
    if (!nodes.has(id)) add({ id, kind: 'folder', name: dir.split('/').pop() + '/', path: dir, parent: folderOf(path.posix.dirname(dir)) })
    return id
  }
  for (const [rel, d] of Object.entries(map.docs)) {
    const module = `module:${moduleOf(rel)}`
    add({ id: `doc:${rel}`, kind: 'doc', name: d.title ?? rel.split('/').pop(), path: rel, parent: nodes.has(module) ? module : folderOf(path.posix.dirname(rel)), summary: d.summary })
    const stack = []
    for (const sec of d.sections ?? []) {
      while (stack.length > 0 && stack[stack.length - 1].level >= sec.level) stack.pop()
      const id = `section:${rel}#L${sec.line}`
      add({ id, kind: 'section', name: sec.heading, path: rel, line: sec.line, parent: stack.length > 0 ? stack[stack.length - 1].id : `doc:${rel}` })
      stack.push({ id, level: sec.level })
    }
  }
  const libraries = Object.entries(map.libraries)
  if (libraries.length > 0) add({ id: 'libraries', kind: 'group', name: T.t('nodeLibraries'), parent: 'project' })
  for (const [name, l] of libraries) add({ id: `library:${name}`, kind: 'library', name, parent: 'libraries', summary: l.declaredIn.map(d => `${d.manifest}${d.version ? ` ${d.version}` : ''}`).join(', ') || T.t('notInManifest') })

  const refId = ref => (ref.includes('#') ? symbolId.get(ref) ?? `file:${ref.slice(0, ref.lastIndexOf('#'))}` : nodes.has(`file:${ref}`) ? `file:${ref}` : `doc:${ref}`)
  for (const [rel, f] of Object.entries(map.files)) {
    for (const target of f.imports) link(`file:${rel}`, `file:${target}`, 'imports')
    for (const lib of f.libraries) link(`file:${rel}`, `library:${lib}`, 'uses')
  }
  for (const [target, tests] of Object.entries(map.testedBy)) for (const t of tests) link(`file:${t}`, `file:${target}`, 'tests')
  for (const c of map.calls) link(refId(c.from), refId(c.to), 'calls', c.count)
  for (const [rel, d] of Object.entries(map.docs)) {
    for (const target of d.links) link(`doc:${rel}`, map.docs[target] ? `doc:${target}` : `file:${target}`, map.docs[target] ? 'links' : 'documents')
    for (const sec of d.sections ?? []) for (const ref of sec.refs ?? []) link(`section:${rel}#L${sec.line}`, refId(ref), 'documents')
  }

  const graph = { nodes: [...nodes.values()], edges }
  for (const [key, text] of Object.entries(notes)) {
    const id = resolveNode(graph, key, { quiet: true, T })
    if (id) nodes.get(id).notes = text
  }
  return graph
}

/** Finds a node from what a person or agent would type: an id, a path, `path#name`, a module or a bare name. */
export function resolveNode(graph, key, { quiet = false, T = loadText() } = {}) {
  const ids = new Set(graph.nodes.map(n => n.id))
  const k = String(key).trim().replace(/^\.\//, '')
  for (const candidate of [k, `module:${k}`, `file:${k}`, `doc:${k}`, `symbol:${k}`, `library:${k}`, `folder:${k.replace(/\/$/, '')}`]) if (ids.has(candidate)) return candidate
  const named = graph.nodes.filter(n => n.name === k && n.kind !== 'section')
  if (named.length === 1) return named[0].id
  if (quiet) return undefined
  const hint = (named.length > 1 ? named : graph.nodes.filter(n => n.name?.toLowerCase().includes(k.toLowerCase()))).slice(0, 10).map(n => n.id)
  throw new Error(T.t('errNoNode', { key: k, hint: hint.length ? T.t('errNoNodeHint', { list: hint.join(', ') }) : '' }))
}

export function readNotes(dest) {
  let text
  try { text = fs.readFileSync(path.join(dest, MINDMAP_DIR, NOTES_FILE), 'utf8') } catch { return {} }
  const notes = {}
  for (const part of text.split(/^## /m).slice(1)) {
    const newline = part.indexOf('\n')
    const key = (newline === -1 ? part : part.slice(0, newline)).trim().replace(/^`|`$/g, '')
    const body = newline === -1 ? '' : part.slice(newline + 1).trim()
    if (key && body) notes[key] = body
  }
  return notes
}

const brief = n => ({ id: n.id, kind: n.kind, name: n.name, path: n.path, line: n.line, end: n.end, signature: n.signature, summary: n.summary, notes: n.notes })

function treeLine(n, T) {
  const where = n.kind === 'section' ? ` (${n.path}:${n.line})` : n.line ? ` ${T.t('treeLines', { start: n.line, end: n.end })}` : ''
  const label = n.kind === 'project' || n.kind === 'module' || n.kind === 'file' || n.kind === 'test' || n.kind === 'doc' || n.kind === 'group' || n.kind === 'library' || n.kind === 'folder' ? n.name : n.signature ?? n.name
  return `${label} [${n.kind}]${where}${n.summary ? ` — ${n.summary}` : ''}${n.notes ? `\n  ${T.t('treeNote', { text: n.notes.replace(/\s+/g, ' ').slice(0, 300) })}` : ''}`
}

/** Indented text of a tree from `walk`, one node a line; children past the limit are counted. */
function renderTreeText(tree, T, indent = '') {
  const lines = [`${indent}- ${treeLine(tree, T).replace(/\n/g, `\n${indent}  `)}`]
  for (const child of tree.children ?? []) lines.push(renderTreeText(child, T, indent + '  '))
  if (tree.more) lines.push(`${indent}  - ${T.t('treeMore', { count: tree.more })}`)
  return lines.join('\n')
}

function treeIndex(graph) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const children = new Map()
  for (const n of graph.nodes) if (n.parent) (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)).push(n.id)
  return { byId, children }
}

function walkTree(index, id, depth, limit, keep = () => true) {
  const node = index.byId.get(id)
  const kids = (index.children.get(id) ?? []).filter(k => keep(index.byId.get(k)))
  const out = { ...brief(node), childCount: kids.length }
  if (depth > 0 && kids.length > 0) {
    out.children = kids.slice(0, limit).map(k => walkTree(index, k, depth - 1, limit, keep))
    if (kids.length > limit) out.more = kids.length - limit
  }
  return out
}

/**
 * One node of the mind map with its place in the tree, its subtree to
 * `depth`, its documentation and notes, and its links grouped by kind both
 * ways (with each neighbour's own documentation): enough to say how a
 * function or module works without opening a file.
 */
export function mindMapTree(destInput, { node = 'project', depth = 2, fresh = false, limit = 25 } = {}, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const T = loadText(dest)
  if (typeof node !== 'string' || node.length < 1 || node.length > 300) throw new Error(T.t('errNodeString'))
  const d = Math.max(0, Math.min(Number.isInteger(depth) ? depth : 2, 6))
  const saved = fresh ? undefined : loadSaved(dest)
  const map = saved ?? buildMindMap(dest).map
  const graph = graphOf(map, readNotes(dest), T)
  const index = treeIndex(graph)
  const id = resolveNode(graph, node, { T })
  const ancestors = []
  for (let p = index.byId.get(id).parent; p; p = index.byId.get(p)?.parent) ancestors.unshift(index.byId.get(p).name)
  const tree = walkTree(index, id, d, limit)
  const links = { out: {}, in: {} }
  for (const e of graph.edges) {
    const dir = e.from === id ? 'out' : e.to === id ? 'in' : undefined
    if (!dir) continue
    const other = index.byId.get(dir === 'out' ? e.to : e.from)
    const label = edgeName(T, e.kind, dir)
    const list = links[dir][label] ??= []
    if (list.length < limit) list.push({ id: other.id, name: other.kind === 'section' ? `${other.path} > ${other.name}` : other.name, summary: other.summary, ...(e.count ? { count: e.count } : {}) })
  }
  return {
    dest, source: saved ? T.t('sourceSaved', { date: saved.generatedAt }) : T.t('sourceBuilt'), path: ancestors, node: { ...brief(index.byId.get(id)), childCount: tree.childCount },
    tree, links, text: [ancestors.length ? T.t('treeIn', { path: ancestors.join(' > ') }) : undefined, renderTreeText(tree, T)].filter(Boolean).join('\n'),
  }
}


/** Adds or replaces the hand-written note for one node in NOTES.md (plan unless `apply`). */
export function mindMapNote(destInput, { node, text, apply = false } = {}, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const T = loadText(dest)
  if (typeof text !== 'string' || text.trim() === '' || text.length > 4000) throw new Error(T.t('errNoteText'))
  if (/^## /m.test(text)) throw new Error(T.t('errNoteHeading'))
  if (typeof node !== 'string' || node.length < 1 || node.length > 300) throw new Error(T.t('errNodeString'))
  const map = loadSaved(dest) ?? buildMindMap(dest).map
  const id = resolveNode(graphOf(map, {}, T), node, { T })
  const key = id === 'project' ? 'project' : id.replace(/^(module|file|doc|symbol|library):/, '')
  const file = path.join(dest, MINDMAP_DIR, NOTES_FILE)
  let current = T.t('notesHeader')
  try { current = fs.readFileSync(file, 'utf8') } catch { /* first note */ }
  const section = `## ${key}\n\n${text.trim()}\n`
  const pattern = new RegExp(`^## \`?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?[ \\t]*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm')
  const replaced = pattern.test(current)
  const next = replaced ? current.replace(pattern, section + '\n') : current.replace(/\n*$/, '\n\n') + section
  if (apply) {
    assertInside(dest, file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, next)
  }
  return { dest, node: id, key, file: path.join(MINDMAP_DIR, NOTES_FILE), action: replaced ? 'replace' : 'add', applied: apply, section }
}

/** The code tree with each node's documentation, bounded for MINDMAP.md. */
function renderCodeTree(graph, T) {
  const index = treeIndex(graph)
  const isCode = n => !['doc', 'section', 'group', 'library', 'folder'].includes(n.kind) && n.kind !== 'test' && (n.path === undefined || n.kind === 'file' || n.exported || n.summary || n.notes)
  return renderTreeText(walkTree(index, 'project', 4, 12, isCode), T)
}

/** A Mermaid mindmap of the tree: project, modules, then files (bounded). */
function renderMermaidMindmap(graph) {
  const index = treeIndex(graph)
  const label = text => safeLabel(String(text)).replace(/[{}:;`#]/g, ' ').replace(/\s+/g, ' ').trim() || '-'
  const lines = ['mindmap', `  root((${label(index.byId.get('project').name)}))`]
  const modules = (index.children.get('project') ?? []).map(id => index.byId.get(id)).filter(n => n.kind === 'module').slice(0, 15)
  for (const m of modules) {
    lines.push(`    ${label(m.name)}`)
    const files = (index.children.get(m.id) ?? []).map(id => index.byId.get(id)).filter(n => n.kind === 'file').slice(0, 6)
    for (const f of files) lines.push(`      ${label(f.name)}`)
  }
  return lines.join('\n')
}

/** Where the project starts and how it is run: manifest entry points, conventional main files, scripts and make targets. */
function projectFacts(dest, all, files) {
  const read = rel => { try { return fs.readFileSync(path.join(dest, rel), 'utf8') } catch { return '' } }
  const entryPoints = new Set()
  const commands = []
  let name
  const pkgText = read('package.json')
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText)
      name = pkg.name
      const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})
      for (const target of [...bins, pkg.main, typeof pkg.exports === 'string' ? pkg.exports : undefined]) if (typeof target === 'string') entryPoints.add(path.posix.normalize(target))
      for (const [script, command] of Object.entries(pkg.scripts ?? {})) commands.push({ run: `npm run ${script}`, does: String(command).slice(0, 100) })
    } catch { /* not JSON: no facts from it */ }
  }
  const pyproject = read('pyproject.toml')
  name ??= pyproject.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
  for (const m of (pyproject.match(/^\[project\.scripts\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? '').matchAll(/^([\w-]+)\s*=\s*"([^"]+)"/gm)) commands.push({ run: m[1], does: m[2] })
  name ??= read('Cargo.toml').match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)?.[1] ?? read('go.mod').match(/^module\s+(\S+)/m)?.[1]
  for (const m of read('Makefile').matchAll(/^([A-Za-z][\w-]*)\s*:(?!=)/gm)) if (commands.length < 30) commands.push({ run: `make ${m[1]}`, does: '' })
  for (const rel of all) if (ENTRY_FILE.test(rel) && files[rel] && !files[rel].test && rel.split('/').length <= 3) entryPoints.add(rel)
  return { name: name ?? null, entryPoints: [...entryPoints].filter(rel => all.includes(rel)).slice(0, 12), commands: commands.slice(0, 20) }
}

const cell = text => String(text).replace(/\|/g, '\\|')
const top = (object, n) => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, n)

const README = /^readme\.(md|markdown|rst|adoc|txt)$/i

/** How a module describes itself: its README, else the doc comment of its index or most imported file. */
function moduleDocOf(id, m, docs, files) {
  const readme = (m.docs ?? []).filter(rel => README.test(rel.split('/').pop())).sort((a, b) => a.length - b.length).map(rel => docs[rel]?.summary).find(Boolean)
  if (readme) return readme
  const documented = m.files.filter(rel => files[rel]?.doc && !files[rel].test)
  const index = documented.find(rel => /(^|\/)(index|mod|__init__|lib|main)\.\w+$/.test(rel))
  return index ? files[index].doc : documented.length === 1 ? files[documented[0]].doc : undefined
}

/** What a module is for: its note, else its README or index doc comment, else its main exports. */
function purposeOf(id, m, notes, T) {
  const note = notes[id] ?? notes[`module:${id}`]
  if (note) return note.replace(/\s+/g, ' ').slice(0, 160)
  if (m.doc) return m.doc.slice(0, 160)
  const names = m.exports.slice(0, 5).map(e => e.split(' ')[0])
  return names.length > 0 ? T.t('purposeExports', { list: names.join(', ') }) : T.t('purposeFiles', { count: m.files.length })
}

/**
 * The quick scan: what the project is, where it starts, how it runs, its parts,
 * which docs to read and what to watch out for, in about forty lines. Shown in
 * plain chat with no team running, and at the top of MINDMAP.md.
 */
export function renderOverview(map, notes = {}, T = loadText()) {
  const c = map.counts
  const out = []
  const readme = Object.keys(map.docs).filter(rel => README.test(rel)).sort((a, b) => a.length - b.length)[0]
  const title = map.project?.name ?? (readme ? map.docs[readme].title : null) ?? T.t('projectFallback')
  out.push(T.t('overviewTitle', { title }), '')
  if (readme && map.docs[readme].summary) out.push(map.docs[readme].summary, '')
  const languages = {}
  for (const info of Object.values(map.files)) languages[info.language] = (languages[info.language] ?? 0) + 1
  out.push(T.t('overviewSize', { codeFiles: c.codeFiles, languages: top(languages, 5).map(([l, n]) => `${l} ${n}`).join(', ') || T.t('none'), docs: c.docs, modules: c.modules, symbols: c.symbols }))
  if (map.project?.entryPoints?.length) out.push(T.t('overviewStartsAt', { list: map.project.entryPoints.map(e => `\`${e}\``).join(', ') }))
  if (map.project?.commands?.length) out.push(T.t('overviewRunWith', { list: map.project.commands.slice(0, 8).map(cmd => `\`${cmd.run}\`${cmd.does ? ` (${cmd.does.slice(0, 50)})` : ''}`).join('; ') }))
  out.push('')
  const modules = Object.entries(map.modules).sort((a, b) => b[1].files.length - a[1].files.length).slice(0, 12)
  if (modules.length > 0) {
    out.push(T.t('overviewParts'))
    for (const [id, m] of modules) {
      const deps = Object.keys(m.dependsOn).slice(0, 3)
      out.push(T.t('overviewPart', { id, files: m.files.length, purpose: purposeOf(id, m, notes, T), uses: deps.length ? T.t('overviewPartUses', { list: deps.join(', ') }) : '' }))
    }
    out.push('')
  }
  const docAreas = {}
  for (const rel of Object.keys(map.docs)) { const area = rel.includes('/') ? rel.split('/')[0] + '/' : T.t('rootFolder'); docAreas[area] = (docAreas[area] ?? 0) + 1 }
  const inbound = {}
  for (const d of Object.values(map.docs)) for (const target of d.links) if (map.docs[target]) inbound[target] = (inbound[target] ?? 0) + 1
  const readFirst = [...new Set([readme, ...top(inbound, 5).map(([rel]) => rel)].filter(Boolean))]
  if (readFirst.length > 0) {
    out.push(T.t('overviewDocsFirst'))
    for (const rel of readFirst) out.push(`- \`${rel}\`: ${map.docs[rel].title ?? ''}${map.docs[rel].summary && rel !== readme ? `: ${map.docs[rel].summary.slice(0, 100)}` : ''}`)
    out.push(T.t('overviewDocsByFolder', { list: top(docAreas, 8).map(([a, n]) => `${a} ${n}`).join(', ') }), '')
  }
  const hubs = Object.entries(map.importedBy).map(([rel, list]) => [rel, list.length]).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (hubs.length > 0) out.push(T.t('overviewHubs', { list: hubs.map(([rel, n]) => `\`${rel}\` (${n})`).join(', ') }))
  const libs = Object.entries(map.libraries).map(([name, l]) => [name, l.usedBy.filter(rel => !map.files[rel]?.test).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (libs.length > 0) out.push(T.t('overviewLibraries', { list: libs.map(([name, count]) => T.t('overviewLibraryUse', { name, count })).join(', ') }))
  const warnings = []
  if (map.duplicates.length > 0) warnings.push(T.t('warnDuplicates', { count: map.duplicates.length, names: map.duplicates.slice(0, 4).map(d => d.name).join(', ') }))
  const undeclared = Object.entries(map.libraries).filter(([, l]) => l.undeclared).length
  if (undeclared > 0) warnings.push(T.t('warnUndeclared', { count: undeclared }))
  if (warnings.length > 0) out.push(T.t('overviewWatchOut', { list: warnings.join('; ') }))
  out.push('', T.t('overviewFooter', { date: map.generatedAt }), '')
  return out.join('\n')
}

/** The Markdown an agent reads before opening files: the overview, then the tree and the detail, bounded. */
export function renderSummary(map, overview, graph, T = loadText()) {
  overview ??= renderOverview(map, {}, T)
  graph ??= graphOf(map, {}, T)
  const out = []
  const c = map.counts
  const none = T.t('empty')
  out.push(T.t('summaryTitle'), '')
  out.push(T.t('summaryGenerated', { date: map.generatedAt }), '')
  out.push(T.t('summaryCounts', { codeFiles: c.codeFiles, docs: c.docs, modules: c.modules, symbols: c.symbols, calls: c.calls, libraries: c.libraries }), '')
  out.push(T.t('summaryHowTo'), '')
  out.push(overview.replace(/^# /, '## '), '')

  const modules = Object.entries(map.modules).sort((a, b) => b[1].files.length - a[1].files.length)
  const shown = modules.slice(0, 30)
  const shownIds = new Set(shown.map(([id]) => id))
  out.push(T.t('treeHeading'), '', T.t('treeIntro'), '', '```mermaid', renderMermaidMindmap(graph), '```', '')
  out.push(T.t('codeTreeHeading'), '', T.t('codeTreeIntro'), '', renderCodeTree(graph, T), '')
  const described = Object.entries(map.docs).filter(([, d]) => d.describes?.length)
  if (described.length > 0) {
    out.push(T.t('docsToCodeHeading'), '', T.t('docsToCodeIntro'), '')
    for (const [rel, d] of described.slice(0, 40)) {
      out.push(`- \`${rel}\``)
      for (const sec of (d.sections ?? []).filter(x => x.refs?.length).slice(0, 6)) out.push(`  - ${sec.heading} (${T.t('docLine', { line: sec.line })}): ${sec.refs.slice(0, 6).map(r => `\`${r}\``).join(', ')}${sec.refs.length > 6 ? ', ...' : ''}`)
    }
    out.push('')
  }
  out.push(T.t('moduleGraphHeading'), '', '```mermaid', 'graph TD')
  for (const [id, m] of shown) out.push(`  ${safeId(id)}["${T.t('mermaidModule', { id: safeLabel(id), files: m.files.length, languages: safeLabel(top(m.languages, 2).map(([l]) => l).join(', ')) })}"]`)
  for (const [id, m] of shown) for (const [to, count] of top(m.dependsOn, 8)) if (shownIds.has(to)) out.push(`  ${safeId(id)} -->|${count}| ${safeId(to)}`)
  out.push('```', '')

  const columns = header => [header, header.replace(/[^|]+/g, '---')]
  out.push(T.t('modulesHeading'), '', ...columns(T.t('modulesColumns')))
  for (const [id, m] of shown) {
    out.push(`| \`${cell(id)}\` | ${m.files.length} | ${cell(top(m.languages, 3).map(([l, n]) => `${l} ${n}`).join(', '))} | ${cell(top(m.dependsOn, 5).map(([d]) => d).join(', ') || none)} | ${cell(top(m.usedBy, 5).map(([d]) => d).join(', ') || none)} | ${cell(m.libraries.slice(0, 6).join(', ') || none)} | ${cell(m.exports.slice(0, 6).map(e => e.split(' ')[0]).join(', ') || none)} |`)
  }
  if (modules.length > shown.length) out.push('', T.t('modulesOmitted', { count: modules.length - shown.length }))
  out.push('')

  const docs = Object.entries(map.docs)
  if (docs.length > 0) {
    out.push(T.t('documentationHeading'), '', ...columns(T.t('documentationColumns')))
    for (const [rel, d] of docs.slice(0, 60)) out.push(`| \`${cell(rel)}\` | ${cell(d.title ?? none)} | ${cell((d.summary ?? none).slice(0, 120))} |`)
    if (docs.length > 60) out.push('', T.t('docsOmitted', { count: docs.length - 60 }))
    out.push('')
  }

  const hubs = Object.entries(map.importedBy).map(([rel, list]) => [rel, list.length]).sort((a, b) => b[1] - a[1]).slice(0, 15)
  if (hubs.length > 0) {
    out.push(T.t('hubsHeading'), '', ...columns(T.t('hubsColumns')))
    for (const [rel, n] of hubs) out.push(`| \`${cell(rel)}\` | ${n} | ${cell((map.files[rel]?.symbols ?? []).filter(s => s.exported).slice(0, 8).map(s => s.name).join(', ') || none)} |`)
    out.push('')
  }

  const inbound = {}
  for (const call of map.calls) inbound[call.to] = (inbound[call.to] ?? 0) + call.count
  const called = top(inbound, 15)
  if (called.length > 0) {
    out.push(T.t('calledHeading'), '', ...columns(T.t('calledColumns')))
    for (const [fn, n] of called) out.push(`| \`${cell(fn)}\` | ${n} |`)
    out.push('')
  }

  const libs = Object.entries(map.libraries).sort((a, b) => b[1].usedBy.length - a[1].usedBy.length)
  if (libs.length > 0) {
    out.push(T.t('librariesHeading'), '', ...columns(T.t('librariesColumns')))
    for (const [name, l] of libs.slice(0, 40)) out.push(`| \`${cell(name)}\` | ${cell(l.declaredIn.map(d => d.manifest).join(', ') || none)} | ${l.usedBy.length} | ${l.undeclared ? T.t('libraryUndeclared') : l.unusedInScannedCode ? T.t('libraryUnused') : ''} |`)
    out.push('')
  }

  if (map.duplicates.length > 0) {
    out.push(T.t('duplicatesHeading'), '', T.t('duplicatesIntro'), '')
    for (const d of map.duplicates.slice(0, 25)) out.push(`- \`${d.name}\`: ${d.definitions.slice(0, 5).join(', ')}`)
    out.push('')
  }
  out.push(T.t('limitsHeading'), '', T.t('limitsNote'), '')
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
  const T = loadText(dest)
  if (!saved) return { dest, saved: false, stale: true, next: T.t('statusNoMap') }
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
    next: stale ? T.t('statusStale') : T.t('statusCurrent'),
  }
}

/**
 * The quick scan for plain chat: the saved OVERVIEW.md (with how many files
 * changed since), or one built now when nothing is saved. Writes nothing.
 */
export function mindMapOverview(destInput, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const T = loadText(dest)
  const saved = loadSaved(dest)
  if (!saved) {
    const built = buildMindMap(dest)
    return { dest, source: T.t('sourceBuiltKeep'), overview: built.overview }
  }
  let overview
  try { overview = fs.readFileSync(path.join(dest, MINDMAP_DIR, OVERVIEW_FILE), 'utf8') } catch { overview = renderOverview(saved, readNotes(dest), T) }
  const status = mindMapStatus(dest)
  const changed = status.changed.length + status.added.length + status.removed.length
  return { dest, source: T.t('sourceSaved', { date: saved.generatedAt }), stale: status.stale, changedFiles: changed, overview, ...(changed > 0 ? { next: T.t('overviewChanged', { count: changed, files: [...status.changed, ...status.added, ...status.removed].slice(0, 10).join(', ') }) } : {}) }
}

const parseRef = ref => { const i = ref.lastIndexOf('#'); return { file: ref.slice(0, i), name: ref.slice(i + 1) } }

/**
 * Answers one question from the map so an agent does not open files to find
 * it. Uses the saved map when there is one (`fresh` rebuilds in memory).
 */
export function mindMapQuery(destInput, { symbol, file, module, library, search, fresh = false, limit = 30 } = {}, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const T = loadText(dest)
  const asked = [symbol, file, module, library, search].filter(v => v !== undefined)
  if (asked.length !== 1) throw new Error(T.t('errQueryOne'))
  if (typeof asked[0] !== 'string' || asked[0].length < 1 || asked[0].length > 300) throw new Error(T.t('errQueryString'))
  const saved = fresh ? undefined : loadSaved(dest)
  const map = saved ?? buildMindMap(dest).map
  const source = saved ? T.t('sourceSavedQuery', { date: saved.generatedAt }) : T.t('sourceBuilt')
  const cap = list => list.slice(0, limit)

  if (symbol !== undefined) {
    const definitions = []
    const notes = readNotes(dest)
    for (const [rel, info] of Object.entries(map.files)) for (const s of info.symbols) if (s.name === symbol) definitions.push({ file: rel, line: s.line, end: s.end, kind: s.kind, exported: s.exported, signature: s.signature, doc: s.doc, notes: notes[`${rel}#${s.name}`] ?? notes[s.name], documentedIn: s.documentedIn ?? [], module: info.module, testedBy: map.testedBy[rel] ?? [], documentedBy: info.documentedBy ?? [] })
    const callers = map.calls.filter(c => parseRef(c.to).name === symbol).map(c => ({ caller: c.from, callee: c.to, count: c.count }))
    const docOf = ref => { const { file, name } = parseRef(ref); return map.files[file]?.symbols.find(s => s.name === name)?.doc }
    const callees = map.calls.filter(c => parseRef(c.from).name === symbol).map(c => ({ caller: c.from, callee: c.to, count: c.count, ...(docOf(c.to) ? { calleeDoc: docOf(c.to) } : {}) }))
    const lower = symbol.toLowerCase()
    const similar = definitions.length > 0 ? [] : cap([...new Set(Object.values(map.files).flatMap(f => f.symbols.map(s => s.name)).filter(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()) && n.length > 3))])
    return { dest, source, symbol, definitions: cap(definitions), callers: cap(callers), callees: cap(callees), ...(similar.length > 0 ? { similarNames: similar } : {}), ...(definitions.length > 1 ? { warning: T.t('warnDefinedTwice') } : {}) }
  }
  if (file !== undefined) {
    const rel = file.replace(/^\.\//, '')
    const info = map.files[rel]
    const doc = map.docs[rel]
    if (!info && !doc) throw new Error(T.t('errNotInMap', { file: rel }))
    if (doc) return { dest, source, file: rel, doc, linkedFrom: Object.entries(map.docs).filter(([, d]) => d.links.includes(rel)).map(([r]) => r) }
    return { dest, source, file: rel, doc: info.doc, notes: readNotes(dest)[rel], language: info.language, module: info.module, lines: info.lines, test: info.test, symbols: info.symbols, imports: info.imports, importedBy: map.importedBy[rel] ?? [], libraries: info.libraries, testedBy: map.testedBy[rel] ?? [], documentedBy: info.documentedBy ?? [], callsOut: cap(map.calls.filter(c => parseRef(c.from).file === rel)), callsIn: cap(map.calls.filter(c => parseRef(c.to).file === rel && parseRef(c.from).file !== rel)) }
  }
  if (module !== undefined) {
    const m = map.modules[module]
    if (!m) throw new Error(T.t('errNoModule', { module, list: Object.keys(map.modules).slice(0, 40).join(', ') }))
    return { dest, source, module, ...m, files: cap(m.files) }
  }
  if (library !== undefined) {
    const key = Object.keys(map.libraries).find(name => name.toLowerCase() === library.toLowerCase())
    if (!key) return { dest, source, library, found: false, note: T.t('libraryNotFound') }
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
      else console.log(result.saved ? `${loadText(dest).t('cliSaved', { files: result.saved.join(', ') })}\n${JSON.stringify(result.map.counts)}` : result.summary)
    } else if (command === 'tree') {
      const result = mindMapTree(dest, { node: opt('--node') ?? 'project', depth: opt('--depth') === undefined ? 2 : Number(opt('--depth')), fresh: args.includes('--fresh') })
      console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : [result.text, ...Object.entries(result.links).flatMap(([dir, groups]) => Object.entries(groups).map(([kind, list]) => `${dir === 'out' ? '->' : '<-'} ${kind}: ${list.map(l => l.name).join(', ')}`))].join('\n'))
    } else if (command === 'note') {
      console.log(JSON.stringify(mindMapNote(dest, { node: opt('--node'), text: opt('--text'), apply: args.includes('--apply') }), null, 2))
    } else if (command === 'overview') {
      const result = mindMapOverview(dest)
      console.log(args.includes('--json') ? JSON.stringify(result) : result.overview + (result.next ? `\n${result.next}` : ''))
    } else if (command === 'status') {
      console.log(JSON.stringify(mindMapStatus(dest), null, 2))
    } else if (command === 'query') {
      const query = Object.fromEntries(['symbol', 'file', 'module', 'library', 'search'].map(k => [k, opt('--' + k)]).filter(([, v]) => v !== undefined))
      console.log(JSON.stringify(mindMapQuery(dest, { ...query, fresh: args.includes('--fresh') }), null, 2))
    } else {
      console.error(loadText().t('cliUsage'))
      process.exitCode = 2
    }
  } catch (error) {
    console.error(loadText().t('cliFailed', { message: error.message }))
    process.exitCode = 1
  }
}
