#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './devops-main.mjs'

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', '.venv', 'venv', '__pycache__',
  '.devops', 'devops-skill', '.terraform', 'vendor', 'bin', 'obj', '.next', '.cache', '.gradle', '.idea',
])
const MAX_DEPTH = 5
const MAX_ENTRIES = 20000
const GITIGNORE_MARKER = '# devops-multi-agent-team'

/** The project's .devops/languages.json if installed, else the package's; .devops/languages.local.json is merged over it by id. */
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

export function loadServices(dest) {
  const projectCopy = path.join(dest, '.devops', 'services.json')
  return JSON.parse(fs.readFileSync(fs.existsSync(projectCopy) ? projectCopy : path.join(PACKAGE_ROOT, 'services.json'), 'utf8'))
}

export const VERIFY_ARGS = new Set(['--version', '-version', 'version', '-v', '-V', '--client'])

/** Argv for a `tool --version` style check, or null for anything else: paths, shell syntax and other flags are never run. */
export function parseVerify(text) {
  if (typeof text !== 'string') return null
  const words = text.trim().split(/\s+/)
  if (words.length < 2 || words.length > 3) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(words[0])) return null
  return words.slice(1).every(word => VERIFY_ARGS.has(word)) ? words : null
}

const KEBAB = /^[a-z][a-z0-9-]*$/
/** Language-specific comment checks the audit knows; `comments.checks` in languages.json picks from these. */
export const COMMENT_CHECKS = [
  'marker-space', 'inline-two-spaces', 'go-doc-name', 'no-trailing', 'rust-safety',
  'jsdoc-no-types', 'hash-only',
]
const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string')

/** Problems with the optional comment settings: interface extensions, audit-only names, checks. */
function commentOptionProblems({ interface: interfaces, extensions, checks }) {
  const problems = []
  const extensionList = interfaces === undefined
    || (isStringList(interfaces) && interfaces.every(e => e.startsWith('.')))
  if (!extensionList) problems.push('comments.interface must be a list of extensions (".h")')
  if (extensions !== undefined && !isStringList(extensions)) {
    problems.push('comments.extensions must be a list of extensions or exact file names, '
      + 'audited but not used for detection')
  }
  const knownChecks = checks === undefined
    || (isStringList(checks) && checks.every(c => COMMENT_CHECKS.includes(c)))
  if (!knownChecks) problems.push(`comments.checks must come from: ${COMMENT_CHECKS.join(', ')}`)
  return problems
}

/** `partial` is for an override of a known id: only the fields given are checked. */
export function validateLanguage(lang, ctx, { partial = false } = {}) {
  const problems = []
  const at = `language ${lang?.id ?? '(no id)'}`
  const need = (cond, msg) => { if (!cond) problems.push(`${at}: ${msg}`) }
  need(KEBAB.test(lang?.id ?? ''), 'id must be lower-case kebab')
  const has = key => !partial || key in lang
  if (has('name')) need(typeof lang.name === 'string' && lang.name !== '', 'name')
  if (has('layers')) {
    need(Array.isArray(lang.layers) && lang.layers.length > 0, 'layers')
    for (const layer of lang.layers ?? []) need(layer in ctx.layers, `unknown layer ${layer}`)
  }
  if (has('detect')) {
    const d = lang.detect ?? {}
    need((d.files?.length ?? 0) + (d.extensions?.length ?? 0) + (d.paths?.length ?? 0) > 0, 'detect needs files, extensions or paths')
  }
  if (has('validate')) need(isStringList(lang.validate) && lang.validate.length > 0, 'validate')
  if (has('toolchain')) {
    need(parseVerify(lang.toolchain?.verify) !== null, `toolchain.verify must be "<command> <${[...VERIFY_ARGS].join('|')}>" (got ${JSON.stringify(lang.toolchain?.verify)})`)
    need(isStringList(lang.toolchain?.install) && lang.toolchain.install.length > 0, 'toolchain.install')
  }
  if (has('sandboxImage')) need(lang.sandboxImage === null || (typeof lang.sandboxImage === 'string' && lang.sandboxImage !== ''), 'sandboxImage must be an image name or null')
  if (has('security')) {
    const s = lang.security
    need(s && 'sast' in s && Array.isArray(s.sca) && Array.isArray(s.secrets), 'security needs sast, sca, secrets')
    if (s?.sast === null) need(s.unanalysed === true, 'sast null requires unanalysed: true')
    if (s?.sast && s.sast !== null) need(s.unanalysed !== true, 'a language with a scanner is not unanalysed')
    if (s?.sast?.tool === 'codeql') need(ctx.codeqlLanguages.includes(s.sast.language), `unknown CodeQL language ${s.sast.language}`)
  }
  if (has('comments')) need(isStringList(lang.comments?.line) && Array.isArray(lang.comments?.block), 'comments needs line (list of markers) and block (list of [open, close])')
  const commentProblems = has('comments') ? commentOptionProblems(lang.comments ?? {}) : []
  commentProblems.forEach(message => need(false, message))
  if (has('docs')) need(typeof lang.docs?.format === 'string' && typeof lang.docs?.lineComment === 'string' && typeof lang.docs?.check === 'string', 'docs needs format, lineComment and check (see LANGUAGES.md)')
  const guide = lang.docs?.guide
  const badGuide = guide !== undefined && (typeof guide !== 'string' || guide.trim() === '')
  if (has('docs') && badGuide) need(false, 'docs.guide must be a non-empty string')
  for (const key of ['style', 'sensitiveHints', 'setupNotes', 'seenIn']) if (key in lang) need(isStringList(lang[key]), `${key} must be a list of strings`)
  for (const edge of lang.interactsWith ?? []) need(edge && typeof edge.with === 'string' && typeof edge.via === 'string' && typeof edge.contract === 'string', 'interactsWith entries need with, via, contract')
  return problems
}

export function validateService(svc, ctx) {
  const problems = []
  const at = `service ${svc?.id ?? '(no id)'}`
  const need = (cond, msg) => { if (!cond) problems.push(`${at}: ${msg}`) }
  need(KEBAB.test(svc?.id ?? ''), 'id must be lower-case kebab')
  need(typeof svc?.name === 'string' && svc.name !== '', 'name')
  need(svc?.category in ctx.categories, `unknown category ${svc?.category}`)
  const d = svc?.detect ?? {}
  need((d.files?.length ?? 0) + (d.extensions?.length ?? 0) + (d.paths?.length ?? 0) > 0 || svc?.detectByConfig === true, 'detect needs files, extensions or paths, or detectByConfig: true')
  need(svc?.toolchain?.verify === null || parseVerify(svc?.toolchain?.verify) !== null, `toolchain.verify must be null or "<command> <${[...VERIFY_ARGS].join('|')}>"`)
  need(isStringList(svc?.toolchain?.install), 'toolchain.install')
  need(isStringList(svc?.config?.envVars) && svc.config.envVars.every(name => /^[A-Z][A-Z0-9_]*$/.test(name)), 'config.envVars must be UPPER_SNAKE names only')
  need(isStringList(svc?.setup) && svc.setup.length > 0, 'setup')
  need(typeof svc?.sandbox?.role === 'string', 'sandbox.role')
  need(isStringList(svc?.humanConfirm), 'humanConfirm')
  need(isStringList(svc?.security) && svc.security.length > 0, 'security')
  for (const edge of svc?.interactsWith ?? []) {
    const known = edge.kind === 'service' ? ctx.serviceIds : edge.kind === 'language' ? ctx.languageIds : undefined
    need(known?.has(edge.with), `interactsWith ${edge.kind}:${edge.with} does not resolve`)
  }
  return problems
}

