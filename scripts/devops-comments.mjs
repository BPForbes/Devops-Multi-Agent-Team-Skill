#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInside, loadLanguages, resolveDest } from './devops-setup.mjs'
import { REF, git } from './devops-tags.mjs'

const FALLBACK = { '.yml': ['#'], '.yaml': ['#'], '.toml': ['#'], '.mk': ['#'], '.conf': ['#'], 'Dockerfile': ['#'], 'Makefile': ['#'] }
const DIRECTIVE = /^(#!|#\s*(include|define|if|ifdef|ifndef|else|elif|endif|undef|pragma|error|warning|region|endregion)\b|#\[|\/\/\s*(go:|@ts-|eslint|prettier|nolint|noinspection|swiftlint|SPDX|#region|#endregion|\+build)|\/\*\s*(eslint|istanbul|webpack|prettier)|#\s*(-\*-|type:|noqa|pylint|mypy|pragma|frozen_string_literal|shellcheck|rubocop|yamllint|cspell)|--\s*(\w+:)?\s*sqlfluff|<!--\s*(prettier|markdownlint))/i
const LICENSE = /\b(copyright|spdx-license|licensed under|all rights reserved)\b/i
const DIVIDER = /^[\s\-=*#_~+.\/\\<>|]{4,}$/
const REASON = /\b(because|since|so that|otherwise|to avoid|avoids?|must|never|always|only|unless|workaround|work around|due to|why|invariant|assumes?|guarantees?|requires?|precondition|postcondition|race|deadlock|overflow|leak|unsafe|security|trade-?off|rfc|spec|regression|see\b)/i
const MECHANICAL = /^(?:the\s+)?(increment|decrement|set|get|gets|sets|return|returns|loop|loops|iterate|iterates|call|calls|check|checks|create|creates|initiali[sz]e|initiali[sz]es|init|assign|assigns|add|adds|update|updates|print|prints|declare|declares|define|defines|import|imports|open|opens|close|closes|read|reads|write|writes|increase|decrease|store|stores|convert|converts|remove|removes|delete|deletes|push|pushes|pop|pops|append|appends|compute|computes|calculate|calculates|instantiate|constructor|getter|setter|for each|if)\b/i
const PROCESS = /(?<![./\w-])(?:claude|gpt|chatgpt|copilot|llm)(?![/\w-])|\b(ai[- ]generated|prompt|agent|reviewer|per review|as requested|as discussed|note to self|i (think|guess|added|changed|fixed|removed|wasn'?t|am not)|we (should|need to|might|could)|new code|old code|previously|used to|was changed|changed from|added (for|by|to)|fixed (a )?(bug|issue)|this (pr|commit|branch|change)|wip|for now)\b/i
const QUESTION = /(\?(\s|$)|^(q:|question|why |should we|do we|can we|is this|are we|not sure|maybe|perhaps|unclear|wondering|hmm)|\b(please (check|confirm|review)|@\w+))/i
const NARRATION = /^(?:(?:first|then|next|now|here|finally|after that|afterwards)\b,?\s+(?:we|i|let'?s|it|the code)\b|step\s*\d+\s*[:.)-])/i
const CONCEPT = /\b(overview|architecture|how (?:it|this) works|usage:|how to (?:use|run|configure|deploy|install)|getting started|design overview|data ?flow|the flow is|this module (?:is|handles|implements|provides))\b/i
const DOC_FILE = /(\.(md|mdx|markdown|rst|adoc|asciidoc|tex|txt)$|(^|\/)docs?\/)/i
const NARRATIVE = /\b(originally|at first|in the beginning|we (tried|decided|realized|realised|found|discovered|noticed|wanted|ended up)|it turned out|turns out|after (much|some|a lot of|many)|eventually|long story|the story|journey|back when|over time we|little did|interestingly|as you can see|let'?s (take a look|dive|walk))\b/i
const unquoted = text => text.replace(/`[^`]*`|"[^"]*"|“[^”]*”/g, '')
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'this', 'that', 'is', 'in', 'on', 'value', 'param', 'parameter', 'argument', 'input', 'given', 'specified'])

const tokens = text => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function syntaxTable(dest) {
  const table = []
  for (const lang of loadLanguages(dest).languages) {
    const c = lang.comments ?? { line: [], block: [] }
    const base = { id: lang.id, line: [...c.line].sort((a, b) => b.length - a.length), block: c.block, docstring: c.docstring === true, checks: c.checks ?? [], interfaceExts: c.interface ?? [], sourceExts: lang.detect?.extensions ?? [] }
    for (const ext of c.interface ?? []) table.push({ ...base, ext, interface: true })
    for (const ext of lang.detect?.extensions ?? []) if (!(c.interface ?? []).includes(ext)) table.push({ ...base, ext, interface: false })
  }
  for (const [ext, line] of Object.entries(FALLBACK)) table.push({ id: null, ext, line, block: [], docstring: false, checks: [], interfaceExts: [], sourceExts: [], interface: false })
  return file => {
    const name = file.split('/').pop()
    return table.filter(t => (t.ext.startsWith('.') ? name.toLowerCase().endsWith(t.ext.toLowerCase()) : name === t.ext)).sort((a, b) => b.ext.length - a.ext.length || Number(b.interface) - Number(a.interface))[0]
  }
}

export function parseAdded(diffText) {
  const added = []
  let file = null
  let line = 0
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.startsWith('+++ b/') ? raw.slice(6) : null; continue }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) { line = Number(hunk[1]); continue }
    if (file && raw.startsWith('+') && !raw.startsWith('+++')) { added.push({ file, line, text: raw.slice(1) }); line += 1 }
  }
  return added
}

/** Files a unified diff creates (old side /dev/null). */
export function newFiles(diffText) {
  const created = new Set()
  let fromNull = false
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('--- ')) fromNull = raw === '--- /dev/null'
    else if (raw.startsWith('+++ b/') && fromNull) created.add(raw.slice(6))
  }
  return created
}

function trailingComment(text, markers) {
  for (const marker of markers) {
    const at = text.indexOf(` ${marker} `)
    if (at > 0) {
      const before = text.slice(0, at)
      if ((before.match(/["'`]/g) ?? []).length % 2 === 0 && before.trim() !== '') return { code: before, comment: text.slice(at + marker.length + 1).trim(), marker, gap: before.endsWith(' ') ? 2 : 1 }
    }
  }
  return null
}

