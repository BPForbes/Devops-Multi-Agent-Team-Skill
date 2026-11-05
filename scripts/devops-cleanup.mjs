#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInside, loadLanguages, resolveDest, walk } from './devops-setup.mjs'
import { auditDiff, syntaxTable } from './devops-comments.mjs'
import { extensionTable, languageOf } from './devops-research.mjs'

const DEFAULTS = { minDuplicateLines: 6, minDuplicateChars: 120, maxFunctionLines: 30, maxNesting: 3, maxParams: 4, maxMagicLiteralRepeats: 2, maxFiles: 4000, maxFileBytes: 307200 }
const BRACE_LANGUAGES = new Set(['c', 'cpp', 'csharp', 'java', 'kotlin', 'typescript', 'javascript', 'go', 'rust', 'php', 'swift', 'dart', 'scala', 'zig', 'shell', 'powershell'])
const SKIP_FILE = /(\.min\.|\.generated\.|\.pb\.|\.lock$|package-lock\.json$|(^|\/)(dist|build|vendor|node_modules|third_party|deps)\/)/
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|(\.|_)(test|spec)\.[a-z]+$|^test_|\/test_/i
const NOT_A_FUNCTION = new Set(['if', 'for', 'while', 'switch', 'catch', 'else', 'return', 'sizeof', 'synchronized', 'using', 'lock', 'foreach', 'do', 'try', 'with', 'when', 'match', 'loop', 'unless', 'until', 'defer'])
const IMPORT_LINE = /^(import\b|from\b.+\bimport\b|#include|using\b|use\b|package\b|require\b|extern crate\b|@import)/
const STRUCTURAL = /^([{}()\[\];,]+|end|fi|done|esac|else|endif|endfunction|\)\s*;?)$/

const GOALS = {
  comments: /\b(comments?|commented|docstrings?|noise|over-?comment\w*|annotations?)\b/,
  duplicates: /\b(duplicat\w*|dry|copy-?paste\w*|copies|copied|repeated|repeating|redundan\w*|same code|reimplement\w*|re-implement\w*|reuse)\b/,
  split: /\b(split|large|long|big|huge|giant|helpers?|extract\w*|break(ing)? (it |them )?up|smaller|decompos\w*|too many lines|nest\w*|complex\w*)\b/,
  dead: /\b(dead code|unused|unreachable|commented[- ]out)\b/,
  naming: /\b(rename\w*|naming|names?|readab\w*|vague|descriptive|meaningful|intention)\b/,
  constants: /\b(magic numbers?|constants?|hard-?coded|literals?)\b/,
}
const ALL_GOALS = ['comments', 'duplicates', 'split', 'constants', 'naming']