export function walk(root) {
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

function detectIn(items, found) {
  const { files, dirs } = found
  const hits = []
  for (const item of items) {
    const detect = item.detect ?? {}
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
    if (evidence.length > 0) hits.push({ id: item.id, name: item.name, layers: item.layers ?? [item.category], category: item.category, count, evidence })
  }
  return hits.sort((a, b) => b.evidence.length - a.evidence.length || b.count - a.count || a.id.localeCompare(b.id))
}

export function detectLanguages(dest, config = loadLanguages(dest), found = walk(dest)) {
  return detectIn(config.languages, found).map(({ category, ...rest }) => rest)
}

/** API-only services have no files to find and are never auto-detected. */
export function detectServices(dest, services = loadServices(dest), found = walk(dest)) {
  return detectIn(services.services.filter(s => !s.detectByConfig), found).map(({ layers, ...rest }) => rest)
}

/** Rejects `/` and the home directory itself as too broad to be a project. */
export function resolveDest(dest, roots) {
  let real
  try {
    real = fs.realpathSync(path.resolve(dest))
  } catch {
    throw new Error(`not a directory: ${dest}`)
  }
  if (!fs.statSync(real).isDirectory()) throw new Error(`not a directory: ${dest}`)
  if (real === path.parse(real).root || real === fs.realpathSync(os.homedir())) throw new Error(`refusing to use ${real} as a project (too broad); name the project folder`)
  if (roots && !roots.some(root => real === root || real.startsWith(root + path.sep))) {
    throw new Error(`${real} is outside the folders this server may use (${roots.join(', ')})`)
  }
  return real
}

export const lexists = p => { try { fs.lstatSync(p); return true } catch { return false } }

/** Checks the real location, so a symlink cannot lead a write out of `root`. */
export function assertInside(root, target) {
  let probe = target
  while (!lexists(probe)) probe = path.dirname(probe)
  if (fs.lstatSync(probe).isSymbolicLink()) throw new Error(`refusing to write through a symbolic link: ${probe}`)
  const real = fs.realpathSync(probe)
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error(`refusing to write outside the project: ${target}`)
}

function resolveSelected(config, selection, detected) {
  const ids = selection === 'auto' ? detected.map(d => d.id) : Array.isArray(selection) ? selection : selection.split(',').map(s => s.trim()).filter(Boolean)
  const known = new Map(config.languages.map(l => [l.id, l]))
  const unknown = ids.filter(id => !known.has(id))
  if (unknown.length > 0) throw new Error(`unknown language id(s): ${unknown.join(', ')} (run: devops-setup list)`)
  return ids.map(id => known.get(id))
}

function resolveServices(servicesConfig, selection, detected) {
  if (selection === 'none') return []
  const ids = selection === 'auto' ? detected.map(d => d.id) : Array.isArray(selection) ? selection : selection.split(',').map(s => s.trim()).filter(Boolean)
  const known = new Map(servicesConfig.services.map(s => [s.id, s]))
  const unknown = ids.filter(id => !known.has(id))
  if (unknown.length > 0) throw new Error(`unknown service id(s): ${unknown.join(', ')} (run: devops-setup list --services)`)
  return ids.map(id => known.get(id))
}

const bullets = (items, indent = '') => items.map(item => `${indent}- ${item}`).join('\n')
const code = text => '`' + text.replace(/`/g, "'") + '`'

function section(selected, render, empty = '_No language selected. Add rows by hand or re-run with `--lang`._') {
  return selected.length === 0 ? empty : selected.map(render).join('\n\n')
}

const quote = word => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)

/** Builds the sandbox command only; nothing is executed. `shell` is for display. */
export function sandboxArgv(policy, { phase = 'test', image, cmd, worktree, project, engine } = {}) {
  const phaseOverride = policy.phases?.[phase]
  if (!phaseOverride) throw new Error(`unknown sandbox phase "${phase}" (known: ${Object.keys(policy.phases ?? {}).join(', ')})`)
  const p = { ...policy.default, ...phaseOverride }
  if (typeof image !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image)) throw new Error('image must be a plain image reference')
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every(word => typeof word === 'string')) throw new Error('cmd must be a non-empty list of strings')
  const usable = value => typeof value === 'string' && path.isAbsolute(value) && !/[:,\0\n]/.test(value)
  if (!usable(worktree)) throw new Error('worktree must be an absolute path without ":" or ","')
  if (project !== undefined && !usable(project)) throw new Error('project must be an absolute path without ":" or ","')
  const chosen = engine ?? p.engine
  if (!['docker', 'podman'].includes(chosen)) throw new Error('engine must be docker or podman')

  const argv = [chosen, 'run', '--rm', '--init', '--network', p.network]
  if (p.readOnlyRoot) argv.push('--read-only')
  for (const cap of p.capDrop ?? []) argv.push('--cap-drop', cap)
  if (p.noNewPrivileges) argv.push('--security-opt', 'no-new-privileges')
  argv.push('--pids-limit', String(p.pidsLimit), '--memory', p.memory, '--cpus', String(p.cpus), '--user', p.user)
  for (const mount of p.tmpfs ?? []) argv.push('--tmpfs', mount)
  argv.push('-e', 'HOME=/tmp')
  const blocked = (p.env?.blockPatterns ?? []).map(word => word.toUpperCase())
  for (const name of p.env?.pass ?? []) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || blocked.some(word => name.includes(word))) throw new Error(`refusing to pass ${name} into the sandbox`)
    argv.push('-e', name)
  }
  argv.push('-v', `${worktree}:${p.workdir}:${p.mounts?.worktree === 'ro' ? 'ro' : 'rw'}`)
  if (project !== undefined) argv.push('-v', `${project}:/project:ro`)
  argv.push('-w', p.workdir, image, ...cmd)

  const flat = argv.join(' ')
  for (const banned of policy.never ?? []) {
    if (flat.includes(banned)) throw new Error(`sandbox command would contain "${banned}", which the policy forbids`)
  }
  return { argv, shell: argv.map(quote).join(' ') }
}