function extract(rows, syntax) {
  const items = []
  const codeLines = new Map()
  const codeRows = []
  let run = []
  let block = null
  let docstring = null
  let previous = -2
  for (const { file, line, text } of rows) {
    if (line !== previous + 1) { block = null; docstring = null; run = [] }
    previous = line
    const trimmed = text.trim()
    const push = (kind, body, extra = {}) => { const item = { file, line, kind, text: body.trim(), raw: text, ...extra }; items.push(item); if (kind !== 'trailing') run.push(item) }
    if (trimmed === '') { run = []; continue }
    if (DIRECTIVE.test(trimmed) || LICENSE.test(trimmed)) continue
    if (syntax.docstring && (docstring || /^[rbuf]*("""|''')/.test(trimmed))) {
      const quote = docstring ?? (trimmed.match(/("""|''')/) ?? [])[1]
      const rest = docstring ? trimmed : trimmed.replace(/^[rbuf]*("""|''')/, '')
      const closes = rest.includes(quote)
      push('doc', rest.replace(new RegExp(`${quote}.*$`), ''))
      docstring = closes ? null : quote
      continue
    }
    if (block) {
      const closeAt = trimmed.indexOf(block.close)
      push(block.doc ? 'doc' : 'block', (closeAt === -1 ? trimmed : trimmed.slice(0, closeAt)).replace(/^\*+\s?/, ''))
      if (closeAt !== -1) block = null
      continue
    }
    const opening = syntax.block.find(([open]) => trimmed.startsWith(open))
    if (opening) {
      const [open, close] = opening
      const body = trimmed.slice(open.length)
      const closeAt = body.indexOf(close)
      const doc = open === '/*' && body.startsWith('*') && !body.startsWith('**/')
      push(doc ? 'doc' : 'block', (closeAt === -1 ? body : body.slice(0, closeAt)).replace(/^\*+\s?/, ''), { marker: open })
      if (closeAt === -1) block = { close, doc }
      continue
    }
    const marker = syntax.line.find(m => trimmed.startsWith(m))
    if (marker) {
      const body = trimmed.slice(marker.length)
      push(['///', '//!', '##', '---'].includes(marker) ? 'doc' : 'line', body.replace(/^[/!#-]\s?/, ''), { marker, tight: /^[A-Za-z0-9]/.test(body) })
      continue
    }
    const trailing = trailingComment(trimmed, syntax.line)
    if (trailing) push('trailing', trailing.comment, { marker: trailing.marker, gap: trailing.gap })
    codeRows.push({ file, line, text: trimmed, above: run })
    run = []
    codeLines.set(file, (codeLines.get(file) ?? 0) + 1)
  }
  return { items, codeLines, codeRows }
}

const finding = (item, rule, label, blocking, remark) => ({ file: item.file, line: item.line, rule, remark: `${label} (${blocking ? 'blocking' : 'non-blocking'}): ${remark}`, blocking, text: item.text.slice(0, 120) })

function looksLikeCode(text) {
  if (text.split(/\s+/).length >= 6 && !/\s=\s|[=!<>]=|=>|->|::|[{}]|\(\)/.test(text)) return false
  if (/^[A-Z][^;{}=]*[.!:]$/.test(text) && text.split(/\s+/).length > 3) return false
  return /[;{}]\s*$/.test(text) || /^[\w.\[\]]+\s*[-+*/|&]?=\s*\S/.test(text) || /^[\w.:]+\(.*\)\s*;?$/.test(text) || /^(if|for|while|switch|return|let|const|var|def|fn|func|function|import|from|using|else|elif|try|catch|except|throw|raise)\b.*[;{}):]\s*$/.test(text)
}

function judge(item, config) {
  const out = []
  const t = item.text
  if (t === '') return out
  if (DIVIDER.test(t)) return [finding(item, 'divider', 'issue', true, 'a divider line carries no information; delete it.')]
  const words = t.split(/\s+/)
  const hasReason = REASON.test(t)
  if (looksLikeCode(t)) out.push(finding(item, 'commented-out-code', 'issue', true, 'this looks like commented-out code. Delete it; version control keeps history.'))
  if (PROCESS.test(t)) out.push(finding(item, 'process-note', 'issue', true, 'this is a note about the change or the process, not about the code. Say it in the commit or the PR remarks; if a lasting reason exists, state that reason instead.'))
  if (QUESTION.test(t) && !/https?:\/\//.test(t)) out.push(finding(item, 'question', 'issue', true, 'a question or remark to a person does not belong in the code. Put it in the PR Q&A and delete the comment.'))
  if (NARRATIVE.test(unquoted(t))) out.push(finding(item, 'narrative', 'issue', true, 'this tells a story. State the fact or the reason in one plain sentence (comment-standards.md 5).'))
  if (item.kind !== 'doc' && NARRATION.test(t)) {
    out.push(finding(item, 'narrates-code', 'issue', true, 'this narrates the implementation step by step. The code already says how; keep only the reason or the design choice (comment gate, comment-standards.md 0a), or delete it.'))
  }
  if (item.kind !== 'doc' && MECHANICAL.test(t) && words.length <= 9 && !hasReason && !out.some(f => f.rule === 'commented-out-code')) {
    out.push(finding(item, 'restates-code', 'issue', true, 'this restates what the code does. Delete it, or rename or extract so the code says it.'))
  }
  const param = /^(?:@param(?:\s+\{[^}]*\})?\s+\[?(\w+)\]?|:param\s+(\w+):|<param name="(\w+)">)\s*-?\s*(.*?)(?:<\/param>)?$/.exec(t)
  if (param) {
    const name = param[1] ?? param[2] ?? param[3]
    const description = tokens(param[4] ?? '').filter(w => !STOP.has(w))
    const known = new Set(tokens(name))
    if (description.every(w => known.has(w))) out.push(finding(item, 'doc-repeats-signature', 'issue', true, `the description of \`${name}\` only repeats its name. Delete the doc line, or say what the name cannot (units, range, ownership).`))
  }
  const marker = /^(TODO|FIXME|HACK|XXX|NOTE)\b(.*)$/.exec(t)
  if (marker) {
    if (['HACK', 'XXX'].includes(marker[1])) out.push(finding(item, 'marker', 'issue', true, `use TODO or FIXME with an issue reference instead of ${marker[1]}.`))
    else if (marker[1] !== 'NOTE' && !/(#\d+|\([\w.@-]+\)|https?:\/\/)/.test(marker[2])) out.push(finding(item, 'marker', 'issue', true, `${marker[1]} has no issue reference or owner. Add one (TODO(#123)) and list it in the Handoff.`))
  } else if (/^(todo|fixme)\b/.test(t)) out.push(finding(item, 'marker', 'issue', true, 'write markers in capitals (TODO, FIXME).'))
  if (item.kind !== 'doc' && item.raw.length > config.maxLineColumns && !/https?:\/\//.test(t)) out.push(finding(item, 'long-line', 'issue', true, `this line is ${item.raw.length} columns; wrap comments before ${config.maxLineColumns}.`))
  return out
}

function groups(items) {
  const result = []
  for (const item of items) {
    const last = result[result.length - 1]
    if (last && last.file === item.file && item.line === last.end + 1 && item.kind !== 'trailing' && last.kind !== 'trailing') { last.end = item.line; last.items.push(item) }
    else result.push({ file: item.file, start: item.line, end: item.line, kind: item.kind, items: [item] })
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

const STRICT = { maxLineColumns: 80, densityWarn: 0.35, densityBlock: 0.5, densityMinComments: 5, longBlockLines: 6, interface: { densityWarn: 0.6, densityBlock: 0.75, longBlockLines: 12 } }
const blockingIssue = (file, line, rule, remark) => ({ file, line, rule, blocking: true, text: '', remark: `issue (blocking): ${remark}` })

/** A source file and its interface file share a directory and a stem, whatever the language. */
const pairKey = (file, syntax) => {
  const at = file.lastIndexOf('/')
  return `${at === -1 ? '' : file.slice(0, at + 1)}${stemOf(file, syntax)}`
}

const stemOf = (file, syntax) => {
  const name = file.split('/').pop()
  const ext = [...(syntax.interface ? syntax.interfaceExts : syntax.sourceExts)].sort((a, b) => b.length - a.length).find(e => name.toLowerCase().endsWith(e.toLowerCase()))
  return ext ? name.slice(0, name.length - ext.length) : name
}

const meaningful = text => tokens(text).filter(w => w.length > 2 && !STOP.has(w))

function overlap(a, b) {
  const left = new Set(a)
  const right = new Set(b)
  const shared = [...left].filter(w => right.has(w)).length
  return shared / Math.max(1, Math.min(left.size, right.size))
}

/**
 * A `// SAFETY:` comment that sits above an unsafe line the diff does not touch is not in the diff (-U0), so read the
 * audited file: the nearest non-blank line above must be the SAFETY comment.
 */
function hasSafetyAbove(readFile, file, line) {
  if (!readFile) return false
  const lines = (readFile(file) ?? '').split('\n')
  for (let at = line - 2; at >= 0; at--) {
    if (lines[at].trim() === '') continue
    return /^\s*(\/\/|#|--)\s*SAFETY:/.test(lines[at])
  }
  return false
}

/** Checks a language's standard style guide makes on comments; `syntax.checks` lists the ones that apply. */
function languageChecks(items, codeRows, syntax, file, readFile) {
  const out = []
  const on = check => syntax.checks.includes(check)
  for (const item of items) {
    if (on('marker-space') && item.tight) out.push(finding(item, 'marker-space', 'issue', true, `put one space after \`${item.marker}\` (the language's style guide).`))
    if (on('inline-two-spaces') && item.kind === 'trailing' && item.gap < 2) out.push(finding(item, 'inline-gap', 'issue', true, 'separate an inline comment from the code by at least two spaces (PEP 8).'))
    if (on('no-trailing') && item.kind === 'trailing') out.push(finding(item, 'trailing', 'issue', true, 'put the comment on its own line above the code, not at the end of it (C# coding conventions).'))
    if (on('hash-only') && (item.marker === '//' || item.marker === '/*')) out.push(finding(item, 'hash-only', 'issue', true, 'use # for comments (Terraform style conventions).'))
    if (on('jsdoc-no-types') && item.kind === 'doc' && /\.(ts|tsx|mts|cts)$/.test(file) && /@(param|returns?|type|typedef)\s*\{/.test(item.text)) {
      out.push(finding(item, 'jsdoc-types', 'issue', true, 'do not repeat TypeScript types in JSDoc; the signature already declares them (TSDoc, Google TypeScript style).'))
    }
  }
  for (const row of codeRows) {
    const above = row.above.filter(i => i.text !== '')
    if (on('go-doc-name') && above.length > 0) {
      const declared = /^(?:func(?:\s*\([^)]*\))?|type|var|const)\s+([A-Z]\w*)/.exec(row.text)
      const words = above[0].text.split(/\s+/)
      if (declared && !words.slice(0, 2).includes(declared[1])) out.push(finding(above[0], 'go-doc-name', 'issue', true, `a doc comment on ${declared[1]} starts with its name (Go Doc Comments).`))
    }
    if (on('rust-safety') && /\bunsafe\s*(\{|impl\b)/.test(row.text) && !above.some(i => /^SAFETY:/.test(i.text)) && !/\/\/\s*SAFETY:/.test(row.text) && !hasSafetyAbove(readFile, row.file, row.line)) {
      out.push(blockingIssue(row.file, row.line, 'rust-safety', 'an unsafe block needs a `// SAFETY:` comment above it saying why the invariants hold (Rust API Guidelines, clippy undocumented_unsafe_blocks).'))
    }
  }
  return out
}

/**
 * Pure: judge the comments a unified diff adds. Strict: every finding blocks, except that interface files (.h, .d.ts,
 * .pyi, ...) get the relaxed limits in `commentAudit.interface`. `listed` is the Push JSON `comments` array and `docs`
 * its `docs` array; omit either to skip that budget check. `readFile(rel)` lets the audit read a source file's
 * interface sibling to catch comments that repeat it.
 */
export function auditDiff(diffText, config, { listed, docs, syntaxFor, readFile } = {}) {
  const byFile = new Map()
  for (const row of parseAdded(diffText)) byFile.set(row.file, [...(byFile.get(row.file) ?? []), row])
  const created = newFiles(diffText)
  const findings = []
  let docLines = 0
  for (const [file, rows] of byFile) {
    if (!DOC_FILE.test(file)) continue
    docLines += rows.filter(r => r.text.trim() !== '').length
    for (const row of rows) if (NARRATIVE.test(unquoted(row.text))) findings.push(blockingIssue(file, row.line, 'narrative', 'this doc line tells a story. State the fact plainly (comment-standards.md 5).'))
    const entry = (docs ?? []).find(e => e.file === file)
    if (docs && !entry) findings.push(blockingIssue(file, rows[0].line, 'unlisted-doc', 'this doc change is not in the Push JSON `docs` list. Add it with why it is shared, durable knowledge, or drop it if it only restates the code (comment-standards.md 6b).'))
    if (created.has(file) && !(typeof entry?.new === 'string' && entry.new.trim() !== '')) {
      findings.push(blockingIssue(file, rows[0].line, 'new-doc', 'a new doc file. Update the existing docs instead; a new file is only for a new system or module, named in the Push JSON `docs` row as `new` (comment-standards.md 6b).'))
    }
  }
  const settings = { ...STRICT, ...(config.commentAudit ?? {}) }
  const relaxed = { ...settings, ...STRICT.interface, ...(settings.interface ?? {}) }
  let commentLines = 0
  let codeTotal = 0
  const interfaceGroups = new Map()
  const sourceGroups = []
  for (const [file, rows] of byFile) {
    const syntax = syntaxFor(file)
    if (!syntax) continue
    const limits = syntax.interface ? relaxed : settings
    const { items, codeLines, codeRows } = extract(rows, syntax)
    const code = codeLines.get(file) ?? 0
    codeTotal += code
    commentLines += items.filter(i => i.text !== '').length
    for (const item of items) findings.push(...judge(item, settings))
    findings.push(...languageChecks(items, codeRows, syntax, file, readFile))
    for (const group of groups(items.filter(i => i.text !== ''))) {
      const first = group.items[0]
      const last = group.items[group.items.length - 1]
      const words = meaningful(group.items.map(i => i.text).join(' '))
      if (syntax.interface) interfaceGroups.set(pairKey(file, syntax), [...(interfaceGroups.get(pairKey(file, syntax)) ?? []), { file, line: first.line, words }])
      else if (group.kind !== 'trailing' && words.length >= 5) sourceGroups.push({ file, syntax, first, words })
      if (group.kind !== 'doc' && group.kind !== 'trailing' && group.items.length >= limits.longBlockLines) {
        findings.push(finding(first, 'long-prose', 'issue', true, `${group.items.length} lines of prose in code. Shorten it to the one reason the code cannot show, or move the explanation to the existing docs (comment-standards.md 6b).`))
      }
      if ((group.kind === 'line' || group.kind === 'block') && group.items.some(i => CONCEPT.test(i.text))) {
        findings.push(syntax.interface
          ? finding(first, 'docs-candidate', 'suggestion', false, 'an interface may describe its implementation, but if this concept spans more than this module, it belongs once in the existing docs (comment-standards.md 6b).')
          : finding(first, 'docs-candidate', 'issue', true, 'this explains a concept, a flow or usage. Put it in the interface file (.h, .d.ts, ...) if the language has one, or once in the existing docs with a one-line pointer here (comment-standards.md 6b); if it is local, cut it to the reason.'))
      }
      if (group.kind === 'line' || group.kind === 'block') {
        const noisy = group.items.some(i => DIVIDER.test(i.text) || /^(TODO|FIXME|NOTE)\b/.test(i.text))
        if (!noisy && !/^[A-Z0-9`"'(\[<_@]/.test(first.text)) findings.push(finding(first, 'sentence', 'issue', true, 'start a comment with a capital letter.'))
        if (!noisy && !/[.!?:)`"']$/.test(last.text) && !/https?:\/\//.test(last.text)) findings.push(finding(last, 'sentence', 'issue', true, 'end a comment sentence with a full stop.'))
      }
      if (listed && !listedCovers(listed, group)) {
        findings.push(finding(first, 'unlisted', 'issue', true, 'this comment is not in the Push JSON `comments` list. Add it with the reason the code cannot say it, or delete it.'))
      }
    }
    const own = items.filter(i => i.text !== '' && !['doc', 'trailing'].includes(i.kind)).length
    if (own + code > 0 && own >= limits.densityMinComments) {
      const ratio = own / (own + code)
      if (ratio >= limits.densityWarn) {
        const blocks = !syntax.interface || ratio >= limits.densityBlock
        findings.push({ file, line: items[0].line, rule: 'density', blocking: blocks, text: '', remark: `${blocks ? 'issue (blocking)' : 'suggestion (non-blocking)'}: ${own} of ${own + code} added lines in this file are comments (${Math.round(ratio * 100)}%). Over-commented: keep only what the code cannot say.` })
      }
    }
  }
  for (const source of sourceGroups) {
    const key = pairKey(source.file, source.syntax)
    if (!interfaceGroups.has(key) && readFile) {
      const dir = source.file.includes('/') ? source.file.slice(0, source.file.lastIndexOf('/') + 1) : ''
      for (const ext of source.syntax.interfaceExts) {
        const rel = `${dir}${stemOf(source.file, source.syntax)}${ext}`
        const text = readFile(rel)
        if (text == null) continue
        const syntax = syntaxFor(rel)
        const rows = text.split('\n').map((t, i) => ({ file: rel, line: i + 1, text: t }))
        const found = groups(extract(rows, syntax).items.filter(i => i.text !== '')).map(g => ({ file: rel, line: g.start, words: meaningful(g.items.map(i => i.text).join(' ')) }))
        interfaceGroups.set(key, [...(interfaceGroups.get(key) ?? []), ...found])
      }
    }
    const twin = (interfaceGroups.get(key) ?? []).find(g => g.words.length >= 5 && overlap(source.words, g.words) >= 0.7)
    if (twin) findings.push(finding(source.first, 'repeats-interface', 'issue', true, `this repeats the comment in ${twin.file}:${twin.line}. The interface describes the implementation; delete the copy here.`))
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const blocking = findings.filter(f => f.blocking).length
  return { commentLinesAdded: commentLines, codeLinesAdded: codeTotal, docLinesAdded: docLines, blocking, nonBlocking: findings.length - blocking, findings }
}

/** Audit the comments a staged change, a working tree or a commit range adds. */
export function commentAudit(destInput, { base, head = 'HEAD', staged = false, listed, docs, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '-U0']
  let args
  if (base) {
    for (const ref of [base, head]) if (!REF.test(ref)) throw new Error(`not a plain ref name: ${JSON.stringify(ref)}`)
    args = [...common, `${base}...${head}`]
  } else if (staged) args = [...common, '--cached']
  else args = [...common, 'HEAD']
  const ran = git(dest, args)
  if (!ran.ok) throw new Error(ran.err || 'git diff failed (is this a git repository?)')
  const config = loadLanguages(dest)
  const readFile = rel => {
    try {
      const abs = path.join(dest, rel)
      assertInside(dest, abs)
      return fs.readFileSync(abs, 'utf8')
    } catch { return null }
  }
  const result = auditDiff(ran.out, config, { listed, docs, syntaxFor: syntaxTable(dest), readFile })
  return { dest, source: base ? `${base}...${head}` : staged ? 'staged' : 'working tree vs HEAD', ...result }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  try {
    if (command !== 'audit') throw new Error('usage: devops-comments audit [--dest DIR] [--base REF [--head REF]] [--staged] [--listed PUSH.json] [--json]')
    const listedFile = opt('--listed')
    const push = listedFile ? JSON.parse(fs.readFileSync(listedFile, 'utf8')) : undefined
    const result = commentAudit(opt('--dest') ? path.resolve(opt('--dest')) : process.cwd(), { base: opt('--base'), head: opt('--head'), staged: argv.includes('--staged'), listed: push?.comments, docs: push?.docs })
    if (argv.includes('--json')) console.log(JSON.stringify(result))
    else {
      console.log(`${result.source}: ${result.commentLinesAdded} comment lines, ${result.codeLinesAdded} code lines, ${result.docLinesAdded} doc lines added; ${result.blocking} blocking, ${result.nonBlocking} non-blocking`)
      for (const f of result.findings) console.log(`${f.file}:${f.line}  ${f.remark}`)
    }
    if (result.blocking > 0) process.exitCode = 1
  } catch (error) {
    console.error(`devops-comments: ${error.message}`)
    process.exitCode = 2
  }
}
