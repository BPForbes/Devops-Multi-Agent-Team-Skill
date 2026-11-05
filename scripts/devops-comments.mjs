#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLanguages, resolveDest } from './devops-setup.mjs'
import { REF, git } from './devops-tags.mjs'

const FALLBACK = { '.yml': ['#'], '.yaml': ['#'], '.toml': ['#'], '.mk': ['#'], '.conf': ['#'], 'Dockerfile': ['#'], 'Makefile': ['#'] }
const DIRECTIVE = /^(#!|#\s*(include|define|if|ifdef|ifndef|else|elif|endif|undef|pragma|error|warning|region|endregion)\b|#\[|\/\/\s*(go:|@ts-|eslint|prettier|nolint|noinspection|swiftlint|SPDX|#region|#endregion|\+build)|\/\*\s*(eslint|istanbul|webpack|prettier)|#\s*(-\*-|type:|noqa|pylint|mypy|pragma|frozen_string_literal|shellcheck|rubocop|yamllint|cspell)|--\s*(\w+:)?\s*sqlfluff|<!--\s*(prettier|markdownlint))/i
const LICENSE = /\b(copyright|spdx-license|licensed under|all rights reserved)\b/i
const DIVIDER = /^[\s\-=*#_~+.\/\\<>|]{4,}$/
const REASON = /\b(because|since|so that|otherwise|to avoid|avoids?|must|never|always|only|unless|workaround|work around|due to|why|invariant|assumes?|guarantees?|requires?|precondition|postcondition|race|deadlock|overflow|leak|unsafe|security|trade-?off|rfc|spec|regression|see\b)/i
const MECHANICAL = /^(?:the\s+)?(increment|decrement|set|get|gets|sets|return|returns|loop|loops|iterate|iterates|call|calls|check|checks|create|creates|initiali[sz]e|initiali[sz]es|init|assign|assigns|add|adds|update|updates|print|prints|declare|declares|define|defines|import|imports|open|opens|close|closes|read|reads|write|writes|increase|decrease|store|stores|convert|converts|remove|removes|delete|deletes|push|pushes|pop|pops|append|appends|compute|computes|calculate|calculates|instantiate|constructor|getter|setter|for each|if)\b/i
const PROCESS = /\b(claude|gpt|chatgpt|copilot|llm|ai[- ]generated|prompt|agent|reviewer|per review|as requested|as discussed|note to self|i (think|guess|added|changed|fixed|removed|wasn'?t|am not)|we (should|need to|might|could)|new code|old code|previously|used to|was changed|changed from|added (for|by|to)|fixed (a )?(bug|issue)|this (pr|commit|branch|change)|wip|for now)\b/i
const QUESTION = /(\?(\s|$)|^(q:|question|why |should we|do we|can we|is this|are we|not sure|maybe|perhaps|unclear|wondering|hmm)|\b(please (check|confirm|review)|@\w+))/i
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'this', 'that', 'is', 'in', 'on', 'value', 'param', 'parameter', 'argument', 'input', 'given', 'specified'])

const tokens = text => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

function syntaxTable(dest) {
  const table = []
  for (const lang of loadLanguages(dest).languages) {
    const c = lang.comments ?? { line: [], block: [] }
    for (const ext of lang.detect?.extensions ?? []) table.push({ ext, line: [...c.line].sort((a, b) => b.length - a.length), block: c.block, docstring: c.docstring === true })
  }
  for (const [ext, line] of Object.entries(FALLBACK)) table.push({ ext, line, block: [], docstring: false })
  return file => {
    const name = file.split('/').pop()
    return table.filter(t => (t.ext.startsWith('.') ? name.toLowerCase().endsWith(t.ext.toLowerCase()) : name === t.ext)).sort((a, b) => b.ext.length - a.ext.length)[0]
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

function trailingComment(text, markers) {
  for (const marker of markers) {
    const at = text.indexOf(` ${marker} `)
    if (at > 0) {
      const before = text.slice(0, at)
      if ((before.match(/["'`]/g) ?? []).length % 2 === 0 && before.trim() !== '') return { code: before, comment: text.slice(at + marker.length + 1).trim(), marker }
    }
  }
  return null
}

function extract(rows, syntax) {
  const items = []
  const codeLines = new Map()
  let block = null
  let docstring = null
  let previous = -2
  for (const { file, line, text } of rows) {
    if (line !== previous + 1) { block = null; docstring = null }
    previous = line
    const trimmed = text.trim()
    const push = (kind, body, extra = {}) => items.push({ file, line, kind, text: body.trim(), raw: text, ...extra })
    if (trimmed === '') continue
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
      push(doc ? 'doc' : 'block', (closeAt === -1 ? body : body.slice(0, closeAt)).replace(/^\*+\s?/, ''))
      if (closeAt === -1) block = { close, doc }
      continue
    }
    const marker = syntax.line.find(m => trimmed.startsWith(m))
    if (marker) {
      const body = trimmed.slice(marker.length)
      push(['///', '//!', '##', '---'].includes(marker) ? 'doc' : 'line', body.replace(/^[/!#-]\s?/, ''))
      continue
    }
    const trailing = trailingComment(trimmed, syntax.line)
    if (trailing) push('trailing', trailing.comment)
    codeLines.set(file, (codeLines.get(file) ?? 0) + 1)
  }
  return { items, codeLines }
}

const finding = (item, rule, label, blocking, remark) => ({ file: item.file, line: item.line, rule, remark: `${label} (${blocking ? 'blocking' : 'non-blocking'}): ${remark}`, blocking, text: item.text.slice(0, 120) })

function looksLikeCode(text) {
  if (/^[A-Z][^;{}=]*[.!:]$/.test(text) && text.split(/\s+/).length > 3) return false
  return /[;{}]\s*$/.test(text) || /^[\w.\[\]]+\s*[-+*/|&]?=\s*\S/.test(text) || /^[\w.:]+\(.*\)\s*;?$/.test(text) || /^(if|for|while|switch|return|let|const|var|def|fn|func|function|import|from|using|else|elif|try|catch|except|throw|raise)\b.*[;{}):]\s*$/.test(text)
}

function judge(item, config) {
  const out = []
  const t = item.text
  if (t === '') return out
  if (DIVIDER.test(t)) return [finding(item, 'divider', 'suggestion', false, 'a divider line carries no information; delete it.')]
  const words = t.split(/\s+/)
  const hasReason = REASON.test(t)
  if (looksLikeCode(t)) out.push(finding(item, 'commented-out-code', 'issue', true, 'this looks like commented-out code. Delete it; version control keeps history.'))
  if (PROCESS.test(t)) out.push(finding(item, 'process-note', 'issue', true, 'this is a note about the change or the process, not about the code. Say it in the commit or the PR remarks; if a lasting reason exists, state that reason instead.'))
  if (QUESTION.test(t) && !/https?:\/\//.test(t)) out.push(finding(item, 'question', 'issue', true, 'a question or remark to a person does not belong in the code. Put it in the PR Q&A and delete the comment.'))
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
    if (['HACK', 'XXX'].includes(marker[1])) out.push(finding(item, 'marker', 'suggestion', false, `use TODO or FIXME with an issue reference instead of ${marker[1]}.`))
    else if (marker[1] !== 'NOTE' && !/(#\d+|\([\w.@-]+\)|https?:\/\/)/.test(marker[2])) out.push(finding(item, 'marker', 'suggestion', false, `${marker[1]} has no issue reference or owner. Add one (TODO(#123)) and list it in the Handoff.`))
  } else if (/^(todo|fixme)\b/.test(t)) out.push(finding(item, 'marker', 'nitpick', false, 'write markers in capitals (TODO, FIXME).'))
  if (item.kind !== 'doc' && item.raw.length > config.maxLineColumns && !/https?:\/\//.test(t)) out.push(finding(item, 'long-line', 'nitpick', false, `this line is ${item.raw.length} columns; wrap comments before ${config.maxLineColumns}.`))
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

/** Pure: judge the comments a unified diff adds. `listed` is a Push JSON `comments` array (omit to skip the budget check). */
export function auditDiff(diffText, config, { listed, syntaxFor } = {}) {
  const byFile = new Map()
  for (const row of parseAdded(diffText)) byFile.set(row.file, [...(byFile.get(row.file) ?? []), row])
  const findings = []
  let commentLines = 0
  let codeTotal = 0
  const settings = config.commentAudit ?? { maxLineColumns: 80, densityWarn: 0.35, densityBlock: 0.5, densityMinComments: 5, longBlockLines: 6 }
  for (const [file, rows] of byFile) {
    const syntax = syntaxFor(file)
    if (!syntax) continue
    const { items, codeLines } = extract(rows, syntax)
    const code = codeLines.get(file) ?? 0
    codeTotal += code
    commentLines += items.filter(i => i.text !== '').length
    for (const item of items) findings.push(...judge(item, settings))
    for (const group of groups(items.filter(i => i.text !== ''))) {
      const first = group.items[0]
      const last = group.items[group.items.length - 1]
      if (group.kind !== 'doc' && group.kind !== 'trailing' && group.items.length >= settings.longBlockLines) {
        findings.push(finding(first, 'long-prose', 'suggestion', false, `${group.items.length} lines of prose in code. Shorten it to the one reason the code cannot show, or move the explanation to the docs.`))
      }
      if (group.kind === 'line' || group.kind === 'block') {
        const noisy = group.items.some(i => DIVIDER.test(i.text) || /^(TODO|FIXME|NOTE)\b/.test(i.text))
        if (!noisy && !/^[A-Z0-9`"'(\[<_@]/.test(first.text)) findings.push(finding(first, 'sentence', 'nitpick', false, 'start a comment with a capital letter.'))
        if (!noisy && !/[.!?:)`"']$/.test(last.text) && !/https?:\/\//.test(last.text)) findings.push(finding(last, 'sentence', 'nitpick', false, 'end a comment sentence with a full stop.'))
      }
      if (listed && !listedCovers(listed, group)) {
        findings.push(finding(first, 'unlisted', 'issue', true, 'this comment is not in the Push JSON `comments` list. Add it with the reason the code cannot say it, or delete it.'))
      }
    }
    const own = items.filter(i => i.text !== '' && !['doc', 'trailing'].includes(i.kind)).length
    if (own + code > 0 && own >= settings.densityMinComments) {
      const ratio = own / (own + code)
      if (ratio >= settings.densityWarn) {
        findings.push({ file, line: items[0].line, rule: 'density', blocking: ratio >= settings.densityBlock, text: '', remark: `${ratio >= settings.densityBlock ? 'issue (blocking)' : 'suggestion (non-blocking)'}: ${own} of ${own + code} added lines in this file are comments (${Math.round(ratio * 100)}%). Over-commented: keep only what the code cannot say.` })
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const blocking = findings.filter(f => f.blocking).length
  return { commentLinesAdded: commentLines, codeLinesAdded: codeTotal, blocking, nonBlocking: findings.length - blocking, findings }
}

/** Audit the comments a staged change, a working tree or a commit range adds. */
export function commentAudit(destInput, { base, head = 'HEAD', staged = false, listed, roots } = {}) {
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
  const result = auditDiff(ran.out, config, { listed, syntaxFor: syntaxTable(dest) })
  return { dest, source: base ? `${base}...${head}` : staged ? 'staged' : 'working tree vs HEAD', ...result }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  try {
    if (command !== 'audit') throw new Error('usage: devops-comments audit [--dest DIR] [--base REF [--head REF]] [--staged] [--listed PUSH.json] [--json]')
    const listedFile = opt('--listed')
    const listed = listedFile ? JSON.parse(fs.readFileSync(listedFile, 'utf8')).comments : undefined
    const result = commentAudit(opt('--dest') ? path.resolve(opt('--dest')) : process.cwd(), { base: opt('--base'), head: opt('--head'), staged: argv.includes('--staged'), listed })
    if (argv.includes('--json')) console.log(JSON.stringify(result))
    else {
      console.log(`${result.source}: ${result.commentLinesAdded} comment lines, ${result.codeLinesAdded} code lines added; ${result.blocking} blocking, ${result.nonBlocking} non-blocking`)
      for (const f of result.findings) console.log(`${f.file}:${f.line}  ${f.remark}`)
    }
    if (result.blocking > 0) process.exitCode = 1
  } catch (error) {
    console.error(`devops-comments: ${error.message}`)
    process.exitCode = 2
  }
}
