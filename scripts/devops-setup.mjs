#!/usr/bin/env node
// devops-setup: detect the languages in a project and install the
// devops-multi-agent-team skill, agents, commands and project profile.
//
//   node scripts/devops-setup.mjs list
//   node scripts/devops-setup.mjs detect  [--dest DIR] [--json]
//   node scripts/devops-setup.mjs profile [--dest DIR] [--lang auto|id,id]
//   node scripts/devops-setup.mjs install [--dest DIR] [--target cursor|claude|both]
//                                         [--lang auto|id,id] [--force] [--dry-run]
//
// No dependencies; Node 18 or newer. This file is the one place that
// knows how to read languages.json: the Claude mod calls `detect --json`
// instead of re-implementing it.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', '.venv', 'venv', '__pycache__',
  '.devops', '.terraform', 'vendor', 'bin', 'obj', '.next', '.cache', '.gradle', '.idea',
])
const MAX_DEPTH = 5
const MAX_ENTRIES = 20000
const GITIGNORE_MARKER = '# devops-multi-agent-team'

// ---------------------------------------------------------------- data

/** languages.json from the project's .devops/ (if installed) else the package, plus .devops/languages.local.json merged by id. */
export function loadLanguages(dest) {
  const projectCopy = path.join(dest, '.devops', 'languages.json')
  const base = JSON.parse(fs.readFileSync(fs.existsSync(projectCopy) ? projectCopy : path.join(PACKAGE_ROOT, 'languages.json'), 'utf8'))
  const localPath = path.join(dest, '.devops', 'languages.local.json')
  if (!fs.existsSync(localPath)) return base
  const local = JSON.parse(fs.readFileSync(localPath, 'utf8'))
  const byId = new Map(base.languages.map(l => [l.id, l]))
  for (const entry of local.languages ?? []) byId.set(entry.id, { ...(byId.get(entry.id) ?? {}), ...entry })
  return { ...base, layers: { ...base.layers, ...(local.layers ?? {}) }, languages: [...byId.values()] }
}

// ---------------------------------------------------------------- detect

function walk(root) {
  const files = []
  const dirs = []
  const queue = [[root, 0]]
  while (queue.length > 0 && files.length + dirs.length < MAX_ENTRIES) {
    const [dir, depth] = queue.shift()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        dirs.push(rel)
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) queue.push([full, depth + 1])
      } else if (entry.isFile()) {
        files.push(rel)
      }
    }
  }
  return { files, dirs }
}

function matchesFile(pattern, rel) {
  const name = rel.split('/').pop()
  return pattern.startsWith('*') ? name.endsWith(pattern.slice(1)) : name === pattern
}