/** Turn a plain-English cleanup statement into a brief: goals, scope, thresholds, constraints, and anything left over. */
export function parseStatement(text, destInput, roots) {
  const dest = resolveDest(destInput, roots)
  const statement = String(text ?? '').trim().slice(0, 2000)
  const lower = statement.toLowerCase()
  const goals = Object.keys(GOALS).filter(g => GOALS[g].test(lower))
  const generic = /\b(clean ?up|tidy|refactor|polish|clean[- ]code)\b/.test(lower)
  const cleanCode = /\bclean[- ]code\b/.test(lower)
  const chosen = cleanCode ? ALL_GOALS : goals.length > 0 ? goals : ALL_GOALS
  const thresholds = {}
  const number = rx => { const m = rx.exec(lower); return m ? Number(m[1]) : undefined }
  thresholds.maxFunctionLines = number(/(?:over|more than|longer than|above|exceed\w*|>)\s*(\d+)\s*(?:lines|loc)/) ?? number(/(\d+)\s*(?:lines|loc)\s*(?:long|or more)?/)
  thresholds.maxNesting = number(/nest\w*\D{0,14}(\d+)/)
  thresholds.maxParams = number(/(\d+)\s*(?:params|parameters|arguments|args)/)
  thresholds.minDuplicateLines = number(/(?:at least|over|more than)\s*(\d+)\s*(?:duplicate|repeated|identical)?\s*lines\s*(?:of )?(?:duplicate|repeated|identical)/)
  for (const k of Object.keys(thresholds)) if (thresholds[k] === undefined || thresholds[k] < 2 || thresholds[k] > 1000) delete thresholds[k]

  const words = (statement.match(/[A-Za-z0-9._][A-Za-z0-9._\/-]*/g) ?? []).map(w => w.replace(/[.,;:]+$/, '')).filter(Boolean)
  const exists = word => /^[A-Za-z0-9._][A-Za-z0-9._\/-]*$/.test(word) && !word.includes('..') && fs.existsSync(path.join(dest, word))
  const excludeWords = new Set([...lower.matchAll(/(?:don'?t|do not|never|without|except|excluding|skip|ignore|leave)\s+(?:touch(?:ing)?\s+|chang(?:e|ing)\s+|modify(?:ing)?\s+|edit(?:ing)?\s+)?(?:the\s+)?([a-z0-9._\/-]+)/g)].map(m => m[1].replace(/[.,;:]+$/, '')))
  const paths = [...new Set(words.filter(w => exists(w) && !excludeWords.has(w.toLowerCase())))].slice(0, 20)
  const exclude = [...new Set(words.filter(w => exists(w) && excludeWords.has(w.toLowerCase())))]
  const skipTests = /\b(skip|ignore|exclude|excluding|except|not|without|leave)\b[^.]{0,20}\btests?\b/.test(lower)
  if (skipTests) exclude.push('tests')

  const sentences = statement.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)
  const constraints = sentences.filter(s => /\b(don'?t|do not|never|must|keep|preserve|only|without|no new|stay|same)\b/i.test(s)).slice(0, 8)
  const understood = sentences.filter(s => Object.values(GOALS).some(rx => rx.test(s.toLowerCase())) || constraints.includes(s) || /\b(clean ?up|tidy|refactor|clean[- ]code)\b/i.test(s))
  return {
    dest, statement,
    goals: chosen, defaultedGoals: goals.length === 0, generic,
    scope: { paths, exclude },
    thresholds: { ...DEFAULTS, ...thresholds, ...(loadLanguages(dest).cleanup ?? {}), ...thresholds },
    constraints: ['Behavior is preserved: the same inputs give the same outputs, errors and side effects.', 'The validation commands pass before the first step and after every step.', 'No public API, wire format or file format changes unless the statement says so.', 'One kind of change per step; no cleanup mixed with a feature or a bug fix.', ...constraints],
    notScanned: chosen.includes('naming') ? ['naming: the scan only finds names that are plainly vague; judging whether a name reveals intent is the Reviewer\'s call, and the Coder renames only what the statement asked for'] : [],
    unrecognized: sentences.filter(s => !understood.includes(s)),
  }
}

const stripStrings = line => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
const stripLineComment = (line, markers) => {
  const code = stripStrings(line)
  for (const m of markers) { const at = code.indexOf(m); if (at !== -1) return code.slice(0, at) }
  return code
}

function parenGroup(signature) {
  const open = signature.indexOf('(')
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < signature.length; i++) {
    if (signature[i] === '(') depth += 1
    else if (signature[i] === ')' && --depth === 0) return signature.slice(open + 1, i)
  }
  return signature.slice(open + 1)
}

function countParams(signature) {
  const inner = parenGroup(signature)
  if (inner.trim() === '') return 0
  let depth = 0
  let count = 1
  for (const ch of inner) {
    if ('([{<'.includes(ch)) depth += 1
    else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) count += 1
  }
  return count
}

function braceFunctions(lines, markers, language) {
  const found = []
  const starts = [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|const\s+|extern\s+"[^"]*"\s+)*fn\s+(\w+)/,
    /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*\w*\s*\(.*\)|(?:\(.*\)|\w+)\s*=>)\s*\{?\s*$/,
    /^\s*(?:function|fun)\s+\*?\s*([\w-]+)/,
    /^\s*(?:[\w:<>\[\],*&.?\s]+?\s+)?([A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const|noexcept|override|final|throws[\w\s,.]*|:\s*[\w<>\[\]?.\s]+|->\s*[\w<>\[\]?.\s&*]+)?\s*\{?\s*$/,
  ]
  for (let i = 0; i < lines.length; i++) {
    const code = stripLineComment(lines[i], markers)
    if (code.trim() === '' || /^\s*(?:return|else|new|throw|await|case|break|continue|goto|delete|print|echo)\b/.test(code)) continue
    let name
    let generic = false
    for (const [at, rx] of starts.entries()) { const m = rx.exec(code); if (m) { name = m[1]; generic = at === starts.length - 1; break } }
    if (!name || NOT_A_FUNCTION.has(name)) continue
    if (generic && !code.trimEnd().endsWith('{') && !(lines[i + 1] ?? '').trim().startsWith('{')) continue
    let open = -1
    for (let j = i; j < Math.min(lines.length, i + 4); j++) { if (stripLineComment(lines[j], markers).includes('{')) { open = j; break } if (j > i && /;\s*$/.test(stripLineComment(lines[j], markers))) break }
    if (open === -1) continue
    let depth = 0
    let deepest = 0
    let end = -1
    for (let j = open; j < lines.length; j++) {
      for (const ch of stripLineComment(lines[j], markers)) {
        if (ch === '{') { depth += 1; deepest = Math.max(deepest, depth) }
        else if (ch === '}') { depth -= 1; if (depth === 0) { end = j; break } }
      }
      if (end !== -1) break
    }
    if (end === -1) continue
    const signature = lines.slice(i, open + 1).join(' ')
    found.push({ name, from: i + 1, to: end + 1, deepest: deepest - 1, signature })
    i = Math.max(i, open)
  }
  return found
}

function pythonFunctions(lines) {
  const found = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i])
    if (!m) continue
    const base = m[1].length
    let signature = lines[i]
    let bodyStart = i + 1
    for (let j = i; j < Math.min(lines.length, i + 12) && !/\)\s*(?:->.*)?:\s*(#.*)?$/.test(lines[j]); j++) { signature += ' ' + (lines[j + 1] ?? ''); bodyStart = j + 2 }
    let end = bodyStart - 1
    let unit = 0
    let deepestIndent = base
    for (let j = bodyStart; j < lines.length; j++) {
      if (lines[j].trim() === '') continue
      const indent = /^\s*/.exec(lines[j])[0].length
      if (indent <= base) break
      end = j
      if (!/^\s*#/.test(lines[j])) { deepestIndent = Math.max(deepestIndent, indent); if (unit === 0) unit = indent - base }
    }
    const nesting = unit > 0 ? Math.round((deepestIndent - base) / unit) - 1 : 0
    found.push({ name: m[2], from: i + 1, to: end + 1, deepest: nesting, signature })
  }
  return found
}

const VAGUE_NAMES = new Set(['data', 'info', 'tmp', 'temp', 'foo', 'bar', 'baz', 'stuff', 'thing', 'obj', 'var1', 'var2', 'x1', 'x2', 'calc', 'doit', 'handle', 'process'])
const LOOP_NAMES = new Set(['i', 'j', 'k', 'n', 'x', 'y', 'z', 'e', '_'])
const DECLARATION = /\b(?:let|const|var|val|int|long|short|double|float|bool|boolean|char|string|String|auto|def|fn|func|function|class|struct|interface)\s+([A-Za-z_]\w*)/g
const CONSTANT_LINE = /\b(?:const|final|static|readonly|constexpr|enum)\b|^\s*#\s*define|^\s*[A-Z][A-Z0-9_]+\s*[:=]/
const NUMBER = /(?<![\w.])(?:0x[0-9a-fA-F]+|\d+\.\d+|\d{2,}|[3-9])(?![\w.])/g
const FLAG_PARAM = /\b(?:bool|boolean|Boolean)\b|=\s*(?:true|false|True|False)\b|\b(?:flag|force|verbose|strict|(?:is|has|can|should|apply|enable|disable|use|with|include|skip)[A-Z_]\w*)\b/

function magicNumbers(lines, markers, settings) {
  const seen = new Map()
  lines.forEach((raw, index) => {
    const code = stripLineComment(raw, markers)
    if (code.trim() === '' || CONSTANT_LINE.test(code) || IMPORT_LINE.test(code.trim()) || /\[\s*\d+\s*\]/.test(code)) return
    for (const m of code.matchAll(NUMBER)) {
      const entry = seen.get(m[0]) ?? { literal: m[0], count: 0, lines: [] }
      entry.count += 1
      if (entry.lines.length < 5) entry.lines.push(index + 1)
      seen.set(m[0], entry)
    }
  })
  return [...seen.values()].filter(e => e.count >= settings.maxMagicLiteralRepeats)
}

function vagueNames(lines, markers, language) {
  const found = []
  lines.forEach((raw, index) => {
    const code = stripLineComment(raw, markers)
    const names = [...code.matchAll(DECLARATION)].map(m => m[1])
    if (language === 'python') { const m = /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*[^=]/.exec(code); if (m) names.push(m[1]) }
    const signature = /\b(?:def|function|fn|func)\s+\w+\s*\(([^)]*)\)/.exec(code)
    if (signature) for (const param of signature[1].split(',')) { const m = /(\w+)\s*(?::[^=,]*)?(?:=.*)?$/.exec(param.trim()); if (m && m[1] !== 'self' && m[1] !== 'this') names.push(m[1]) }
    for (const m of code.matchAll(/\b(m_[a-z]\w*)/g)) if (!names.includes(m[1])) names.push(m[1])
    for (const name of names) {
      let why
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue
      if (name.length === 1 && !LOOP_NAMES.has(name)) why = 'a one-letter name hides what the value is'
      else if (VAGUE_NAMES.has(name.toLowerCase())) why = `"${name}" says nothing about what it holds or does`
      else if (/^m_[a-z]/.test(name)) why = 'drop the m_ prefix; the class and the editor already show it is a member'
      else if (/^[a-z][A-Za-z0-9]*(?:Info|Data|Manager|Util|Utils|Helper|Stuff)$/.test(name) || /^[A-Z][A-Za-z0-9]*(?:Info|Data|Manager|Util|Utils|Helper|Stuff)$/.test(name)) why = 'a noise word (Info, Data, Manager, Util, Helper) adds no meaning; name what it is'
      if (why) found.push({ line: index + 1, name, why })
    }
  })
  return found
}

function normalizedLines(text, syntax) {
  const out = []
  const lines = text.split('\n')
  let block = null
  lines.forEach((raw, index) => {
    let t = raw.trim()
    if (block) { if (t.includes(block)) block = null; return }
    const open = syntax.block.find(([o]) => t.startsWith(o))
    if (open) { if (!t.includes(open[1], open[0].length)) block = open[1]; return }
    if (syntax.line.some(m => t.startsWith(m))) return
    t = t.replace(/\s+/g, ' ')
    if (t === '' || STRUCTURAL.test(t) || IMPORT_LINE.test(t)) return
    out.push({ text: t, line: index + 1 })
  })
  return out
}

function findDuplicates(entries, settings) {
  const K = settings.minDuplicateLines
  const hashes = new Map()
  const perFile = new Map()
  for (const { rel, norm } of entries) {
    const arr = []
    for (let i = 0; i + K <= norm.length; i++) arr.push(norm.slice(i, i + K).map(n => n.text).join('\n'))
    perFile.set(rel, { norm, arr })
    arr.forEach((h, i) => {
      if (h.length < settings.minDuplicateChars) return
      const list = hashes.get(h) ?? []
      if (list.length < 8) list.push({ rel, i })
      hashes.set(h, list)
    })
  }
  const clones = new Map()
  for (const list of hashes.values()) {
    if (list.length < 2) continue
    const a = list[0]
    for (const b of list.slice(1)) {
      const A = perFile.get(a.rel)
      const B = perFile.get(b.rel)
      if (a.rel === b.rel && Math.abs(a.i - b.i) < K) continue
      if (a.i > 0 && b.i > 0 && A.arr[a.i - 1] !== undefined && A.arr[a.i - 1] === B.arr[b.i - 1]) continue
      let extra = 0
      while (A.arr[a.i + extra + 1] !== undefined && A.arr[a.i + extra + 1] === B.arr[b.i + extra + 1]) extra += 1
      const length = K + extra
      const range = (F, at) => ({ file: F === A ? a.rel : b.rel, from: F.norm[at].line, to: F.norm[at + length - 1].line })
      const key = `${a.rel}:${a.i}:${length}`
      const entry = clones.get(key) ?? { lines: length, locations: [range(A, a.i)] }
      if (!entry.locations.some(l => l.file === b.rel && l.from === F_line(B, b.i))) entry.locations.push(range(B, b.i))
      clones.set(key, entry)
    }
  }
  return [...clones.values()].sort((x, y) => y.lines * (y.locations.length - 1) - x.lines * (x.locations.length - 1))
}
const F_line = (F, at) => F.norm[at].line

/** Candidates for cleanup in the scope: duplicate blocks, long or deeply nested functions, noisy comments. */
export function scanProject(destInput, { goals = ALL_GOALS, paths = [], exclude = [], thresholds = {}, limit = 40, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const config = loadLanguages(dest)
  const settings = { ...DEFAULTS, ...(config.cleanup ?? {}), ...thresholds }
  const syntaxFor = syntaxTable(dest)
  const table = extensionTable(dest)
  const inScope = rel => (paths.length === 0 || paths.some(p => rel === p || rel.startsWith(p.replace(/\/$/, '') + '/'))) && !exclude.some(p => (p === 'tests' ? TEST_FILE.test(rel) : rel === p || rel.startsWith(p.replace(/\/$/, '') + '/')))
  const files = walk(dest).files.filter(rel => inScope(rel) && !SKIP_FILE.test(rel)).slice(0, settings.maxFiles)
  const entries = []
  const candidates = []
  const unsupported = {}
  const summary = { files: 0, linesScanned: 0, duplicateGroups: 0, duplicatedLines: 0, longFunctions: 0, deepFunctions: 0, manyParams: 0, flagArguments: 0, magicNumbers: 0, vagueNames: 0, commentBlocking: 0, commentNonBlocking: 0 }
  const syntheticDiff = []

  for (const rel of files) {
    const syntax = syntaxFor(rel)
    const language = languageOf(rel, table)
    if (!syntax || !language) continue
    let text
    try {
      if (fs.statSync(path.join(dest, rel)).size > settings.maxFileBytes) continue
      text = fs.readFileSync(path.join(dest, rel), 'utf8')
    } catch { continue }
    if (text.includes('\0')) continue
    const lines = text.split('\n')
    summary.files += 1
    summary.linesScanned += lines.length
    const isTest = TEST_FILE.test(rel)

    if (goals.includes('duplicates')) entries.push({ rel, norm: normalizedLines(text, syntax) })

    if (goals.includes('split')) {
      const functions = BRACE_LANGUAGES.has(language) ? braceFunctions(lines, syntax.line, language) : language === 'python' ? pythonFunctions(lines) : null
      if (functions === null) unsupported[language] = (unsupported[language] ?? 0) + 1
      for (const fn of functions ?? []) {
        const body = lines.slice(fn.from - 1, fn.to)
        const codeLines = body.filter(l => l.trim() !== '' && !syntax.line.some(m => l.trim().startsWith(m))).length
        const params = countParams(fn.signature)
        const reasons = []
        const arrowAt = fn.signature.indexOf('=>')
        const parenAt = fn.signature.indexOf('(')
        const paramText = parenAt === -1 || (arrowAt !== -1 && arrowAt < parenAt) ? '' : parenGroup(fn.signature).replace(/\{[^}]*\}/g, '')
        if (paramText !== '' && FLAG_PARAM.test(paramText)) {
          summary.flagArguments += 1
          candidates.push({ kind: 'flag-argument', file: rel, from: fn.from, to: fn.to, name: fn.name, test: isTest, size: 1, suggestion: `${fn.name} takes a flag argument, so it does two things. Split it into two functions named for what each does, or use a descriptive enum or options value.`, effort: 'low' })
        }
        if (codeLines > settings.maxFunctionLines) { reasons.push(`${codeLines} code lines (limit ${settings.maxFunctionLines})`); summary.longFunctions += 1 }
        if (fn.deepest > settings.maxNesting) { reasons.push(`nesting ${fn.deepest} (limit ${settings.maxNesting})`); summary.deepFunctions += 1 }
        if (params > settings.maxParams) { reasons.push(`${params} parameters (limit ${settings.maxParams})`); summary.manyParams += 1 }
        if (reasons.length > 0) {
          candidates.push({
            kind: 'long-function', file: rel, from: fn.from, to: fn.to, name: fn.name, test: isTest, size: codeLines, reasons,
            suggestion: `${reasons.join('; ')}. Extract cohesive blocks into well-named private helpers (pure ones first), use early returns to cut nesting${params > settings.maxParams ? ', and group the parameters into one value' : ''}. Keep the signature, error handling, ordering and side effects.`,
            effort: codeLines > settings.maxFunctionLines * 3 ? 'high' : 'medium',
          })
        }
      }
    }

    if (goals.includes('constants') && !isTest) {
      for (const e of magicNumbers(lines, syntax.line, settings)) {
        summary.magicNumbers += 1
        candidates.push({ kind: 'magic-number', file: rel, literal: e.literal, count: e.count, lines: e.lines, test: false, size: e.count, suggestion: `${e.literal} appears ${e.count} times with no name. Give it a named constant that says what it means, defined once, so a change is made in one place.`, effort: 'low' })
      }
    }

    if (goals.includes('naming')) {
      const vague = vagueNames(lines, syntax.line, language)
      if (vague.length > 0) {
        summary.vagueNames += vague.length
        candidates.push({ kind: 'vague-name', file: rel, test: isTest, size: vague.length, examples: vague.slice(0, 6).map(v => `${rel}:${v.line} ${v.name}: ${v.why}`), suggestion: 'Rename to a name that says what the value is or what the function does (intention-revealing, searchable, no noise words). Rename with the tool across all callers in one step, and only what the statement asked for.', effort: 'low' })
      }
    }

    if (goals.includes('comments') || goals.includes('dead')) {
      syntheticDiff.push(`diff --git a/${rel} b/${rel}`, '--- /dev/null', `+++ b/${rel}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => '+' + l))
    }
  }

  if (goals.includes('duplicates')) {
    const clones = findDuplicates(entries, settings)
    summary.duplicateGroups = clones.length
    summary.duplicatedLines = clones.reduce((n, c) => n + c.lines * (c.locations.length - 1), 0)
    for (const clone of clones) {
      candidates.push({
        kind: 'duplicate-code', locations: clone.locations, size: clone.lines * (clone.locations.length - 1), lines: clone.lines,
        test: clone.locations.every(l => TEST_FILE.test(l.file)),
        suggestion: `${clone.locations.length} copies of ${clone.lines} lines, identical after whitespace and comment normalization. First look for an existing function that already does this (reuse_search). Otherwise keep one copy as a helper next to its owners (or in the module the reuse map names) and replace the others with a call. Check that types, constants and the surrounding context really match before merging.`,
        effort: clone.lines > 30 ? 'medium' : 'low',
      })
    }
  }

  if (syntheticDiff.length > 0) {
    const audit = auditDiff(syntheticDiff.join('\n'), config, { syntaxFor })
    const wanted = audit.findings.filter(f => goals.includes('comments') ? true : f.rule === 'commented-out-code')
    summary.commentBlocking = wanted.filter(f => f.blocking).length
    summary.commentNonBlocking = wanted.length - summary.commentBlocking
    const byFile = new Map()
    for (const f of wanted) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
    for (const [file, list] of byFile) {
      candidates.push({
        kind: 'comment-noise', file, test: TEST_FILE.test(file), size: list.length, blocking: list.filter(f => f.blocking).length,
        examples: list.slice(0, 5).map(f => `${f.file}:${f.line} ${f.remark}`),
        suggestion: 'Delete comments that restate the code, commented-out code, process notes and questions left in code; keep only reasons, constraints and non-obvious contracts (comment-standards.md). Do not delete a comment that explains why.',
        effort: 'low',
      })
    }
  }

  const rank = c => (c.test ? 0.5 : 1) * (c.kind === 'duplicate-code' ? c.size * 2 : c.kind === 'long-function' ? c.size : c.kind === 'magic-number' || c.kind === 'vague-name' ? c.size * 0.8 : c.kind === 'flag-argument' ? 4 : (c.blocking ?? 0) * 5 + c.size)
  candidates.sort((a, b) => rank(b) - rank(a))
  return {
    dest, goals, scope: { paths, exclude }, thresholds: settings, summary,
    unsupportedLanguages: unsupported,
    candidates: candidates.slice(0, limit), candidateCount: candidates.length,
    note: 'Heuristic scan. Function boundaries come from braces or indentation and are skipped for languages listed under unsupportedLanguages. Duplicates are found by normalized line windows, so a reported copy still needs a human check before it is merged.',
  }
}

const SNAPSHOT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Save a scan summary, or compare the current one with a saved one. Snapshots live in the (git-ignored) thought folder. */
export function snapshot(destInput, name, current, { save = false } = {}) {
  const dest = resolveDest(destInput)
  if (!SNAPSHOT_NAME.test(name)) throw new Error('snapshot name must be lower-case letters, digits and hyphens')
  const file = path.join(dest, 'devops-skill', 'thoughts', 'non-final', `cleanup-${name}.json`)
  if (save) {
    assertInside(dest, file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), summary: current.summary }, null, 2) + '\n')
    return { saved: path.relative(dest, file) }
  }
  const before = JSON.parse(fs.readFileSync(file, 'utf8'))
  const delta = {}
  for (const key of ['duplicateGroups', 'duplicatedLines', 'longFunctions', 'deepFunctions', 'manyParams', 'flagArguments', 'magicNumbers', 'vagueNames', 'commentBlocking', 'commentNonBlocking']) {
    const was = before.summary[key] ?? 0
    delta[key] = { before: was, after: current.summary[key], change: current.summary[key] - was }
  }
  const worse = Object.entries(delta).filter(([, v]) => v.change > 0).map(([k]) => k)
  return { comparedWith: path.relative(dest, file), savedAt: before.savedAt, delta, worse, improved: Object.values(delta).some(v => v.change < 0) && worse.length === 0 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  try {
    const statement = opt('--statement') ?? argv.filter(a => !a.startsWith('--')).join(' ')
    let result
    if (command === 'brief') result = parseStatement(statement, dest)
    else if (command === 'scan') {
      const brief = parseStatement(statement, dest)
      result = scanProject(dest, { goals: brief.goals, paths: brief.scope.paths, exclude: brief.scope.exclude, thresholds: brief.thresholds })
      if (opt('--save')) result.snapshot = snapshot(dest, opt('--save'), result, { save: true })
      if (opt('--compare')) result.compare = snapshot(dest, opt('--compare'), result)
    } else throw new Error('usage: devops-cleanup brief|scan --dest DIR --statement "plain English" [--save NAME] [--compare NAME]')
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`devops-cleanup: ${error.message}`)
    process.exitCode = 2
  }
}