export function renderSandboxDoc(servicesConfig, selected) {
  const { default: d, phases, never, fallbacks, notes } = servicesConfig.sandboxPolicy
  const lines = [
    '# Sandbox',
    '',
    'Every build, test and scan a seat runs goes through the container below, not the host. Generated from `services.json` (`sandboxPolicy`) and `languages.json` (`sandboxImage`). The MCP server and the installer only *print* these commands; a human or a seat with approval runs them.',
    '',
    '## Defaults',
    '',
    bullets([
      `engine \`${d.engine}\` (fallbacks: ${fallbacks.join(', ')})`,
      `network \`${d.network}\`; read-only root; user \`${d.user}\`; all capabilities dropped; no-new-privileges`,
      `pids ${d.pidsLimit}, memory ${d.memory}, cpus ${d.cpus}; tmpfs ${d.tmpfs.join(', ')}`,
      `worktree mounted \`${d.mounts.worktree}\` at \`${d.workdir}\`, project \`${d.mounts.project}\` at \`/project\``,
      `host environment is not passed through; names containing ${d.env.blockPatterns.join(', ')} are refused even if listed`,
    ]),
    '',
    '## Phases',
    '',
    bullets(Object.entries(phases).map(([name, v]) => `\`${name}\`: network \`${v.network}\`${v.note ? ` — ${v.note}` : ''}`)),
    '',
    '## Never',
    '',
    bullets(never.map(code)),
    '',
    ...notes.map(n => `- ${n}`),
    '',
    '## Per language',
    '',
  ]
  if (selected.length === 0) lines.push('_No language selected._')
  for (const lang of selected) {
    if (!lang.sandboxImage) {
      lines.push(`### ${lang.name}`, '', 'No sandbox image: run on the host only with the human\'s OK, and say so in the report.', '')
      continue
    }
    const test = sandboxArgv(servicesConfig.sandboxPolicy, { phase: 'test', image: lang.sandboxImage, cmd: ['sh', '-c', '<one validate command>'], worktree: '/path/to/worktree' })
    const deps = sandboxArgv(servicesConfig.sandboxPolicy, { phase: 'deps', image: lang.sandboxImage, cmd: ['sh', '-c', '<dependency install command>'], worktree: '/path/to/worktree' })
    lines.push(`### ${lang.name}`, '', `Image: \`${lang.sandboxImage}\`. Pin it by digest in your project before relying on it.`, '', '```text', `# deps (network on)`, deps.shell, '', '# build / test / scan (network off)', test.shell, '```', '')
  }
  return lines.join('\n')
}

export function renderProfile(config, selected, dest, ctx = {}) {
  const now = ctx.now ?? new Date()
  const servicesConfig = ctx.servicesConfig
  const servicesSelected = ctx.services ?? []
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
      if ((s.sast.commands ?? []).length > 0) lines.push(`Local run (set DB and SARIF outside the repository): ${s.sast.commands.map(code).join(' then ')}`)
    } else {
      lines.push('SAST: **none** — review by hand and say so in the report')
    }
    if ((s.sca ?? []).length > 0) lines.push(`Dependencies: ${s.sca.map(code).join(', ')}`)
    if ((s.secrets ?? []).length > 0) lines.push(`Secrets: ${s.secrets.map(code).join(', ')}`)
    if (s.note) lines.push(`Note: ${s.note}`)
    if ((l.sensitiveHints ?? []).length > 0) lines.push(`Sensitive areas: ${l.sensitiveHints.join('; ')}`)
    return `### ${l.name}\n${bullets(lines)}`
  })

  const codeqlNotes = selected.some(l => (l.security?.sast?.commands ?? []).length > 0) && (config.codeqlNotes ?? []).length > 0
    ? `${bullets(config.codeqlNotes)}\n\n` : ''
  const docsBody = section(selected, l => {
    const d = l.docs ?? {}
    const lines = [
      `Doc format: ${d.format ?? '_not set_'}`,
      ...(d.guide ? [`Comment style guide: ${d.guide}`] : []),
      `Line comment marker: ${code(d.lineComment ?? '')}`,
      `Doc check (only if the project publishes API docs): ${d.check ?? '_not set_'}`,
    ]
    return `### ${l.name}\n${bullets(lines)}`
  })
  const docs = config.docsNote ? `${config.docsNote}\n\n${docsBody}` : docsBody
  const presets = Object.entries(config.presets ?? {}).map(([id, p]) => `### Preset \`${id}\` (opt-in)\n${bullets(p.rules)}`).join('\n\n')

  const style = section(selected, l => {
    const rules = [...(l.style ?? [])]
    const optIn = (l.optInStyle ?? []).map(o => `_Opt-in (\`${o.id}\`):_ ${o.rule}`)
    return `### ${l.name}\n${bullets([...rules, ...optIn])}`
  })

  const pairs = []
  for (const l of selected) {
    for (const edge of l.interactsWith ?? []) {
      if (ids.has(edge.with)) pairs.push(`**${l.id} ↔ ${edge.with}** via ${edge.via}. Contract: ${edge.contract}.`)
    }
  }
  const sids = new Set(servicesSelected.map(x => x.id))
  for (const svc of servicesSelected) {
    for (const edge of svc.interactsWith ?? []) {
      if ((edge.kind === 'service' && sids.has(edge.with)) || (edge.kind === 'language' && ids.has(edge.with))) {
        pairs.push(`**${svc.id} ↔ ${edge.with}** via ${edge.via}. Contract: ${edge.contract}.`)
      }
    }
  }
  const interactions = pairs.length === 0
    ? '_No two selected languages or services declare a boundary. See `LANGUAGES.md`, "How the layers interact"._'
    : bullets(pairs) + '\n\nA change that moves one of these contracts is staffed on both sides and validated with both sides\' commands.'

  const notes = section(selected, l => `### ${l.name}\n${bullets(l.setupNotes ?? [])}`)

  const services = servicesSelected.length === 0
    ? '_None selected. Ask the assistant to add one (for example "set up Docker and Ollama"), or see `SERVICES.md`._'
    : servicesSelected.map(svc => {
        const lines = []
        if (svc.toolchain?.verify) lines.push(`Check: ${code(svc.toolchain.verify)}`)
        if ((svc.config?.envVars ?? []).length > 0) lines.push(`Environment variable names (values never go in git, prompts, logs or thought files): ${svc.config.envVars.map(code).join(', ')}`)
        lines.push(...(svc.setup ?? []).map((step, i) => `Setup ${i + 1}: ${step}`))
        if ((svc.humanConfirm ?? []).length > 0) lines.push(`**Only the human runs or approves:** ${svc.humanConfirm.map(code).join('; ')}`)
        lines.push(...(svc.security ?? []).map(rule => `Rule: ${rule}`))
        if (svc.sandbox?.role) lines.push(`Sandbox role: ${svc.sandbox.role}`)
        return `### ${svc.name} (\`${svc.id}\`)\n${bullets(lines)}`
      }).join('\n\n')

  let sandbox = '_Sandbox not generated. Re-run install with the sandbox option on._'
  if (ctx.sandbox && servicesConfig) {
    const d = servicesConfig.sandboxPolicy.default
    sandbox = [
      `Seats run build, test and scan commands in a container (\`${d.engine}\`, network \`${d.network}\`, read-only root, all capabilities dropped, no host secrets) and never on the host. The exact commands per language are in \`.devops/sandbox.md\`.`,
      '',
      selected.length === 0 ? '' : '| Language | Image |\n|----------|-------|\n' + selected.map(l => `| ${l.id} | ${l.sandboxImage ? code(l.sandboxImage) : '_none: host only, with the human\'s OK_'} |`).join('\n'),
    ].join('\n')
  }

  const instructionFiles = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.cursor/rules', 'CONTRIBUTING.md']
    .filter(name => fs.existsSync(path.join(dest, name))).map(code).join(', ') || '_none found_'

  return template
    .replace('{{DATE}}', now.toISOString().slice(0, 10))
    .replace('{{INSTRUCTION_FILES}}', instructionFiles)
    .replace('{{LANGUAGES}}', languages)
    .replace('{{DEPARTMENTS}}', departments)
    .replace('{{VALIDATION}}', validation)
    .replace('{{SECURITY}}', codeqlNotes + security)
    .replace('{{DOCS}}', docs)
    .replace('{{PRESETS}}', presets)
    .replace('{{SERVICES}}', services)
    .replace('{{SANDBOX}}', sandbox)
    .replace('{{STYLE}}', style)
    .replace('{{INTERACTIONS}}', interactions)
    .replace('{{NOTES}}', notes)
}