/** Which languages the project at `dest` uses, with the evidence for each, strongest first. */
export function detectLanguages(dest, config = loadLanguages(dest)) {
  const { files, dirs } = walk(dest)
  const found = []
  for (const lang of config.languages) {
    const detect = lang.detect ?? {}
    const evidence = []
    for (const pattern of detect.files ?? []) {
      const hit = files.find(rel => matchesFile(pattern, rel))
      if (hit) evidence.push(hit)
    }
    for (const wanted of detect.paths ?? []) {
      if (dirs.includes(wanted) || files.includes(wanted)) evidence.push(wanted)
    }
    let count = 0
    const extensions = detect.extensions ?? []
    if (extensions.length > 0) {
      count = files.filter(rel => extensions.some(ext => rel.endsWith(ext))).length
      if (count > 0) evidence.push(`${count} ${extensions.join('|')} file${count === 1 ? '' : 's'}`)
    }
    if (evidence.length > 0) found.push({ id: lang.id, name: lang.name, layers: lang.layers, count, evidence })
  }
  return found.sort((a, b) => b.evidence.length - a.evidence.length || b.count - a.count || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- profile

function resolveSelected(config, selection, detected) {
  const ids = selection === 'auto' ? detected.map(d => d.id) : selection.split(',').map(s => s.trim()).filter(Boolean)
  const known = new Map(config.languages.map(l => [l.id, l]))
  const unknown = ids.filter(id => !known.has(id))
  if (unknown.length > 0) throw new Error(`unknown language id(s): ${unknown.join(', ')} (run: devops-setup list)`)
  return ids.map(id => known.get(id))
}

const bullets = (items, indent = '') => items.map(item => `${indent}- ${item}`).join('\n')
const code = text => '`' + text.replace(/`/g, "'") + '`'

function section(selected, render) {
  return selected.length === 0 ? '_No language selected. Add rows by hand or re-run with `--lang`._' : selected.map(render).join('\n\n')
}

export function renderProfile(config, selected, dest, now = new Date()) {
  const template = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'project.md'), 'utf8')
  const ids = new Set(selected.map(l => l.id))

  const languages = selected.length === 0 ? '_None detected._' : [
    '| Language | Layer(s) | Toolchain check | Install |',
    '|----------|----------|-----------------|---------|',
    ...selected.map(l => `| ${l.name} (\`${l.id}\`) | ${l.layers.join(', ')} | ${code(l.toolchain?.verify ?? '')} | ${(l.toolchain?.install ?? []).map(code).join('<br>')} |`),
  ].join('\n')

  const layers = [...new Set(selected.flatMap(l => l.layers))]
  const departments = layers.length === 0 ? '_None._' : [
    '| Department | Layer | Languages | Owns |',
    '|------------|-------|-----------|------|',
    ...layers.map(layer => {
      const members = selected.filter(l => l.layers.includes(layer)).map(l => l.id)
      return `| **${config.layers[layer]?.department ?? layer}** | ${layer} | ${members.join(', ')} | ${config.layers[layer]?.summary ?? ''} |`
    }),
    '| **rules** | any | any | the project\'s instruction files, PR description text |',
  ].join('\n')

  const validation = section(selected, l => `### ${l.name}\n${bullets((l.validate ?? []).map(code))}`)

  const security = section(selected, l => {
    const s = l.security ?? {}
    const lines = []
    if (s.sast) {
      const extra = [s.sast.language && `language \`${s.sast.language}\``, s.sast.buildMode && `build mode \`${s.sast.buildMode}\``, s.sast.command && `build ${code(s.sast.command)}`, s.sast.suite && `suite \`${s.sast.suite}\``].filter(Boolean).join(', ')
      lines.push(`SAST: **${s.sast.tool}** (${extra})`)
    } else {
      lines.push('SAST: **none** — review by hand and say so in the report')
    }
    if ((s.sca ?? []).length > 0) lines.push(`Dependencies: ${s.sca.map(code).join(', ')}`)
    if ((s.secrets ?? []).length > 0) lines.push(`Secrets: ${s.secrets.map(code).join(', ')}`)
    if (s.note) lines.push(`Note: ${s.note}`)
    if ((l.sensitiveHints ?? []).length > 0) lines.push(`Sensitive areas: ${l.sensitiveHints.join('; ')}`)
    return `### ${l.name}\n${bullets(lines)}`
  })

  const style = section(selected, l => {
    const rules = [...(l.style ?? [])]
    const optIn = (l.optInStyle ?? []).map(o => `_Opt-in (${o.from}, \`${o.id}\`):_ ${o.rule}`)
    return `### ${l.name}\n${bullets([...rules, ...optIn])}`
  })

  const pairs = []
  for (const l of selected) {
    for (const edge of l.interactsWith ?? []) {
      if (ids.has(edge.with)) pairs.push(`**${l.id} ↔ ${edge.with}** via ${edge.via}. Contract: ${edge.contract}.`)
    }
  }
  const interactions = pairs.length === 0
    ? '_No two detected languages declare a boundary. See `LANGUAGES.md`, "How the layers interact"._'
    : bullets(pairs) + '\n\nA change that moves one of these contracts is staffed on both sides and validated with both languages\' commands.'

  const notes = section(selected, l => `### ${l.name}\n${bullets(l.setupNotes ?? [])}`)

  const instructionFiles = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.cursor/rules', 'CONTRIBUTING.md']
    .filter(name => fs.existsSync(path.join(dest, name))).map(code).join(', ') || '_none found_'

  return template
    .replace('{{DATE}}', now.toISOString().slice(0, 10))
    .replace('{{INSTRUCTION_FILES}}', instructionFiles)
    .replace('{{LANGUAGES}}', languages)
    .replace('{{DEPARTMENTS}}', departments)
    .replace('{{VALIDATION}}', validation)
    .replace('{{SECURITY}}', security)
    .replace('{{STYLE}}', style)
    .replace('{{INTERACTIONS}}', interactions)
    .replace('{{NOTES}}', notes)
}

// ---------------------------------------------------------------- install

function copyTree(from, to, { force, dryRun }, report) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      copyTree(source, target, { force, dryRun }, report)
    } else if (entry.isFile()) {
      copyFile(source, target, { force, dryRun }, report)
    }
  }
}

