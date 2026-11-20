#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { bareCode, scanProject } from './devops-cleanup.mjs'
import {
  auditDiff, codeRows, parseAdded, readDiff, snapshotReader, syntaxTable,
} from './devops-comments.mjs'
import { PATTERNS, RULES } from './devops-lint-rules.mjs'
import { detectLanguages, resolveDest } from './devops-setup.mjs'
import { loadStandards, magicLimits } from './devops-standards.mjs'
import { git } from './devops-tags.mjs'
import { isMain } from './devops-main.mjs'

const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|(\.|_)(test|spec)\.[a-z]+$|^test_|\/test_/i
const EXEMPT_NAME = /^(_.*|main|init|constructor|default|setup|teardown|__\w+__|test\w*|Test\w*)$/
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'switch', 'case', 'catch', 'function', 'return', 'with', 'new',
  'throw', 'this', 'super', 'self', 'true', 'false', 'null', 'nil', 'await', 'yield', 'delete',
  'typeof', 'in', 'of', 'break', 'continue', 'goto', 'sizeof', 'default',
])
/** Languages whose numbers are layout or data (CSS sizes, SQL limits, ports in config), not code. */
const NOT_CODE = new Set([null, 'css', 'html', 'sql', 'terraform', 'containers', 'ci-workflows'])
const PUBLIC_LINE = /^\s*(export|pub|public|open|protected)\b/
const JS_DECLARATIONS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/,
]
const MODIFIERS = /(?:private|protected|internal|public|static|final|var|val|let|auto|readonly|mut)/
const TYPED_LOCAL = new RegExp(`^\\s*(?:${MODIFIERS.source}\\s+)*`
  + /(?:[A-Za-z_][\w<>[\],.?]*\s+)?([a-z_]\w*)\s*(?::[^=]+)?=(?!=)/.source)