/** The only place a program is run: what parseVerify accepts, no shell, bare PATH. */
export function checkTool(verify) {
  const argv = parseVerify(verify)
  if (argv === null) return { checked: false, installed: null, reason: 'no version check defined' }
  const ran = spawnSync(argv[0], argv.slice(1), { env: { PATH: process.env.PATH ?? '' }, timeout: 5000, maxBuffer: 65536, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false })
  if (ran.error?.code === 'ENOENT') return { checked: true, installed: false, reason: `${argv[0]} not found on PATH` }
  if (ran.error) return { checked: true, installed: false, reason: ran.error.message }
  const text = `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim().split('\n')[0]?.slice(0, 200) ?? ''
  return { checked: true, installed: ran.status === 0, version: text, reason: ran.status === 0 ? undefined : `exit ${ran.status}` }
}

/** Environment variables are reported by name as set or unset, never by value. */
export function checkToolchain(dest, ids) {
  const config = loadLanguages(dest)
  const services = loadServices(dest)
  const byId = new Map([...config.languages.map(l => [l.id, { kind: 'language', item: l }]), ...services.services.map(s => [s.id, { kind: 'service', item: s }])])
  return ids.map(id => {
    const hit = byId.get(id)
    if (!hit) return { id, error: 'unknown id' }
    const result = { id, kind: hit.kind, ...checkTool(hit.item.toolchain?.verify) }
    if (hit.kind === 'service') result.env = Object.fromEntries((hit.item.config?.envVars ?? []).map(name => [name, process.env[name] !== undefined && process.env[name] !== '' ? 'set' : 'unset']))
    return result
  })
}

export function addLocalLanguage(destInput, entry, { apply = false } = {}) {
  const dest = resolveDest(destInput)
  const config = loadLanguages(dest)
  const services = loadServices(dest)
  const exists = config.languages.some(l => l.id === entry?.id)
  const problems = validateLanguage(entry ?? {}, { layers: config.layers, codeqlLanguages: config.codeqlLanguages }, { partial: exists })
  if (!exists) {
    for (const key of ['name', 'layers', 'detect', 'toolchain', 'validate', 'security', 'sandboxImage', 'docs', 'comments']) if (!(key in (entry ?? {}))) problems.push(`language ${entry?.id}: missing ${key}`)
  }
  const known = new Set([...config.languages.map(l => l.id), entry?.id])
  for (const edge of entry?.interactsWith ?? []) if (!known.has(edge.with)) problems.push(`language ${entry?.id}: interactsWith unknown ${edge.with}`)
  void services
  if (problems.length > 0) return { ok: false, problems, applied: false }
  const target = path.join(dest, '.devops', 'languages.local.json')
  if (apply) {
    assertInside(dest, target)
    const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { languages: [] }
    const list = (current.languages ?? []).filter(l => l.id !== entry.id)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ ...current, languages: [...list, entry] }, null, 2) + '\n')
  }
  return { ok: true, problems: [], applied: apply, file: target, replaced: exists }
}

const GITIGNORE_BEGIN = '# >>> devops-multi-agent-team (managed block; do not edit between the markers)'
const GITIGNORE_END = '# <<< devops-multi-agent-team'
export const THOUGHTS_FINAL = 'devops-skill/thoughts/final'
export const THOUGHTS_NON_FINAL = 'devops-skill/thoughts/non-final'
export const KIT_DIR = 'devops-skill/kit'
const KIT_SERVER = `${KIT_DIR}/mcp/server.mjs`
/** Package parts a plugin needs but a project install does not. */
const KIT_LEAVE_OUT = new Set(['.claude-plugin', '.mcp.json', 'hooks', 'types'])
const OWN_SKILLS = ['devops-multi-agent-team', 'devops-cleanup']
const MODE_LOCAL = '# mode: local-only (nothing the install wrote is committed)'
const MODE_SHARED = '# mode: share-config (.devops/ is committed; tools and copies stay local)'
/** Local artifacts the team writes, ignored in every mode. */
export const GITIGNORE_LINES = ['_scratch/', '*.scratch*', 'codeql-*.sarif', '.codeql-db-*']
const LEGACY_MARKER = '# devops-multi-agent-team'
const LEGACY_LINE = new RegExp(`^${LEGACY_MARKER}\\s*$`, 'm')
const MCP_FILES = { claude: '.mcp.json', cursor: '.cursor/mcp.json', vscode: '.vscode/mcp.json' }
const TEST_FILE = /\.test\.(mjs|js|ts)$/
const TRACKED_SHOWN = 5
const CLAUDE_ROOT = '${CLAUDE_PROJECT_DIR:-.}'
const WORKSPACE = '${workspaceFolder}'
const NOT_GIT = 'not a git repository: the block is in .gitignore; '
  + 'run ensure_gitignore again after git init'

function copyTree(from, to, opts, report) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (opts.skip?.test(entry.name)) continue
    if (entry.isDirectory()) copyTree(source, target, opts, report)
    else if (!entry.isFile()) continue
    else if (opts.transform && entry.name.endsWith('.md')) {
      writeText(target, opts.transform(fs.readFileSync(source, 'utf8')), opts, report)
    } else copyFile(source, target, opts, report)
  }
}

function copyFile(source, target, opts, report) {
  const exists = lexists(target)
  if (exists && fs.readFileSync(source).equals(fs.readFileSync(target))) return report.same.push(target)
  if (exists && !opts.force) return report.skipped.push(target)
  report[exists ? 'replaced' : 'created'].push(target)
  if (opts.dryRun) return
  assertInside(opts.root, target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function writeText(target, text, opts, report) {
  const exists = lexists(target)
  if (exists && fs.readFileSync(target, 'utf8') === text) return report.same.push(target)
  if (exists && !opts.force) return report.skipped.push(target)
  report[exists ? 'replaced' : 'created'].push(target)
  if (opts.dryRun) return
  assertInside(opts.root, target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}

function gitIn(dest, args) {
  const ran = spawnSync('git', args, { cwd: dest, encoding: 'utf8' })
  return ran.status === 0 ? ran.stdout : null
}

/** The repository top level, or null when `dest` is not inside a git repository. */
function gitTop(dest) {
  const out = gitIn(dest, ['rev-parse', '--show-toplevel'])
  return out ? fs.realpathSync(out.trim()) : null
}

/** Paths (relative to `dest`) that git already tracks; an ignore rule does not untrack them. */
function trackedPaths(dest, rels) {
  if (rels.length === 0 || !gitTop(dest)) return []
  const out = gitIn(dest, ['ls-files', '-z', '--', ...rels]) ?? ''
  return [...new Set(out.split('\0').filter(Boolean))]
}

/**
 * Where the managed block goes: .git/info/exclude, which git never commits, so no tracked file changes.
 * Outside a git repository there is nothing to keep out yet, so it falls back to .gitignore.
 */
export function ignoreFile(dest) {
  const top = gitTop(dest)
  if (!top) return { file: path.join(dest, '.gitignore'), local: false, prefix: '' }
  const exclude = gitIn(dest, ['rev-parse', '--git-path', 'info/exclude']).trim()
  const prefix = path.relative(top, fs.realpathSync(dest)).split(path.sep).join('/')
  return { file: path.resolve(dest, exclude), local: true, prefix: prefix ? `/${prefix}` : '' }
}

/** Whether a host file is ours: missing, or the same as the copy the install writes. */
function isOwnCopy(target, expected) {
  return !lexists(target) || fs.readFileSync(target, 'utf8') === expected
}

const scriptPaths = text => text.replace(/\bnode scripts\//g, `node ${KIT_DIR}/scripts/`)

function cursorRule(name, body) {
  const description = body.split('\n')[0].replace(/^#\s*/, '')
  return `---\ndescription: ${description}\nglobs:\n  - "**/*"\nalwaysApply: true\n---\n\n${body}`
}

/** The agents, commands and rules the install writes into one host folder, with their text. */
function hostFiles(host) {
  const files = []
  for (const dir of ['agents', 'commands']) {
    const names = fs.readdirSync(path.join(PACKAGE_ROOT, dir)).filter(f => f.endsWith('.md'))
    for (const name of names) {
      const text = scriptPaths(fs.readFileSync(path.join(PACKAGE_ROOT, dir, name), 'utf8'))
      files.push({ rel: `${host}/${dir}/${name}`, text })
    }
  }
  const rules = fs.readdirSync(path.join(PACKAGE_ROOT, 'rules')).filter(f => f.endsWith('.md'))
  for (const rule of rules) {
    const body = fs.readFileSync(path.join(PACKAGE_ROOT, 'rules', rule), 'utf8')
    const name = rule.replace(/\.md$/, '')
    const rel = host === '.cursor' ? `${host}/rules/${name}.mdc` : `${host}/rules/${rule}`
    files.push({ rel, text: host === '.cursor' ? cursorRule(name, body) : body })
  }
  return files
}

/** Every path the install owns in this project, relative to it; a user's own same-named file is left out. */
function ownedPaths(dest, { shareConfig }) {
  const owned = ['devops-skill/', ...(shareConfig ? [] : ['.devops/'])]
  for (const host of ['.claude', '.cursor'].filter(h => lexists(path.join(dest, h)))) {
    owned.push(...OWN_SKILLS.map(skill => `${host}/skills/${skill}/`))
    const own = hostFiles(host).filter(f => isOwnCopy(path.join(dest, f.rel), f.text))
    owned.push(...own.map(f => f.rel))
  }
  for (const rel of Object.values(MCP_FILES)) {
    const target = path.join(dest, rel)
    if (!lexists(target) || trackedPaths(dest, [rel]).length > 0) continue
    const text = fs.readFileSync(target, 'utf8')
    if (text.includes(KIT_SERVER) || text.includes(NPX_PACKAGE)) owned.push(rel)
  }
  return owned
}

/** One block per project folder, so projects that share a repository keep their own blocks. */
const beginFor = prefix => (prefix ? `${GITIGNORE_BEGIN} [${prefix}]` : GITIGNORE_BEGIN)

/**
 * This project's block in `text`, as line numbers: its own markers, or a block from before blocks
 * named their folder whose first path is this project's. `any` takes the first block of either kind.
 */
function findBlock(text, prefix, { any = false } = {}) {
  const lines = text.split('\n')
  for (let start = 0; start < lines.length; start++) {
    const unnamed = lines[start] === GITIGNORE_BEGIN
    const named = lines[start].startsWith(GITIGNORE_BEGIN)
    if (!named) continue
    const end = lines.indexOf(GITIGNORE_END, start + 1)
    if (end === -1) return null
    const body = lines.slice(start + 1, end)
    const firstPath = body.find(line => line.startsWith('/'))
    const oldStyleMine = unnamed && (!prefix || firstPath === `${prefix}/devops-skill/`)
    if (any || lines[start] === beginFor(prefix) || oldStyleMine) return { lines, start, end, body }
    start = end
  }
  return null
}

function modeOf(text, prefix, options) {
  const body = findBlock(text, prefix, options)?.body ?? []
  if (body.includes(MODE_SHARED)) return true
  if (body.includes(MODE_LOCAL)) return false
  return undefined
}

function managedBlock(owned, { prefix, shareConfig }) {
  const anchored = owned.map(rel => `${prefix}/${rel}`)
  const lines = [shareConfig ? MODE_SHARED : MODE_LOCAL, ...anchored, ...GITIGNORE_LINES]
  return [beginFor(prefix), ...lines, GITIGNORE_END].join('\n')
}

/** `text` with this project's managed block (and the oldest marker style) taken out. */
function withoutBlock(text, prefix, options) {
  const found = findBlock(text, prefix, options)
  const before = found?.lines.slice(0, found.start)
  const outside = found && [...before, ...found.lines.slice(found.end + 1)]
  let rest = outside ? outside.join('\n') : text
  const legacy = rest.search(LEGACY_LINE)
  if (legacy !== -1) {
    const blank = rest.indexOf('\n\n', legacy)
    rest = rest.slice(0, legacy) + (blank === -1 ? '' : rest.slice(blank + 2))
  }
  const kept = rest.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '')
  return kept ? `${kept}\n` : ''
}

function writeIgnore(target, next, current, { opts, report }) {
  if (next === current) return report.same.push(target)
  report[current ? 'replaced' : 'created'].push(target)
  if (opts.dryRun) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, next)
}

/** The project's .gitignore, where an install made before `git init` kept its block. */
const oldGitignore = root => {
  const file = path.join(root, '.gitignore')
  return lexists(file) ? fs.readFileSync(file, 'utf8') : ''
}

/** An earlier install put the block in the tracked .gitignore; take it out so the project file is clean. */
function migrateGitignore(root, opts, report) {
  const target = path.join(root, '.gitignore')
  if (!lexists(target)) return
  const current = fs.readFileSync(target, 'utf8')
  const legacy = LEGACY_LINE.test(current)
  if (!current.includes(GITIGNORE_BEGIN) && !legacy) return
  assertInside(root, target)
  writeIgnore(target, withoutBlock(current, '', { any: true }), current, { opts, report })
  report.warnings.push('removed the old devops-multi-agent-team block from .gitignore; commit it')
}

function warnTracked(root, owned, report) {
  const tracked = trackedPaths(root, owned.map(rel => rel.replace(/\/$/, '')))
  if (tracked.length === 0) return
  const more = tracked.length - TRACKED_SHOWN
  const list = tracked.slice(0, TRACKED_SHOWN).join(', ') + (more > 0 ? `, and ${more} more` : '')
  const paths = owned.map(rel => `'${rel.replace(/\/$/, '')}'`).join(' ')
  report.warnings.push(`git already tracks files kept local (${list}); ignoring does not untrack`)
  report.commands.push(`git rm -r --cached --ignore-unmatch -- ${paths}  # then commit; files stay`)
}

