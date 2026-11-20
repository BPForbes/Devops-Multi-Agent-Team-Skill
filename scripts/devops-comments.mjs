#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { assertInside, loadLanguages, resolveDest } from './devops-setup.mjs'
import { commentLimits, loadStandards } from './devops-standards.mjs'
import { REF, git } from './devops-tags.mjs'
import { isMain } from './devops-main.mjs'

const FALLBACK = {
  '.yml': ['#'], '.yaml': ['#'], '.toml': ['#'], '.mk': ['#'], '.conf': ['#'],
  'Dockerfile': ['#'], 'Makefile': ['#'],
}
const sourceOf = part => (typeof part === 'string' ? part : part.source)
const anyOf = (parts, flags) => new RegExp(parts.map(sourceOf).join('|'), flags)
const wordList = (words, { before = '\\b', after = '\\b', flags = 'i' } = {}) =>
  new RegExp(`${before}(${words.join('|')})${after}`, flags)

const DIRECTIVE = new RegExp(`^(${[
  /#!/,
  /#\s*(include|define|if|ifdef|ifndef|else|elif|endif|undef|pragma|error|warning)\b/,
  /#\s*(region|endregion)\b/,
  /#\[/,
  /\/\/\s*(go:|@ts-|eslint|prettier|nolint|noinspection|swiftlint|SPDX|#region|#endregion|\+build)/,
  /\/\*\s*(eslint|istanbul|webpack|prettier)/,
  /#\s*(-\*-|type:|noqa|pylint|mypy|pragma|frozen_string_literal)/,
  /#\s*(shellcheck|rubocop|yamllint|cspell)/,
  /--\s*(\w+:)?\s*sqlfluff/,
  /<!--\s*(prettier|markdownlint)/,
].map(p => p.source).join('|')})`, 'i')
const LICENSE = /\b(copyright|spdx-license|licensed under|all rights reserved)\b/i
const DIVIDER = /^[\s\-=*#_~+./\\<>|]{4,}$/
const REASON = wordList([
  'because', 'since', 'so that', 'otherwise', 'to avoid', 'avoids?', 'must', 'never', 'always',
  'only', 'unless', 'workaround', 'work around', 'due to', 'why', 'invariant', 'assumes?',
  'guarantees?', 'requires?', 'precondition', 'postcondition', 'race', 'deadlock', 'overflow',
  'leak', 'unsafe', 'security', 'trade-?off', 'rfc', 'spec', 'regression', 'see\\b',
], { after: '' })
const MECHANICAL = wordList([
  'increment', 'decrement', 'set', 'get', 'gets', 'sets', 'return', 'returns', 'loop', 'loops',
  'iterate', 'iterates', 'call', 'calls', 'check', 'checks', 'create', 'creates',
  'initiali[sz]e', 'initiali[sz]es', 'init', 'assign', 'assigns', 'add', 'adds', 'update',
  'updates', 'print', 'prints', 'declare', 'declares', 'define', 'defines', 'import', 'imports',
  'open', 'opens', 'close', 'closes', 'read', 'reads', 'write', 'writes', 'increase', 'decrease',
  'store', 'stores', 'convert', 'converts', 'remove', 'removes', 'delete', 'deletes', 'push',
  'pushes', 'pop', 'pops', 'append', 'appends', 'compute', 'computes', 'calculate', 'calculates',
  'instantiate', 'constructor', 'getter', 'setter', 'for each', 'if',
], { before: '^(?:the\\s+)?' })
const PROCESS = anyOf([
  /(?<![./\w-])(?:claude|gpt|chatgpt|copilot|llm)(?![/\w-])/,
  wordList([
    'ai[- ]generated', 'prompt', 'agent', 'reviewer', 'per review', 'as requested', 'as discussed',
    'note to self', "i (think|guess|added|changed|fixed|removed|wasn'?t|am not)",
    'we (should|need to|might|could)', 'new code', 'old code', 'previously', 'used to',
    'was changed', 'changed from', 'added (for|by|to)', 'fixed (a )?(bug|issue)',
    'this (pr|commit|branch|change)', 'wip', 'for now',
  ]),
], 'i')
const QUESTION = anyOf([
  /\?(\s|$)/,
  /^(q:|question|why |should we|do we|can we|is this|are we|not sure|maybe|perhaps|unclear)/,
  /^(wondering|hmm)/,
  /\b(please (check|confirm|review)|@\w+)/,
], 'i')
const NARRATION = anyOf([
  /^(?:first|then|next|now|here|finally|after that|afterwards)\b,?\s+(?:we|i|let'?s|it|the code)\b/,
  /^step\s*\d+\s*[:.)-]/,
], 'i')
const CONCEPT = wordList([
  'overview', 'architecture', 'how (?:it|this) works', 'usage:',
  'how to (?:use|run|configure|deploy|install)', 'getting started', 'design overview',
  'data ?flow', 'the flow is', 'this module (?:is|handles|implements|provides)',
])
const DOC_FILE = /(\.(md|mdx|markdown|rst|adoc|asciidoc|tex|txt)$|(^|\/)docs?\/)/i
const NARRATIVE = wordList([
  'originally', 'at first', 'in the beginning',
  'we (tried|decided|realized|realised|found|discovered|noticed|wanted|ended up)',
  'it turned out', 'turns out', 'after (much|some|a lot of|many)', 'eventually', 'long story',
  'the story', 'journey', 'back when', 'over time we', 'little did', 'interestingly',
  'as you can see', "let'?s (take a look|dive|walk)",
])
const PARAM_DOC = anyOf([
  /^@param(?:\s+\{[^}]*\})?\s+\[?(\w+)\]?\s*-?\s*(.*)$/,
  /^:param\s+(\w+):\s*-?\s*(.*)$/,
  /^<param name="(\w+)">\s*-?\s*(.*?)(?:<\/param>)?$/,
])
const CODE_LIKE = anyOf([
  /[;{}]\s*$/,
  /^[\w.[\]]+\s*[-+*/|&]?=\s*\S/,
  /^[\w.:]+\(.*\)\s*;?$/,
  /^(if|for|while|switch|return|let|const|var|def|fn|func|function)\b.*[;{}):]\s*$/,
  /^(import|from|using)\b.*[;{}):]\s*$/,
  /^(else|elif|try|catch|except|throw|raise)\b.*[;{}):]\s*$/,
])
const DOCSTRING_OPEN = /^[rbuf]*("""|''')/
const LEADING_STARS = /^\*+\s?/
const DOC_MARKERS = ['///', '//!', '##', '---']
const URL = /https?:\/\//
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'this', 'that', 'is', 'in', 'on', 'value', 'param',
  'parameter', 'argument', 'input', 'given', 'specified',
])
const PROSE_WORDS = 6
const SHORT_COMMENT_WORDS = 9
const TITLE_WORDS = 3
const QUOTE_LIMIT = 120
const TWIN_MIN_WORDS = 5
const TWIN_OVERLAP = 0.7
const PERCENT = 100
const DIFF_FILE_PREFIX = '+++ b/'
const GUIDE = '(comment-standards.md 6b)'

const SAY = {
  divider: 'a divider line carries no information; delete it.',
  commentedOut: 'this looks like commented-out code. Delete it; version control keeps history.',
  process: 'this is a note about the change or the process, not about the code. Say it in the '
    + 'commit or the PR remarks; if a lasting reason exists, state that reason instead.',
  question: 'a question or remark to a person does not belong in the code. Put it in the PR Q&A '
    + 'and delete the comment.',
  narrative: 'this tells a story. State the fact or the reason in one plain sentence '
    + '(comment-standards.md 5).',
  narration: 'this narrates the implementation step by step. The code already says how; keep only '
    + 'the reason or the design choice (comment gate, comment-standards.md 0a), or delete it.',
  restates: 'this restates what the code does. Delete it, or rename or extract so the code says '
    + 'it.',
  markerCase: 'write markers in capitals (TODO, FIXME).',
  docNarrative: 'this doc line tells a story. State the fact plainly (comment-standards.md 5).',
  unlistedDoc: 'this doc change is not in the Push JSON `docs` list. Add it with why it is shared, '
    + `durable knowledge, or drop it if it only restates the code ${GUIDE}.`,
  newDoc: 'a new doc file. Update the existing docs instead; a new file is only for a new system '
    + `or module, named in the Push JSON \`docs\` row as \`new\` ${GUIDE}.`,
  interfaceConcept: 'an interface may describe its implementation, but if this concept spans more '
    + `than this module, it belongs once in the existing docs ${GUIDE}.`,
  sourceConcept: 'this explains a concept, a flow or usage. Put it in the interface file (.h, '
    + '.d.ts, ...) if the language has one, or once in the existing docs with a one-line pointer '
    + `here ${GUIDE}; if it is local, cut it to the reason.`,
  capital: 'start a comment with a capital letter.',
  fullStop: 'end a comment sentence with a full stop.',
  unlisted: 'this comment is not in the Push JSON `comments` list. Add it with the reason the code '
    + 'cannot say it, or delete it.',
  inlineGap: 'separate an inline comment from the code by at least two spaces (PEP 8).',
  trailing: 'put the comment on its own line above the code, not at the end of it '
    + '(C# coding conventions).',
  hashOnly: 'use # for comments (Terraform style conventions).',
  jsdocTypes: 'do not repeat TypeScript types in JSDoc; the signature already declares them '
    + '(TSDoc, Google TypeScript style).',
  rustSafety: 'an unsafe block needs a `// SAFETY:` comment above it saying why the invariants '
    + 'hold (Rust API Guidelines, clippy undocumented_unsafe_blocks).',
}

const unquoted = text => text.replace(/`[^`]*`|"[^"]*"|“[^”]*”/g, '')
const tokens = text => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean)
const byLength = (a, b) => b.length - a.length

function syntaxEntries(lang) {
  const c = lang.comments ?? { line: [], block: [] }
  const interfaces = c.interface ?? []
  const sources = [...new Set([...(lang.detect?.extensions ?? []), ...(c.extensions ?? [])])]
  const base = {
    id: lang.id, line: [...c.line].sort(byLength), block: c.block,
    docstring: c.docstring === true, checks: c.checks ?? [], interfaceExts: interfaces,
    sourceExts: sources,
  }
  const own = interfaces.map(ext => ({ ...base, ext, interface: true }))
  const plain = sources.filter(ext => !interfaces.includes(ext))
    .map(ext => ({ ...base, ext, interface: false }))
  return [...own, ...plain]
}

/** For a file name, the comment syntax of its language: markers, block pairs and checks. */
export function syntaxTable(dest) {
  const table = loadLanguages(dest).languages.flatMap(syntaxEntries)
  for (const [ext, line] of Object.entries(FALLBACK)) {
    const empty = { checks: [], interfaceExts: [], sourceExts: [] }
    table.push({ id: null, ext, line, block: [], docstring: false, interface: false, ...empty })
  }
  const matches = name => t => (t.ext.startsWith('.')
    ? name.toLowerCase().endsWith(t.ext.toLowerCase())
    : name === t.ext)
  const order = (a, b) => b.ext.length - a.ext.length || Number(b.interface) - Number(a.interface)
  return file => table.filter(matches(file.split('/').pop())).sort(order)[0]
}

/** The lines a unified diff adds, with their file and new line number. */
export function parseAdded(diffText) {
  const added = []
  let file = null
  let line = 0
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith(DIFF_FILE_PREFIX) ? raw.slice(DIFF_FILE_PREFIX.length) : null
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) line = Number(hunk[1])
    else if (file && raw.startsWith('+') && !raw.startsWith('+++')) {
      added.push({ file, line: line++, text: raw.slice(1) })
    }
  }
  return added
}

/** Files a unified diff creates (old side /dev/null). */
export function newFiles(diffText) {
  const created = new Set()
  let fromNull = false
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('--- ')) fromNull = raw === '--- /dev/null'
    else if (raw.startsWith(DIFF_FILE_PREFIX) && fromNull) {
      created.add(raw.slice(DIFF_FILE_PREFIX.length))
    }
  }
  return created
}

function trailingComment(text, markers) {
  for (const marker of markers) {
    const at = text.indexOf(` ${marker} `)
    if (at <= 0) continue
    const before = text.slice(0, at)
    const balanced = (before.match(/["'`]/g) ?? []).length % 2 === 0
    if (!balanced || before.trim() === '') continue
    const comment = text.slice(at + marker.length + 1).trim()
    return { code: before, comment, marker, gap: before.endsWith(' ') ? 2 : 1 }
  }
  return null
}

function readDocstring(state, trimmed, syntax, push) {
  if (!syntax.docstring || !(state.docstring || DOCSTRING_OPEN.test(trimmed))) return false
  const quote = state.docstring ?? (trimmed.match(/("""|''')/) ?? [])[1]
  const rest = state.docstring ? trimmed : trimmed.replace(DOCSTRING_OPEN, '')
  push('doc', rest.replace(new RegExp(`${quote}.*$`), ''))
  state.docstring = rest.includes(quote) ? null : quote
  return true
}

function readBlock(state, trimmed, syntax, push) {
  if (state.block) {
    const closeAt = trimmed.indexOf(state.block.close)
    const body = closeAt === -1 ? trimmed : trimmed.slice(0, closeAt)
    push(state.block.doc ? 'doc' : 'block', body.replace(LEADING_STARS, ''))
    if (closeAt !== -1) state.block = null
    return true
  }
  const opening = syntax.block.find(([open]) => trimmed.startsWith(open))
  if (!opening) return false
  const [open, close] = opening
  const body = trimmed.slice(open.length)
  const closeAt = body.indexOf(close)
  const doc = open === '/*' && body.startsWith('*') && !body.startsWith('**/')
  const text = closeAt === -1 ? body : body.slice(0, closeAt)
  push(doc ? 'doc' : 'block', text.replace(LEADING_STARS, ''), { marker: open })
  if (closeAt === -1) state.block = { close, doc }
  return true
}

function readLineComment(trimmed, syntax, push) {
  const marker = syntax.line.find(m => trimmed.startsWith(m))
  if (!marker) return false
  const body = trimmed.slice(marker.length)
  const kind = DOC_MARKERS.includes(marker) ? 'doc' : 'line'
  push(kind, body.replace(/^[/!#-]\s?/, ''), { marker, tight: /^[A-Za-z0-9]/.test(body) })
  return true
}

function readRow(state, { file, line, text }, syntax) {
  if (line !== state.previous + 1) Object.assign(state, { block: null, docstring: null, run: [] })
  state.previous = line
  const trimmed = text.trim()
  if (trimmed === '') {
    state.run = []
    return
  }
  if (DIRECTIVE.test(trimmed) || LICENSE.test(trimmed)) return
  const push = (kind, body, extra = {}) => {
    const item = { file, line, kind, text: body.trim(), raw: text, ...extra }
    state.items.push(item)
    if (kind !== 'trailing') state.run.push(item)
  }
  if (readDocstring(state, trimmed, syntax, push) || readBlock(state, trimmed, syntax, push)) return
  if (readLineComment(trimmed, syntax, push)) return
  const trailing = trailingComment(trimmed, syntax.line)
  if (trailing) push('trailing', trailing.comment, { marker: trailing.marker, gap: trailing.gap })
  state.codeRows.push({ file, line, text: trimmed, above: state.run })
  state.run = []
  state.codeLines.set(file, (state.codeLines.get(file) ?? 0) + 1)
}

/** The comments in a run of added rows, the code rows, and the comments just above each one. */
function extract(rows, syntax) {
  const state = {
    items: [], codeLines: new Map(), codeRows: [], run: [], block: null, docstring: null,
    previous: -2,
  }
  for (const row of rows) readRow(state, row, syntax)
  return { items: state.items, codeLines: state.codeLines, codeRows: state.codeRows }
}

const finding = (item, rule, label, remark) => ({
  file: item.file, line: item.line, rule, blocking: label === 'issue',
  remark: `${label} (${label === 'issue' ? 'blocking' : 'non-blocking'}): ${remark}`,
  text: item.text.slice(0, QUOTE_LIMIT),
})
const issue = (item, rule, remark) => finding(item, rule, 'issue', remark)
const suggestion = (item, rule, remark) => finding(item, rule, 'suggestion', remark)
const blockingIssue = (file, line, rule, remark) => issue({ file, line, text: '' }, rule, remark)

function looksLikeCode(text) {
  const words = text.split(/\s+/).length
  if (words >= PROSE_WORDS && !/\s=\s|[=!<>]=|=>|->|::|[{}]|\(\)/.test(text)) return false
  if (/^[A-Z][^;{}=]*[.!:]$/.test(text) && words > TITLE_WORDS) return false
  return CODE_LIKE.test(text)
}

function contentFindings(item) {
  const t = item.text
  const out = []
  if (looksLikeCode(t)) out.push(issue(item, 'commented-out-code', SAY.commentedOut))
  if (PROCESS.test(t)) out.push(issue(item, 'process-note', SAY.process))
  if (QUESTION.test(t) && !URL.test(t)) out.push(issue(item, 'question', SAY.question))
  if (NARRATIVE.test(unquoted(t))) out.push(issue(item, 'narrative', SAY.narrative))
  if (item.kind === 'doc') return out
  if (NARRATION.test(t)) out.push(issue(item, 'narrates-code', SAY.narration))
  const short = t.split(/\s+/).length <= SHORT_COMMENT_WORDS
  const codeLike = out.some(f => f.rule === 'commented-out-code')
  if (MECHANICAL.test(t) && short && !REASON.test(t) && !codeLike) {
    out.push(issue(item, 'restates-code', SAY.restates))
  }
  return out
}

function paramFindings(item) {
  const param = PARAM_DOC.exec(item.text)
  if (!param) return []
  const groups = param.slice(1).filter(g => g !== undefined)
  const [name, text = ''] = groups
  const known = new Set(tokens(name))
  const repeats = tokens(text).filter(w => !STOP.has(w)).every(w => known.has(w))
  const remark = `the description of \`${name}\` only repeats its name. Delete the doc line, or `
    + 'say what the name cannot (units, range, ownership).'
  return repeats ? [issue(item, 'doc-repeats-signature', remark)] : []
}

function markerFindings(item) {
  const marker = /^(TODO|FIXME|HACK|XXX|NOTE)\b(.*)$/.exec(item.text)
  const lowercase = /^(todo|fixme)\b/.test(item.text)
  if (!marker) return lowercase ? [issue(item, 'marker', SAY.markerCase)] : []
  const [, word, rest] = marker
  if (['HACK', 'XXX'].includes(word)) {
    return [issue(item, 'marker', `use TODO or FIXME with an issue reference instead of ${word}.`)]
  }
  if (word === 'NOTE' || /(#\d+|\([\w.@-]+\)|https?:\/\/)/.test(rest)) return []
  const remark = `${word} has no issue reference or owner. Add one (TODO(#123)) and list it in `
    + 'the Handoff.'
  return [issue(item, 'marker', remark)]
}

function lengthFindings(item, config) {
  const limit = config.maxLineColumns
  if (item.kind === 'doc' || item.raw.length <= limit || URL.test(item.text)) return []
  const remark = `this line is ${item.raw.length} columns; wrap comments before ${limit}`
  return [issue(item, 'long-line', `${remark} (lineLength.comment in .devops/standards.json).`)]
}

function judge(item, config) {
  if (item.text === '') return []
  if (DIVIDER.test(item.text)) return [issue(item, 'divider', SAY.divider)]
  return [
    ...contentFindings(item), ...paramFindings(item), ...markerFindings(item),
    ...lengthFindings(item, config),
  ]
}

function groups(items) {
  const result = []
  for (const item of items) {
    const last = result[result.length - 1]
    const next = last && last.file === item.file && item.line === last.end + 1
    if (next && item.kind !== 'trailing' && last.kind !== 'trailing') {
      last.end = item.line
      last.items.push(item)
    } else {
      const { file, line, kind } = item
      result.push({ file, start: line, end: line, kind, items: [item] })
    }
  }
  return result
}

function listedCovers(listed, group) {
  return listed.some(entry => {
    if (entry.file !== group.file) return false
    const [from, to] = String(entry.line ?? '').split('-').map(Number)
    if (Number.isFinite(from)) return group.start <= (to ?? from) && group.end >= from
    return true
  })
}

const stemOf = (file, syntax) => {
  const name = file.split('/').pop()
  const exts = [...(syntax.interface ? syntax.interfaceExts : syntax.sourceExts)].sort(byLength)
  const ext = exts.find(e => name.toLowerCase().endsWith(e.toLowerCase()))
  return ext ? name.slice(0, name.length - ext.length) : name
}

const dirOf = file => (file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '')

/** A source file and its interface file share a directory and a stem, whatever the language. */
const pairKey = (file, syntax) => `${dirOf(file)}${stemOf(file, syntax)}`

const meaningful = text => tokens(text).filter(w => w.length > 2 && !STOP.has(w))

function overlap(a, b) {
  const left = new Set(a)
  const right = new Set(b)
  const shared = [...left].filter(w => right.has(w)).length
  return shared / Math.max(1, Math.min(left.size, right.size))
}

/**
 * A `// SAFETY:` comment above an unsafe line the diff does not touch is not in the diff (-U0),
 * so read the audited file: the nearest non-blank line above must be the SAFETY comment.
 */
function hasSafetyAbove(readFile, file, line) {
  if (!readFile) return false
  const lines = (readFile(file) ?? '').split('\n')
  const above = lines.slice(0, Math.max(0, line - 1)).reverse().find(l => l.trim() !== '')
  return above !== undefined && /^\s*(\/\/|#|--)\s*SAFETY:/.test(above)
}

function itemChecks(item, { on, file }) {
  const out = []
  if (on('marker-space') && item.tight) {
    const remark = `put one space after \`${item.marker}\` (the language's style guide).`
    out.push(issue(item, 'marker-space', remark))
  }
  if (on('inline-two-spaces') && item.kind === 'trailing' && item.gap < 2) {
    out.push(issue(item, 'inline-gap', SAY.inlineGap))
  }
  if (on('no-trailing') && item.kind === 'trailing') out.push(issue(item, 'trailing', SAY.trailing))
  if (on('hash-only') && (item.marker === '//' || item.marker === '/*')) {
    out.push(issue(item, 'hash-only', SAY.hashOnly))
  }
  const typedDoc = item.kind === 'doc' && /@(param|returns?|type|typedef)\s*\{/.test(item.text)
  if (on('jsdoc-no-types') && typedDoc && /\.(ts|tsx|mts|cts)$/.test(file)) {
    out.push(issue(item, 'jsdoc-types', SAY.jsdocTypes))
  }
  return out
}

function rowChecks(row, { on, readFile }) {
  const above = row.above.filter(i => i.text !== '')
  const out = []
  const declared = /^(?:func(?:\s*\([^)]*\))?|type|var|const)\s+([A-Z]\w*)/.exec(row.text)
  if (on('go-doc-name') && declared && above.length > 0) {
    const named = above[0].text.split(/\s+/).slice(0, 2).includes(declared[1])
    const remark = `a doc comment on ${declared[1]} starts with its name (Go Doc Comments).`
    if (!named) out.push(issue(above[0], 'go-doc-name', remark))
  }
  const unsafe = /\bunsafe\s*(\{|impl\b)/.test(row.text)
  const explained = above.some(i => /^SAFETY:/.test(i.text)) || /\/\/\s*SAFETY:/.test(row.text)
  if (on('rust-safety') && unsafe && !explained && !hasSafetyAbove(readFile, row.file, row.line)) {
    out.push(blockingIssue(row.file, row.line, 'rust-safety', SAY.rustSafety))
  }
  return out
}

/** Checks a language's standard style guide makes on comments; `syntax.checks` lists them. */
function languageChecks({ items, codeRows: rows, syntax, file }, readFile) {
  const context = { on: check => syntax.checks.includes(check), file, readFile }
  const onItems = items.flatMap(item => itemChecks(item, context))
  return [...onItems, ...rows.flatMap(row => rowChecks(row, context))]
}

/**
 * Added rows that are code, not comments or blank. A -U0 diff can split a comment block across
 * hunks, so a row that starts with a comment marker counts as a comment even when its block
 * opener is not in the diff.
 */
export function codeRows(rows, syntax) {
  const comments = extract(rows, syntax).items.filter(i => i.kind !== 'trailing')
  const commentLines = new Set(comments.map(i => i.line))
  const isCommentMarker = trimmed => /^(\*|\/\*|\/\/)/.test(trimmed)
    || syntax.line.some(m => trimmed.startsWith(m))
    || syntax.block.some(([open]) => trimmed.startsWith(open))
  return rows.filter(row => {
    const trimmed = row.text.trim()
    return trimmed !== '' && !commentLines.has(row.line) && !isCommentMarker(trimmed)
  })
}

/** Added code lines over the project's code line limit; comment lines are judged by `judge`. */
function longCodeLines(rows, limits, syntax) {
  const limit = limits.codeLineColumns
  return codeRows(rows, syntax)
    .filter(row => row.text.length > limit && !URL.test(row.text))
    .map(row => {
      const remark = `this line is ${row.text.length} columns; the code limit is ${limit}`
      const where = '(lineLength.code in .devops/standards.json).'
      return blockingIssue(row.file, row.line, 'long-code-line', `${remark} ${where}`)
    })
}

function docFindings(file, rows, { created, docs }) {
  const out = rows.filter(row => NARRATIVE.test(unquoted(row.text)))
    .map(row => blockingIssue(file, row.line, 'narrative', SAY.docNarrative))
  const entry = (docs ?? []).find(e => e.file === file)
  const first = rows[0].line
  if (docs && !entry) out.push(blockingIssue(file, first, 'unlisted-doc', SAY.unlistedDoc))
  const named = typeof entry?.new === 'string' && entry.new.trim() !== ''
  if (created.has(file) && !named) out.push(blockingIssue(file, first, 'new-doc', SAY.newDoc))
  return out
}

function proseFindings(group, { syntax, limits }) {
  const first = group.items[0]
  const last = group.items[group.items.length - 1]
  const out = []
  const free = group.kind !== 'doc' && group.kind !== 'trailing'
  if (free && group.items.length >= limits.longBlockLines) {
    const remark = `${group.items.length} lines of prose in code. Shorten it to the one reason `
      + `the code cannot show, or move the explanation to the existing docs ${GUIDE}.`
    out.push(issue(first, 'long-prose', remark))
  }
  if (group.kind !== 'line' && group.kind !== 'block') return out
  if (group.items.some(i => CONCEPT.test(i.text))) {
    out.push(syntax.interface
      ? suggestion(first, 'docs-candidate', SAY.interfaceConcept)
      : issue(first, 'docs-candidate', SAY.sourceConcept))
  }
  const noisy = group.items.some(i => DIVIDER.test(i.text) || /^(TODO|FIXME|NOTE)\b/.test(i.text))
  const capitalised = /^[A-Z\d`"'([<_@]/.test(first.text)
  if (!noisy && !capitalised) out.push(issue(first, 'sentence', SAY.capital))
  if (!noisy && !/[.!?:)`"']$/.test(last.text) && !URL.test(last.text)) {
    out.push(issue(last, 'sentence', SAY.fullStop))
  }
  return out
}

function densityFinding(file, { items, code, limits, syntax }) {
  const own = items.filter(i => i.text !== '' && !['doc', 'trailing'].includes(i.kind)).length
  if (own + code === 0 || own < limits.densityMinComments) return []
  const ratio = own / (own + code)
  if (ratio < limits.densityWarn) return []
  const blocks = !syntax.interface || ratio >= limits.densityBlock
  const label = blocks ? 'issue' : 'suggestion'
  const percent = Math.round(ratio * PERCENT)
  const share = `${own} of ${own + code} added lines in this file are comments (${percent}%)`
  const remark = `${share}. Over-commented: keep only what the code cannot say.`
  return [finding({ file, line: items[0].line, text: '' }, 'density', label, remark)]
}

/** Findings for one source or interface file, and its comment groups for the interface check. */
function fileFindings(file, rows, ctx) {
  const syntax = ctx.syntaxFor(file)
  if (!syntax) return { findings: [], comments: 0, code: 0 }
  const limits = commentLimits(ctx.standards, syntax.id, { isInterface: syntax.interface })
  const extracted = extract(rows, syntax)
  const code = extracted.codeLines.get(file) ?? 0
  const items = extracted.items
  const findings = [
    ...items.flatMap(item => judge(item, limits)), ...longCodeLines(rows, limits, syntax),
    ...languageChecks({ ...extracted, syntax, file }, ctx.readFile),
  ]
  for (const group of groups(items.filter(i => i.text !== ''))) {
    findings.push(...proseFindings(group, { syntax, limits }))
    if (ctx.listed && !listedCovers(ctx.listed, group)) {
      findings.push(issue(group.items[0], 'unlisted', SAY.unlisted))
    }
    collectGroup(group, { file, syntax }, ctx)
  }
  findings.push(...densityFinding(file, { items, code, limits, syntax }))
  return { findings, comments: items.filter(i => i.text !== '').length, code }
}

function collectGroup(group, { file, syntax }, ctx) {
  const words = meaningful(group.items.map(i => i.text).join(' '))
  const first = group.items[0]
  if (syntax.interface) {
    const key = pairKey(file, syntax)
    const known = ctx.interfaceGroups.get(key) ?? []
    ctx.interfaceGroups.set(key, [...known, { file, line: first.line, words }])
  } else if (group.kind !== 'trailing' && words.length >= TWIN_MIN_WORDS) {
    ctx.sourceGroups.push({ file, syntax, first, words })
  }
}

function siblingGroups(source, ctx) {
  const found = []
  for (const ext of source.syntax.interfaceExts) {
    const rel = `${dirOf(source.file)}${stemOf(source.file, source.syntax)}${ext}`
    const text = ctx.readFile(rel)
    if (text == null) continue
    const rows = text.split('\n').map((t, i) => ({ file: rel, line: i + 1, text: t }))
    const comments = extract(rows, ctx.syntaxFor(rel)).items.filter(i => i.text !== '')
    const words = g => meaningful(g.items.map(i => i.text).join(' '))
    found.push(...groups(comments).map(g => ({ file: rel, line: g.start, words: words(g) })))
  }
  return found
}

/** Source comments that repeat their interface file's comment; the interface says it once. */
function repeatFindings(ctx) {
  return ctx.sourceGroups.flatMap(source => {
    const key = pairKey(source.file, source.syntax)
    if (!ctx.interfaceGroups.has(key) && ctx.readFile) {
      ctx.interfaceGroups.set(key, siblingGroups(source, ctx))
    }
    const similar = g => g.words.length >= TWIN_MIN_WORDS
      && overlap(source.words, g.words) >= TWIN_OVERLAP
    const twin = (ctx.interfaceGroups.get(key) ?? []).find(similar)
    if (!twin) return []
    const remark = `this repeats the comment in ${twin.file}:${twin.line}. The interface describes `
      + 'the implementation; delete the copy here.'
    return [issue(source.first, 'repeats-interface', remark)]
  })
}

function byFileOf(diffText) {
  const byFile = new Map()
  for (const row of parseAdded(diffText)) {
    byFile.set(row.file, [...(byFile.get(row.file) ?? []), row])
  }
  return byFile
}

/**
 * Pure: judge the comments a unified diff adds. Strict: every finding blocks, except that interface
 * files (.h, .d.ts, .pyi, ...) get the relaxed limits in `interface.comments` of `standards.json`.
 * `listed` is the Push JSON `comments` array and `docs` its `docs` array; omit either to skip that
 * budget check. `readFile(rel)` lets the audit read a source file's interface sibling.
 */
export function auditDiff(diffText, standards, { listed, docs, syntaxFor, readFile } = {}) {
  const byFile = byFileOf(diffText)
  const ctx = {
    standards, syntaxFor, readFile, listed, interfaceGroups: new Map(), sourceGroups: [],
  }
  const created = newFiles(diffText)
  const findings = []
  const totals = { comments: 0, code: 0, docs: 0 }
  for (const [file, rows] of byFile) {
    if (DOC_FILE.test(file)) {
      totals.docs += rows.filter(r => r.text.trim() !== '').length
      findings.push(...docFindings(file, rows, { created, docs }))
    }
    const result = fileFindings(file, rows, ctx)
    findings.push(...result.findings)
    totals.comments += result.comments
    totals.code += result.code
  }
  findings.push(...repeatFindings(ctx))
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const blocking = findings.filter(f => f.blocking).length
  return {
    commentLinesAdded: totals.comments, codeLinesAdded: totals.code, docLinesAdded: totals.docs,
    blocking, nonBlocking: findings.length - blocking, findings,
  }
}

/** The -U0 diff of a staged change, a commit range (`base...head`) or the tree against HEAD. */
export function readDiff(dest, { base, head = 'HEAD', staged = false } = {}) {
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '-U0']
  let args
  if (base) {
    for (const ref of [base, head]) {
      if (!REF.test(ref)) throw new Error(`not a plain ref name: ${JSON.stringify(ref)}`)
    }
    args = [...common, `${base}...${head}`]
  } else if (staged) args = [...common, '--cached']
  else args = [...common, 'HEAD']
  const ran = git(dest, args)
  if (!ran.ok) throw new Error(ran.err || 'git diff failed (is this a git repository?)')
  const source = base ? `${base}...${head}` : staged ? 'staged' : 'working tree vs HEAD'
  return { text: ran.out, source }
}

/** Audit the comments a staged change, a working tree or a commit range adds. */
export function commentAudit(destInput, options = {}) {
  const { base, head = 'HEAD', staged = false, listed, docs, roots } = options
  const dest = resolveDest(destInput, roots)
  const diff = readDiff(dest, { base, head, staged })
  const standards = loadStandards(dest)
  const readFile = rel => {
    try {
      const abs = path.join(dest, rel)
      assertInside(dest, abs)
      return fs.readFileSync(abs, 'utf8')
    } catch { return null }
  }
  const settings = { listed, docs, syntaxFor: syntaxTable(dest), readFile }
  const result = auditDiff(diff.text, standards, settings)
  return { dest, source: diff.source, ...result }
}

const USAGE = 'usage: devops-comments audit [--dest DIR] [--base REF [--head REF]] [--staged] '
  + '[--listed PUSH.json] [--json]'

function printAudit(result) {
  const added = `${result.commentLinesAdded} comment lines, ${result.codeLinesAdded} code lines, `
    + `${result.docLinesAdded} doc lines added`
  const counts = `${result.blocking} blocking, ${result.nonBlocking} non-blocking`
  console.log(`${result.source}: ${added}; ${counts}`)
  for (const f of result.findings) console.log(`${f.file}:${f.line}  ${f.remark}`)
}

function main(argv) {
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  if (command !== 'audit') throw new Error(USAGE)
  const listedFile = opt('--listed')
  const push = listedFile ? JSON.parse(fs.readFileSync(listedFile, 'utf8')) : undefined
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  const range = { base: opt('--base'), head: opt('--head'), staged: argv.includes('--staged') }
  const result = commentAudit(dest, { ...range, listed: push?.comments, docs: push?.docs })
  if (argv.includes('--json')) console.log(JSON.stringify(result))
  else printAudit(result)
  return result.blocking > 0 ? 1 : 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-comments: ${error.message}`)
    process.exitCode = 2
  }
}