function copyFile(source, target, { force, dryRun }, report) {
  const exists = fs.existsSync(target)
  if (exists && fs.readFileSync(source).equals(fs.readFileSync(target))) return report.same.push(target)
  if (exists && !force) return report.skipped.push(target)
  report[exists ? 'replaced' : 'created'].push(target)
  if (dryRun) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function writeText(target, text, { force, dryRun }, report) {
  const exists = fs.existsSync(target)
  if (exists && fs.readFileSync(target, 'utf8') === text) return report.same.push(target)
  if (exists && !force) return report.skipped.push(target)
  report[exists ? 'replaced' : 'created'].push(target)
  if (dryRun) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}

function ensureGitignore(dest, { dryRun }, report) {
  const target = path.join(dest, '.gitignore')
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (current.includes(GITIGNORE_MARKER)) return report.same.push(target)
  const block = [
    GITIGNORE_MARKER,
    '.devops/thoughts/*',
    '!.devops/thoughts/non-finalized/',
    '.devops/thoughts/non-finalized/*',
    '!.devops/thoughts/non-finalized/.gitkeep',
    '_scratch/',
    '*.scratch*',
    'codeql-*.sarif',
    '.codeql-db-*',
    '',
  ].join('\n')
  report[current ? 'replaced' : 'created'].push(target)
  if (!dryRun) fs.writeFileSync(target, current + (current && !current.endsWith('\n') ? '\n' : '') + (current ? '\n' : '') + block)
}

export function install({ dest, target = 'both', lang = 'auto', force = false, dryRun = false }) {
  const report = { created: [], replaced: [], skipped: [], same: [], languages: [] }
  const opts = { force, dryRun }
  const config = loadLanguages(dest)
  const detected = detectLanguages(dest, config)
  const selected = resolveSelected(config, lang, detected)
  report.languages = selected.map(l => l.id)

  const hosts = target === 'both' ? ['.cursor', '.claude'] : [target === 'cursor' ? '.cursor' : target === 'claude' ? '.claude' : null]
  if (hosts.includes(null)) throw new Error(`--target must be cursor, claude or both (got ${target})`)
  for (const host of hosts) {
    copyTree(path.join(PACKAGE_ROOT, 'skills', 'devops-multi-agent-team'), path.join(dest, host, 'skills', 'devops-multi-agent-team'), opts, report)
    copyTree(path.join(PACKAGE_ROOT, 'agents'), path.join(dest, host, 'agents'), opts, report)
    copyTree(path.join(PACKAGE_ROOT, 'commands'), path.join(dest, host, 'commands'), opts, report)
  }
  copyFile(path.join(PACKAGE_ROOT, 'languages.json'), path.join(dest, '.devops', 'languages.json'), opts, report)
  copyFile(path.join(PACKAGE_ROOT, 'LANGUAGES.md'), path.join(dest, '.devops', 'LANGUAGES.md'), opts, report)
  writeText(path.join(dest, '.devops', 'languages.local.json'), '{\n  "languages": []\n}\n', { force: false, dryRun }, report)
  writeText(path.join(dest, '.devops', 'project.md'), renderProfile(config, selected, dest), opts, report)
  writeText(path.join(dest, '.devops', 'thoughts', 'non-finalized', '.gitkeep'), '', { force: false, dryRun }, report)
  ensureGitignore(dest, opts, report)
  return report
}

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const args = { _: [], dest: process.cwd(), target: 'both', lang: 'auto', force: false, dryRun: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dest') args.dest = path.resolve(argv[++i])
    else if (a === '--target') args.target = argv[++i]
    else if (a === '--lang') args.lang = argv[++i]
    else if (a === '--force') args.force = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '-h' || a === '--help') args._.unshift('help')
    else args._.push(a)
  }
  return args
}

const HELP = `devops-setup <command> [options]

  list                       print the languages this package knows
  detect                     print the languages found under --dest
  profile                    print the .devops/project.md the installer would write
  install                    copy the skill, agents, commands and profile into --dest

options: --dest DIR (default: cwd)  --target cursor|claude|both (default both)
         --lang auto|id,id (default auto)  --force  --dry-run  --json
`

function main(argv) {
  const args = parseArgs(argv)
  const command = args._[0] ?? 'help'
  if (command === 'help') return console.log(HELP)
  const config = loadLanguages(args.dest)
  if (command === 'list') {
    for (const l of config.languages) console.log(`${l.id.padEnd(14)} ${l.layers.join(',').padEnd(18)} ${l.name}`)
    return
  }
  if (command === 'detect') {
    const found = detectLanguages(args.dest, config)
    if (args.json) return console.log(JSON.stringify(found))
    if (found.length === 0) return console.log('No known language found.')
    for (const f of found) console.log(`${f.id.padEnd(14)} ${f.layers.join(',').padEnd(18)} ${f.evidence.join('; ')}`)
    return
  }
  if (command === 'profile') {
    const selected = resolveSelected(config, args.lang, detectLanguages(args.dest, config))
    return console.log(renderProfile(config, selected, args.dest))
  }
  if (command === 'install') {
    const report = install(args)
    if (args.json) return console.log(JSON.stringify(report))
    const verb = args.dryRun ? 'would be' : 'were'
    console.log(`Languages: ${report.languages.join(', ') || '(none)'}`)
    for (const key of ['created', 'replaced', 'skipped']) {
      if (report[key].length > 0) console.log(`${report[key].length} file(s) ${verb} ${key}${key === 'skipped' ? ' (exist and differ; use --force)' : ''}`)
    }
    console.log('Next: open .devops/project.md and fill the "Fill in by hand" section; commit it.')
    return
  }
  console.error(`unknown command: ${command}\n\n${HELP}`)
  process.exitCode = 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-setup: ${error.message}`)
    process.exitCode = 1
  }
}