/**
 * Keep everything the install owns out of git: the tools (devops-skill/), the copies in .claude/ and
 * .cursor/, the MCP config files it created and, unless `shareConfig`, .devops/. Written to
 * .git/info/exclude, so the project's tracked files (its .gitignore included) do not change.
 */
export function ensureGitignore(root, opts, report) {
  report.commands ??= []
  const where = ignoreFile(root)
  const current = lexists(where.file) ? fs.readFileSync(where.file, 'utf8') : ''
  const shareConfig = opts.shareConfig ?? modeOf(current, where.prefix)
    ?? (where.local ? modeOf(oldGitignore(root), '', { any: true }) : undefined) ?? false
  const owned = ownedPaths(root, { shareConfig })
  const block = managedBlock(owned, { prefix: where.prefix, shareConfig })
  const base = withoutBlock(current, where.prefix)
  const next = `${base}${base ? '\n' : ''}${block}\n`
  if (!where.local) assertInside(root, where.file)
  writeIgnore(where.file, next, current, { opts, report })
  if (where.local) migrateGitignore(root, opts, report)
  else report.warnings.push(NOT_GIT)
  warnTracked(root, owned, report)
}

export function gitignoreOk(root) {
  const { file, prefix } = ignoreFile(root)
  if (!lexists(file)) return false
  return modeOf(fs.readFileSync(file, 'utf8'), prefix) !== undefined
}