const METHOD_WORDS = /(?:static|final|async|override|fun|func|function|inline)/
const PRIVATE_METHOD = new RegExp(`^\\s*(?:private|fileprivate)\\s+(?:${METHOD_WORDS.source}\\s+)*`
  + /(?:[\w<>[\],.?]+\s+)?([A-Za-z_]\w*)\s*[(<]/.source)
const NOT_A_USE_LINE = /^\s*(#|import\b|from\b|using\b|package\b)/
const STATIC_C_FUNCTION = /^\s*static\s+(?:inline\s+)?[\w\s*]+?\b([a-z_]\w*)\s*\(/
const TYPED_DECLARATIONS = [TYPED_LOCAL, PRIVATE_METHOD]
const DECLARATIONS = {
  javascript: JS_DECLARATIONS,
  typescript: JS_DECLARATIONS,
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/],
  rust: [/^\s*(?:pub\s+)?fn\s+([a-z_]\w*)/],
  java: TYPED_DECLARATIONS,
  csharp: TYPED_DECLARATIONS,
  kotlin: TYPED_DECLARATIONS,
  scala: TYPED_DECLARATIONS,
  swift: TYPED_DECLARATIONS,
  dart: TYPED_DECLARATIONS,
  php: [PRIVATE_METHOD],
  c: [STATIC_C_FUNCTION, TYPED_LOCAL],
  cpp: [STATIC_C_FUNCTION, TYPED_LOCAL],
}
/** A named constant: an UPPER_CASE name assigned once, as most style guides spell constants. */
const UPPER_CONSTANT = /^\s*(?:[\w$<>[\],.?]+\s+)*?([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=(?!=)/
const DEFINE = /^\s*#\s*define\s+([A-Za-z_]\w*)/
const KEYWORD_CONSTANT = new RegExp(
  /\b(?:const|constexpr|static\s+final|final\s+static|static\s+readonly|static\s+let)\b/.source
  + /[^=;(]*?\b([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.source)
/** Languages where `const` (or `static final`) declares a constant, so any name spelling counts. */
const KEYWORD_CONSTANT_LANGUAGES = new Set([
  'go', 'csharp', 'c', 'cpp', 'rust', 'swift', 'dart', 'zig', 'java', 'kotlin', 'scala', 'php',
])
const NUMBER_LITERAL = new RegExp(
  /(?<![\w.$])(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.source
  + /[lLfFdDuU]*(?![\w.])/.source, 'g')
const DOC_PATHS = ['*.md', '*.mdx', '*.rst', '*.adoc', '*.txt'].map(glob => `:(exclude)${glob}`)
const SIZE_REASONS = [
  ['code lines', 'function-length'],
  ['nesting', 'nesting'],
  ['parameters', 'too-many-params'],
]
const SCAN_LIMIT = 1000
const QUOTE_LIMIT = 80
const USAGE = 'usage: devops-lint check [--dest DIR] [--base REF [--head REF]] [--staged] '
  + '[--push PUSH.json] [--json] | commands [--dest DIR]'

/** A path glob (`*` within a segment, `**` across segments) as a regular expression. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${pattern}$`)
}

/** A finding at `level` 'blocking' or 'non-blocking', with its rule's category and fix. */
function leveled(base, level) {
  const [category, fix] = RULES[base.rule]
  const label = level === 'blocking' ? 'issue (blocking)' : 'suggestion (non-blocking)'
  const remark = `${label}: ${base.message} Fix: ${fix}`
  return { ...base, category, blocking: level === 'blocking', fix, remark }
}

const finding = (file, line, rule, message) => leveled({ file, line, rule, message }, 'blocking')

/** Names imported with `import { a, b as c } from` (JS) or `from x import a, b as c` (Python). */
function importedNames(text) {
  const braces = /^\s*import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from/.exec(text)
  const fromImport = /^\s*from\s+[\w.]+\s+import\s+\(?([^)#]+)\)?/.exec(text)
  const list = braces?.[1] ?? fromImport?.[1]
  if (!list) return []
  const nameOf = part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()
  return list.split(',').map(nameOf).filter(Boolean)
}

/** The constant a line defines, if it defines one: `MAX_SIZE = 7`, `#define N 7`, `const int Max = 7`. */
function constantName(text, languageId) {
  const upper = UPPER_CONSTANT.exec(text)?.[1] ?? DEFINE.exec(text)?.[1]
  if (upper) return upper
  return KEYWORD_CONSTANT_LANGUAGES.has(languageId) ? KEYWORD_CONSTANT.exec(text)?.[1] : undefined
}

/** Go exports by capital letter, not by keyword. */
const isPublicName = (name, languageId) => languageId === 'go' && /^[A-Z]/.test(name)

function declaredNames(text, languageId, { exemptPublic }) {
  if (exemptPublic && PUBLIC_LINE.test(text)) return []
  const names = (DECLARATIONS[languageId] ?? []).map(re => re.exec(text)?.[1])
  names.push(constantName(text, languageId))
  const hasImports = ['javascript', 'typescript', 'python'].includes(languageId)
  if (hasImports) names.push(...importedNames(text))
  const wanted = name => name && name !== '*' && !KEYWORDS.has(name) && !EXEMPT_NAME.test(name)
    && !(exemptPublic && isPublicName(name, languageId))
  return [...new Set(names.filter(wanted))]
}

/** Where to search: the index, the range's head commit, or the working tree with untracked files. */
function snapshotArgs({ base, head = 'HEAD', staged }) {
  if (base) return { flags: [], revision: [head] }
  return { flags: [staged ? '--cached' : '--untracked'], revision: [] }
}

/** How often `name` appears in the code of the audited snapshot (docs left out). */
function mentions(dest, name, snapshot) {
  const { flags, revision } = snapshotArgs(snapshot)
  const pattern = ['-w', '-o', '-F', ...flags, '-e', name]
  const args = ['grep', ...pattern, ...revision, '--', '.', ...DOC_PATHS]
  const ran = git(dest, args)
  return ran.ok ? ran.out.split('\n').filter(Boolean).length : 0
}

function unusedSymbols(dest, { file, rows, languageId, snapshot }, lint) {
  if (NOT_CODE.has(languageId) || TEST_FILE.test(file)) return []
  const exemptPublic = lint?.exemptPublic === true
  return rows.flatMap(row => declaredNames(row.text, languageId, { exemptPublic })
    .filter(name => mentions(dest, name, snapshot) <= 1)
    .map(name => `\`${name}\` is declared but never used.`)
    .map(message => finding(file, row.line, 'unused-symbol', message)))
}

const literalValue = text => {
  const digits = text.replace(/_/g, '')
  return Number(/^0[xXbB]/.test(digits) ? digits : digits.replace(/[lLfFdDuU]+$/, ''))
}

/** Numbers used directly in code. A line that defines a named constant, an import or a directive is skipped. */
function magicNumbers({ file, rows, languageId, markers }, magic) {
  if (NOT_CODE.has(languageId) || (TEST_FILE.test(file) && !magic.checkTests)) return []
  const out = []
  for (const row of rows) {
    const code = bareCode(row.text, markers)
    if (constantName(code, languageId) || NOT_A_USE_LINE.test(code)) continue
    const numbers = [...code.matchAll(NUMBER_LITERAL)].map(m => m[0])
      .filter(n => !magic.allowed.includes(literalValue(n)))
    if (numbers.length === 0) continue
    const list = [...new Set(numbers)].map(n => `\`${n}\``).join(', ')
    const message = `${list} used directly in code; name it as a constant.`
    out.push(finding(file, row.line, 'magic-number', message))
  }
  return out
}

function describe(pattern, text) {
  if (pattern.use) return `outdated code; use ${pattern.use} instead.`
  return `${RULES[pattern.rule][0]} risk: \`${text.trim().slice(0, QUOTE_LIMIT)}\`.`
}

function patternFindings(file, rows, languageId) {
  const patterns = PATTERNS.filter(p => p.languages === '*' || p.languages.includes(languageId))
  const out = []
  for (const row of rows) {
    for (const p of patterns.filter(q => q.re.test(row.text))) {
      out.push(finding(file, row.line, p.rule, describe(p, row.text)))
    }
  }
  return out
}

/** The size findings one cleanup candidate gives, or none when the change does not touch it. */
function candidateFindings(c, added) {
  if (![...added].some(line => line >= c.from && line <= c.to)) return []
  if (c.kind === 'flag-argument') return [finding(c.file, c.from, 'flag-argument', c.suggestion)]
  if (c.kind !== 'long-function') return []
  return c.reasons.flatMap(reason => {
    const rule = SIZE_REASONS.find(([word]) => reason.includes(word))?.[1]
    return rule ? [finding(c.file, c.from, rule, `${c.name}: ${reason}.`)] : []
  })
}

/** Size rules from the cleanup scan, kept where the function touches an added line. */
function sizeFindings(dest, addedByFile, { roots, snapshot }) {
  const paths = [...addedByFile.keys()]
  if (paths.length === 0) return []
  const readFile = snapshotReader(dest, snapshot)
  const scan = scanProject(dest, { goals: ['split'], paths, limit: SCAN_LIMIT, roots, readFile })
  return scan.candidates
    .filter(c => addedByFile.has(c.file))
    .flatMap(c => candidateFindings(c, addedByFile.get(c.file)))
}

function linterEntries(standards, id) {
  const entry = standards.linters?.[id]
  const list = Array.isArray(entry) ? entry : entry ? [entry] : []
  return list.filter(l => typeof l.command === 'string')
}

/** The open-source linter commands for this project's languages; Coders run them in the sandbox. */
export function lintCommands(destInput, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const standards = loadStandards(dest)
  const languages = detectLanguages(dest).map(l => l.id)
  const commands = [...languages, 'all'].flatMap(id => linterEntries(standards, id)
    .map(l => ({ language: id, tool: l.tool, command: l.command })))
  return { dest, languages, commands }
}

/** Checks the Push JSON `lint.tools`: every linter command ran, and each exited 0. */
function toolFindings(commands, push) {
  const ran = Array.isArray(push?.lint?.tools) ? push.lint.tools : []
  return commands.flatMap(({ tool, command }) => {
    const record = ran.find(t => t.command === command)
    const quoted = `\`${command}\``
    const message = `${tool} was not run: ${quoted}.`
    if (!record) return [finding('(linters)', 0, 'linter-not-run', message)]
    if (record.exit === 0) return []
    return [finding('(linters)', 0, 'linter-failed', `${tool} exited ${record.exit}: ${quoted}.`)]
  })
}

function codeFindings(dest, diffText, { standards, roots, snapshot }) {
  const syntaxFor = syntaxTable(dest)
  const byFile = new Map()
  for (const row of parseAdded(diffText)) {
    if (!byFile.has(row.file)) byFile.set(row.file, [])
    byFile.get(row.file).push(row)
  }
  const out = []
  const addedByFile = new Map()
  for (const [file, rows] of byFile) {
    const syntax = syntaxFor(file)
    if (!syntax) continue
    const code = codeRows(rows, syntax)
    addedByFile.set(file, new Set(rows.map(r => r.line)))
    const unit = { file, rows: code, languageId: syntax.id, markers: syntax.line, snapshot }
    out.push(...patternFindings(file, code, syntax.id))
    out.push(...unusedSymbols(dest, unit, standards.lint))
    out.push(...magicNumbers(unit, magicLimits(standards, syntax.id)))
  }
  return [...out, ...sizeFindings(dest, addedByFile, { roots, snapshot })]
}

/** The comment audit's findings under the same rule ids, with their fix. */
function commentFindings(dest, diffText, standards, { listed, docs, snapshot }) {
  const readFile = snapshotReader(dest, snapshot)
  const options = { listed, docs, syntaxFor: syntaxTable(dest), readFile }
  return auditDiff(diffText, standards, options).findings.map(f => {
    const message = f.remark.replace(/^[a-z]+ \([a-z-]+\): /, '')
    const level = f.blocking ? 'blocking' : 'non-blocking'
    return leveled({ file: f.file, line: f.line, rule: f.rule, message }, level)
  })
}

function applyConfig(findings, lint) {
  const rules = lint?.rules ?? {}
  const excluded = (lint?.exclude ?? []).map(globToRegExp)
  return findings.filter(f => rules[f.rule] !== 'off' && !excluded.some(re => re.test(f.file)))
}

function summarize(findings) {
  const order = (a, b) => a.file.localeCompare(b.file)
    || a.line - b.line
    || a.rule.localeCompare(b.rule)
  findings.sort(order)
  const blocking = findings.filter(f => f.blocking).length
  const byRule = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  const verdict = blocking > 0 ? 'DENY' : 'PASS'
  return { verdict, blocking, nonBlocking: findings.length - blocking, byRule, findings }
}

/**
 * Lint a change: the comment rules, code line length, function size, unused symbols, security patterns,
 * outdated APIs and debug leftovers, on the lines it adds. With `push` (the Push JSON), it also checks that
 * every open-source linter command ran and passed. Every finding names its rule and how to fix it.
 */
export function lintCheck(destInput, options = {}) {
  const { base, head, staged = false, listed, docs, push, roots } = options
  const dest = resolveDest(destInput, roots)
  const standards = loadStandards(dest)
  const snapshot = { base, head, staged }
  const diff = readDiff(dest, snapshot)
  const tools = push ? toolFindings(lintCommands(dest, { roots }).commands, push) : []
  const all = [
    ...commentFindings(dest, diff.text, standards, { listed, docs, snapshot }),
    ...codeFindings(dest, diff.text, { standards, roots, snapshot }),
    ...tools,
  ]
  return { dest, source: diff.source, ...summarize(applyConfig(all, standards.lint)) }
}

function print(result) {
  const counts = `${result.blocking} blocking, ${result.nonBlocking} non-blocking`
  console.log(`${result.source}: ${result.verdict}, ${counts}`)
  for (const f of result.findings) console.log(`${f.file}:${f.line}  [${f.rule}] ${f.remark}`)
}

function main(argv) {
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  if (command === 'commands') {
    for (const c of lintCommands(dest).commands) {
      console.log(`${c.language}\t${c.tool}\t${c.command}`)
    }
    return 0
  }
  if (command !== 'check') throw new Error(USAGE)
  const push = opt('--push') ? JSON.parse(fs.readFileSync(opt('--push'), 'utf8')) : undefined
  const options = { base: opt('--base'), head: opt('--head'), staged: argv.includes('--staged') }
  const result = lintCheck(dest, { ...options, listed: push?.comments, docs: push?.docs, push })
  if (argv.includes('--json')) console.log(JSON.stringify(result))
  else print(result)
  return result.blocking > 0 ? 1 : 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-lint: ${error.message}`)
    process.exitCode = 2
  }
}
