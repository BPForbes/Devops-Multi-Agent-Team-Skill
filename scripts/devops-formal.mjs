#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInside, resolveDest } from './devops-setup.mjs'

const SKIP_DIRS = new Set(['.git', '.lake', 'node_modules', 'build', 'target', 'dist'])
const MAX_FILES = 2000
const MAX_BYTES = 1024 * 1024
export const STATUSES = ['proved', 'disproved', 'not-attempted', 'gave-up']

const FINDINGS = [
  { kind: 'sorry', severity: 'hole', test: /\b(?:sorry|admit)\b/, why: 'an unproved goal: the theorem is not proved' },
  { kind: 'axiom', severity: 'hole', test: /^\s*(?:(?:private|protected|noncomputable)\s+)*axiom\b/, why: 'an assumed statement: the proof holds only if it is true' },
  { kind: 'native_decide', severity: 'review', test: /\bnative_decide\b/, why: 'trusts the compiler and its evaluator, not only the kernel' },
  { kind: 'unsafe', severity: 'review', test: /\bunsafe\b/, why: 'an unsafe declaration that the proof does not cover' },
  { kind: 'extern', severity: 'review', test: /@\[\s*(?:extern|implemented_by)\b/, why: 'code that runs in place of the modelled definition; the proof does not cover it' },
  { kind: 'partial', severity: 'review', test: /^\s*(?:(?:private|protected|noncomputable)\s+)*partial\s+def\b/, why: 'no termination proof: nothing can be proved about it' },
]

export function stripLean(text) {
  let out = ''
  let depth = 0
  let i = 0
  const keep = ch => (ch === '\n' ? '\n' : ' ')
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    if (depth > 0) {
      if (two === '/-') { depth++; out += '  '; i += 2 } else if (two === '-/') { depth--; out += '  '; i += 2 } else { out += keep(text[i]); i++ }
    } else if (two === '/-') { depth = 1; out += '  '; i += 2 } else if (two === '--') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++ }
    } else if (text[i] === '"') {
      out += '"'; i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) { out += ' '; i++ }
        out += keep(text[i]); i++
      }
      if (i < text.length) { out += '"'; i++ }
    } else { out += text[i]; i++ }
  }
  return out
}

export function scanLeanText(text) {
  const lines = stripLean(text).split('\n')
  const found = []
  lines.forEach((line, index) => {
    for (const rule of FINDINGS) if (rule.test.test(line)) found.push({ line: index + 1, kind: rule.kind, severity: rule.severity, why: rule.why, text: line.trim().slice(0, 120) })
  })
  return found
}

function leanFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (found.length >= MAX_FILES || entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) leanFiles(full, found)
    } else if (entry.name.endsWith('.lean')) found.push(full)
  }
  return found
}

function readLean(file) {
  const stat = fs.statSync(file)
  if (stat.size > MAX_BYTES) return { skipped: `larger than ${MAX_BYTES} bytes` }
  return { text: fs.readFileSync(file, 'utf8') }
}

function insideProject(dest, rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) return null
  const target = path.resolve(dest, rel)
  try { assertInside(dest, target) } catch { return null }
  return fs.existsSync(target) && fs.statSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink() ? target : null
}

export function formalCheck(destInput, { paths, push, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const files = []
  for (const rel of paths?.length ? paths : ['.']) {
    const target = path.resolve(dest, rel)
    assertInside(dest, target)
    if (!fs.existsSync(target)) throw new Error(`no such path: ${rel}`)
    if (fs.lstatSync(target).isSymbolicLink()) continue
    if (fs.statSync(target).isDirectory()) files.push(...leanFiles(target))
    else if (target.endsWith('.lean')) files.push(target)
  }
  const unique = [...new Set(files)].slice(0, MAX_FILES)
  const findings = []
  const skipped = []
  for (const file of unique) {
    const read = readLean(file)
    const rel = path.relative(dest, file)
    if (read.skipped) { skipped.push({ file: rel, why: read.skipped }); continue }
    for (const f of scanLeanText(read.text)) findings.push({ file: rel, ...f })
  }
  const problems = []
  const records = push ? checkRecords(dest, push, findings, problems) : []
  return { dest, files: unique.length, skipped, findings, holes: findings.filter(f => f.severity === 'hole').length, records, problems, ok: problems.length === 0 }
}

function checkRecords(dest, pushPath, findings, problems) {
  const target = insideProject(dest, pushPath)
  if (!target) { problems.push(`push file not found inside the project: ${pushPath}`); return [] }
  let doc
  try { doc = JSON.parse(fs.readFileSync(target, 'utf8')) } catch (err) { problems.push(`push file is not valid JSON: ${err.message}`); return [] }
  const rows = doc.formal
  if (rows === undefined) return []
  if (!Array.isArray(rows)) { problems.push('formal must be an array'); return [] }
  const seen = new Set()
  return rows.map((row, n) => {
    const at = `formal[${n}]${row?.id ? ` (${row.id})` : ''}`
    const need = (cond, msg) => { if (!cond) problems.push(`${at}: ${msg}`) }
    need(typeof row?.id === 'string' && row.id !== '' && !seen.has(row.id), 'id must be a unique non-empty string')
    seen.add(row?.id)
    need(typeof row?.claim === 'string' && row.claim.trim() !== '', 'claim (the property in plain English) is required')
    need(STATUSES.includes(row?.status), `status must be one of ${STATUSES.join(', ')}`)
    need(typeof row?.covers === 'string' && /\S+:\d+/.test(row.covers), 'covers must name the code the model stands for as path:line')
    need(typeof row?.notCovers === 'string' && row.notCovers.trim() !== '', 'notCovers must say what the proof does not cover')
    const lean = row?.status === 'not-attempted' ? null : insideProject(dest, row?.lean)
    if (row?.status !== 'not-attempted') need(lean !== null, `lean file not found inside the project: ${row?.lean}`)
    need(row?.status === 'not-attempted' || insideProject(dest, row?.writeup) !== null, `writeup not found inside the project: ${row?.writeup}`)
    if (row?.status === 'disproved') need(typeof row?.counterexampleTest === 'string' && row.counterexampleTest.trim() !== '', 'a disproved claim needs counterexampleTest (the test that now pins it)')
    const rel = lean ? path.relative(dest, lean) : row?.lean
    const holes = lean ? (readLean(lean).text ? scanLeanText(readLean(lean).text).filter(f => f.severity === 'hole') : []) : []
    if (row?.status === 'proved') need(holes.length === 0, `marked proved but ${rel} has ${holes.map(h => `${h.kind} at line ${h.line}`).join(', ')}`)
    return { id: row?.id, status: row?.status, lean: rel }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const result = formalCheck(flag('--dest') ?? process.cwd(), { paths: argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')), push: flag('--push') })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