/**
 * Copy the tools the project runs (MCP server, scripts, data) into devops-skill/kit/, so the project
 * needs nothing outside its own folder. The kit is never edited by hand, so it is always replaced.
 */
function installKit(dest, opts) {
  const kit = path.join(dest, KIT_DIR)
  const kitReport = { created: [], replaced: [], skipped: [], same: [] }
  const kitPath = lexists(kit) ? fs.realpathSync(kit) : kit
  if (fs.realpathSync(PACKAGE_ROOT) === kitPath) return kitReport
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  for (const entry of ['package.json', ...pkg.files.filter(f => !KIT_LEAVE_OUT.has(f))]) {
    const source = path.join(PACKAGE_ROOT, entry)
    if (!lexists(source)) continue
    const target = path.join(kit, entry)
    const kitOpts = { ...opts, force: true, skip: TEST_FILE }
    if (fs.statSync(source).isDirectory()) copyTree(source, target, kitOpts, kitReport)
    else copyFile(source, target, kitOpts, kitReport)
  }
  return kitReport
}

const kitSummary = kitReport => ({
  dir: KIT_DIR,
  files: kitReport.created.length + kitReport.replaced.length + kitReport.same.length,
  changed: kitReport.created.length + kitReport.replaced.length,
})

function copyToHosts(dest, hosts, { opts, report, skipRules }) {
  const skipped = file => skipRules.some(rule => file.rel.includes(`/rules/${rule}.`))
  for (const host of hosts) {
    for (const skill of fs.readdirSync(path.join(PACKAGE_ROOT, 'skills'))) {
      const to = path.join(dest, host, 'skills', skill)
      const withKitPaths = { ...opts, transform: scriptPaths }
      copyTree(path.join(PACKAGE_ROOT, 'skills', skill), to, withKitPaths, report)
    }
    for (const file of hostFiles(host).filter(f => !skipped(f))) {
      writeText(path.join(dest, file.rel), file.text, opts, report)
    }
  }
}

const CODE_MIN = 2
const CODE_MAX = 4

/** An empty story catalog whose project code comes from the folder name's initials. */
function storyCatalog(dest, selected) {
  const name = path.basename(dest)
  const initials = name.match(/[A-Z]|(?<=[-_ ])[a-z]|^[a-z]/g) ?? [name[0] ?? 'X']
  const code = initials.join('').toUpperCase().slice(0, CODE_MAX).padEnd(CODE_MIN, 'X')
  const baseline = { branch: 'main', sha: '' }
  const project = { code, name, language: selected[0]?.name ?? '', baseline }
  return { schemaVersion: 1, project, projects: {}, stories: [] }
}

/** The project's own files in .devops/: profile, sandbox doc, standards, local languages, stories. */
function writeProjectData(dest, choice, { opts, report }) {
  const { config, selected, servicesConfig, services, sandbox } = choice
  const keep = { ...opts, force: false }
  const devops = rel => path.join(dest, '.devops', rel)
  writeText(devops('languages.local.json'), '{\n  "languages": []\n}\n', keep, report)
  writeText(devops('standards.json'), '{\n  "schemaVersion": 1\n}\n', keep, report)
  const profile = renderProfile(config, selected, dest, { servicesConfig, services, sandbox })
  writeText(devops('project.md'), profile, opts, report)
  if (sandbox) {
    writeText(devops('sandbox.md'), renderSandboxDoc(servicesConfig, selected), opts, report)
  }
  const catalog = `${JSON.stringify(storyCatalog(dest, selected), null, 2)}\n`
  writeText(devops('stories/catalog.json'), catalog, keep, report)
}

function makeThoughtDirs(dest, { opts, report }) {
  for (const dir of [THOUGHTS_NON_FINAL, THOUGHTS_FINAL]) {
    const target = path.join(dest, dir)
    if (lexists(target)) continue
    report.created.push(target)
    if (opts.dryRun) continue
    assertInside(dest, target)
    fs.mkdirSync(target, { recursive: true })
  }
}

/**
 * Install the team into a project: copies into the host folders, the tools in devops-skill/kit/, the
 * project's .devops/ files and the thought folders, all kept out of git by the managed ignore block.
 */
export function install(options) {
  const { dest: destInput, roots, target = 'auto', lang = 'auto', services = 'auto' } = options
  const { sandbox = true, skipRules = [], force = false, dryRun = false, shareConfig } = options
  const { kit = true } = options
  const dest = resolveDest(destInput, roots)
  const report = {
    dest, created: [], replaced: [], skipped: [], same: [], warnings: [], commands: [],
    languages: [], services: [], dryRun,
  }
  const opts = { force, dryRun, root: dest }
  const config = loadLanguages(dest)
  const servicesConfig = loadServices(dest)
  const found = walk(dest)
  const selected = resolveSelected(config, lang, detectLanguages(dest, config, found))
  const detected = detectServices(dest, servicesConfig, found)
  const chosen = resolveServices(servicesConfig, services, detected)
  report.languages = selected.map(l => l.id)
  report.services = chosen.map(s => s.id)
  const hosts = hostFolders(dest, target)
  if (!hosts) throw new Error(`--target must be auto, cursor, claude, both or none (got ${target})`)
  const io = { opts, report }
  copyToHosts(dest, hosts, { ...io, skipRules })
  if (kit) report.kit = kitSummary(installKit(dest, opts))
  writeProjectData(dest, { config, selected, servicesConfig, services: chosen, sandbox }, io)
  makeThoughtDirs(dest, io)
  ensureGitignore(dest, { ...opts, shareConfig }, report)
  return report
}

/** `auto` installs into the host folders the project already has, else both. */
export function hostFolders(dest, target) {
  if (target === 'auto') {
    const has = ['.cursor', '.claude'].filter(host => lexists(path.join(dest, host)))
    return has.length > 0 ? has : ['.cursor', '.claude']
  }
  const both = ['.cursor', '.claude']
  const choices = { cursor: ['.cursor'], claude: ['.claude'], both, none: [] }
  return choices[target]
}

const SERVER_NAME = 'devops-multi-agent-team'
const NPX_PACKAGE = 'github:BPForbes/Devops-Multi-Agent-Team-Skill'
const NPX_SPEC = ['-y', '-p', NPX_PACKAGE, 'devops-multi-agent-team-mcp']

/**
 * The server entry for one client. It starts the project's own copy (devops-skill/kit/) by a path
 * relative to the project, so the config works on any machine and in any clone.
 */
function serverFor(client, { npx, dest }) {
  if (npx) return { command: 'npx', args: NPX_SPEC, env: { DEVOPS_MCP_ROOTS: dest } }
  if (client === 'claude') return { command: 'node', args: [`${CLAUDE_ROOT}/${KIT_SERVER}`] }
  const env = { DEVOPS_MCP_ROOTS: WORKSPACE }
  return { command: 'node', args: [`${WORKSPACE}/${KIT_SERVER}`], env }
}

/** How to connect without touching a config file that git tracks: a user-level or local-scope entry. */
function localAlternative(client, { dest, npx }) {
  const server = npx
    ? { command: 'npx', args: NPX_SPEC, env: { DEVOPS_MCP_ROOTS: dest } }
    : { command: 'node', args: [path.join(dest, KIT_SERVER)] }
  if (client === 'claude') {
    const env = npx ? ['-e', `DEVOPS_MCP_ROOTS=${dest}`] : []
    const words = ['claude', 'mcp', 'add', SERVER_NAME, '--scope', 'local', ...env, '--']
    return [...words, server.command, ...server.args].map(quote).join(' ')
  }
  const entry = JSON.stringify({ [SERVER_NAME]: server })
  const where = client === 'cursor'
    ? '~/.cursor/mcp.json under "mcpServers"'
    : 'your VS Code user mcp.json under "servers"'
  return `add ${entry} to ${where}`
}

function readConfig(target, rel) {
  if (!lexists(target)) return {}
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch {
    throw new Error(`${rel} is not valid JSON; fix or remove it, nothing was changed`)
  }
}

function connectOne(client, { dest, npx, dryRun, report }) {
  const rel = MCP_FILES[client]
  const key = client === 'vscode' ? 'servers' : 'mcpServers'
  const target = path.join(dest, rel)
  if (client === 'claude' && dest === fs.realpathSync(PACKAGE_ROOT)) {
    const why = "this is the package's own file; it already starts the server from this folder"
    return report.skipped.push(`${rel}: ${why}`)
  }
  if (trackedPaths(dest, [rel]).length > 0) {
    report.skipped.push(`${rel}: git tracks it, and editing it would commit the server`)
    return report.commands.push(localAlternative(client, { dest, npx }))
  }
  const config = readConfig(target, rel)
  const server = serverFor(client, { npx, dest })
  const entry = client === 'vscode' ? { type: 'stdio', ...server } : server
  const next = { ...config, [key]: { ...(config[key] ?? {}), [SERVER_NAME]: entry } }
  const same = JSON.stringify(config[key]?.[SERVER_NAME]) === JSON.stringify(entry)
  report[same ? 'kept' : 'written'].push(target)
  if (same || dryRun) return
  assertInside(dest, target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n')
}

/**
 * Connect the MCP server for each client in the project's own config files, keeping every other server
 * listed there. A config file git tracks is left alone and a local alternative is printed instead.
 */
export function connectClients({ dest: destInput, clients = 'auto', npx = false, dryRun = false }) {
  const dest = resolveDest(destInput)
  const hosts = hostFolders(dest, 'auto').map(h => (h === '.cursor' ? 'cursor' : 'claude'))
  const wanted = clients === 'auto' ? hosts : clients.split(',').map(c => c.trim()).filter(Boolean)
  const unknown = wanted.filter(c => !MCP_FILES[c])
  if (unknown.length > 0) {
    throw new Error(`unknown client(s): ${unknown.join(', ')} (claude, cursor, vscode)`)
  }
  const report = { dest, written: [], kept: [], skipped: [], commands: [], warnings: [], same: [] }
  const opts = { dryRun, root: dest }
  if (!npx) report.kit = kitSummary(installKit(dest, opts))
  for (const client of wanted) connectOne(client, { dest, npx, dryRun, report })
  const ignoreReport = { created: [], replaced: [], same: [], warnings: [], commands: [] }
  ensureGitignore(dest, opts, ignoreReport)
  report.ignore = [...ignoreReport.created, ...ignoreReport.replaced]
  report.warnings.push(...ignoreReport.warnings)
  report.commands.push(...ignoreReport.commands)
  return report
}

/** One step: install the skill (host folders auto-detected) and connect the MCP server. */
/**
 * One step: install and connect. With `plugin` (the editor has this plugin installed) the plugin
 * already supplies the skill, agents, commands and MCP server, so only the project's own files are
 * written: .devops/, the thought folders and the local ignore block.
 */
export function initProject(options) {
  if (options.plugin) {
    const installed = install({ ...options, target: 'none', kit: false })
    const skipped = ['the Claude Code plugin provides the MCP server']
    return { installed, connected: { written: [], kept: [], skipped, commands: [], warnings: [] } }
  }
  const installed = install({ ...options, target: options.target ?? 'auto' })
  const { dest, clients = 'auto', npx, dryRun } = options
  return { installed, connected: connectClients({ dest, clients, npx, dryRun }) }
}

const ID_COLUMN = 14
const KIND_COLUMN = 22
const NEXT_STEP = [
  'Next: restart or reload the client, then say "set up the DevOps team in this project".',
  'Fill in .devops/project.md. Nothing needs committing',
  '(with --share-config, commit .devops/ only).',
].join(' ')

function printConnection({ installed, connected }) {
  if (installed) {
    const { created, replaced, skipped } = installed
    const languages = installed.languages.join(', ') || '(none)'
    const counts = `${created.length} created, ${replaced.length} replaced, ${skipped.length} kept`
    console.log(`Installed: ${counts}. Languages: ${languages}`)
  }
  const lines = [
    ...connected.written.map(f => `MCP server written: ${f}`),
    ...connected.kept.map(f => `MCP server already set: ${f}`),
    ...connected.skipped.map(s => `Skipped: ${s}`),
    ...connected.commands.map(c => `Run instead: ${c}`),
    ...connected.warnings.map(w => `warning: ${w}`),
  ]
  for (const line of [...lines, NEXT_STEP]) console.log(line)
}

export function status(destInput, roots) {
  const dest = resolveDest(destInput, roots)
  const has = rel => lexists(path.join(dest, rel))
  const skill = 'skills/devops-multi-agent-team/SKILL.md'
  return {
    dest,
    cursor: has(`.cursor/${skill}`),
    claude: has(`.claude/${skill}`),
    profile: has('.devops/project.md'),
    sandboxDoc: has('.devops/sandbox.md'),
    kit: has(KIT_SERVER),
    thoughtsDirs: has(THOUGHTS_NON_FINAL) && has(THOUGHTS_FINAL),
    gitignoreOk: gitignoreOk(dest),
    ignoreFile: path.relative(dest, ignoreFile(dest).file) || ignoreFile(dest).file,
    detectedLanguages: detectLanguages(dest).map(d => d.id),
    detectedServices: detectServices(dest).map(d => d.id),
  }
}

function parseArgs(argv) {
  const args = { _: [], dest: process.cwd(), target: 'auto', clients: 'auto', npx: false, lang: 'auto', services: 'auto', phase: 'test', sandbox: true, force: false, dryRun: false, json: false, withServices: false, image: undefined }
  const rest = argv.indexOf('--')
  const own = rest === -1 ? argv : argv.slice(0, rest)
  args.cmd = rest === -1 ? [] : argv.slice(rest + 1)
  for (let i = 0; i < own.length; i++) {
    const a = own[i]
    if (a === '--dest') args.dest = path.resolve(own[++i])
    else if (a === '--target') args.target = own[++i]
    else if (a === '--lang') args.lang = own[++i]
    else if (a === '--services') args.services = own[++i]
    else if (a === '--phase') args.phase = own[++i]
    else if (a === '--client') args.clients = own[++i]
    else if (a === '--npx') args.npx = true
    else if (a === '--share-config') args.shareConfig = true
    else if (a === '--plugin') args.plugin = true
    else if (a === '--skip-rules') args.skipRules = own[++i].split(',').filter(Boolean)
    else if (a === '--no-sandbox') args.sandbox = false
    else if (a === '--force') args.force = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--with-services') args.withServices = true
    else if (a === '-h' || a === '--help') args._.unshift('help')
    else args._.push(a)
  }
  return args
}

const HELP = `devops-setup <command> [options]

  list [--with-services]     print the languages (and services) this package knows
  detect                     print the languages and services found under --dest
  profile                    print the .devops/project.md the installer would write
  init                       install (host folders auto-detected) AND connect the MCP server, in one step
  install                    copy the skill, agents, commands, profile and sandbox doc into --dest,
                             and the tools into devops-skill/kit/; all kept out of git locally
  connect                    point .mcp.json, .cursor/mcp.json, .vscode/mcp.json at the kit
                             (--client claude,cursor,vscode); a config file git tracks is left alone
  status                     what is installed in --dest
  check <id,id,...>          is the tool for each language/service id installed? (runs only "<tool> --version")
  sandbox --lang ID [--phase deps|build|test|scan|browser] -- <cmd...>
                             print the sandboxed container command (runs nothing)

options: --dest DIR (default: cwd)  --target auto|cursor|claude|both (default auto)
         --lang auto|id,id (default auto)  --services auto|none|id,id (default auto)
         --skip-rules name,name (do not install those rule files; use when the project already has an equivalent)
         --share-config (commit .devops/ so the team shares the profile and standards;
                         default: nothing the install writes is committed)
         --plugin (Claude Code with the plugin installed: write only .devops/ and the ignore block)
         --no-sandbox  --force  --dry-run  --json
`

const row = (id, kind, detail) => `${id.padEnd(ID_COLUMN)} ${kind.padEnd(KIND_COLUMN)} ${detail}`

function listCommand(args, config) {
  for (const l of config.languages) console.log(row(l.id, l.layers.join(','), l.name))
  if (!args.withServices) return
  for (const s of loadServices(args.dest).services) console.log(row(s.id, s.category, s.name))
}

function detectCommand(args, config) {
  const languages = detectLanguages(args.dest, config)
  const found = { languages, services: detectServices(args.dest) }
  if (args.json) return console.log(JSON.stringify(args.withServices ? found : found.languages))
  if (found.languages.length === 0) console.log('No known language found.')
  for (const f of found.languages) console.log(row(f.id, f.layers.join(','), f.evidence.join('; ')))
  for (const f of found.services) console.log(row(f.id, 'service', f.evidence.join('; ')))
}

function profileCommand(args, config) {
  const servicesConfig = loadServices(args.dest)
  const selected = resolveSelected(config, args.lang, detectLanguages(args.dest, config))
  const detected = detectServices(args.dest, servicesConfig)
  const services = resolveServices(servicesConfig, args.services, detected)
  const options = { servicesConfig, services, sandbox: args.sandbox }
  console.log(renderProfile(config, selected, args.dest, options))
}

function installCommand(args) {
  const report = install(args)
  if (args.json) return console.log(JSON.stringify(report))
  const verb = args.dryRun ? 'would be' : 'were'
  const languages = report.languages.join(', ') || '(none)'
  console.log(`Languages: ${languages}   Services: ${report.services.join(', ') || '(none)'}`)
  for (const key of ['created', 'replaced', 'skipped']) {
    const why = key === 'skipped' ? ' (exist and differ; use --force)' : ''
    if (report[key].length > 0) console.log(`${report[key].length} file(s) ${verb} ${key}${why}`)
  }
  for (const w of report.warnings) console.log(`warning: ${w}`)
  console.log('Next: open .devops/project.md and fill the "Fill in by hand" section.')
}

function connectCommand(args) {
  const out = args._[0] === 'init' ? initProject(args) : { connected: connectClients(args) }
  return args.json ? console.log(JSON.stringify(out)) : printConnection(out)
}

function sandboxCommand(args, config) {
  const [id] = args.lang.split(',')
  const lang = config.languages.find(l => l.id === id)
  if (!lang) throw new Error(`unknown language id: ${id}`)
  if (!lang.sandboxImage) {
    throw new Error(`${id} has no sandbox image; run on the host only with the human's OK`)
  }
  const policy = loadServices(args.dest).sandboxPolicy
  const run = { phase: args.phase, image: lang.sandboxImage, cmd: args.cmd }
  const out = sandboxArgv(policy, { ...run, worktree: resolveDest(args.dest) })
  console.log(args.json ? JSON.stringify(out) : out.shell)
}

const toJson = value => console.log(JSON.stringify(value, null, 2))
const COMMANDS = {
  list: listCommand,
  detect: detectCommand,
  profile: profileCommand,
  install: installCommand,
  init: connectCommand,
  connect: connectCommand,
  status: args => toJson(status(args.dest)),
  check: args => toJson(checkToolchain(args.dest, (args._[1] ?? '').split(',').filter(Boolean))),
  sandbox: sandboxCommand,
}

function main(argv) {
  const args = parseArgs(argv)
  const command = args._[0] ?? 'help'
  if (command === 'help') return console.log(HELP)
  const run = COMMANDS[command]
  if (run) return run(args, loadLanguages(args.dest))
  console.error(`unknown command: ${command}\n\n${HELP}`)
  process.exitCode = 2
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-setup: ${error.message}`)
    process.exitCode = 1
  }
}
