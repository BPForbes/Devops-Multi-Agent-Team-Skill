#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string')

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
  if (has('docs')) need(typeof lang.docs?.format === 'string' && typeof lang.docs?.lineComment === 'string' && typeof lang.docs?.check === 'string', 'docs needs format, lineComment and check (see LANGUAGES.md)')
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
    return `### ${l.name}\n${bullets([`Doc format: ${d.format ?? '_not set_'}`, `Line comment marker: ${code(d.lineComment ?? '')}`, `Doc check (only if the project publishes API docs): ${d.check ?? '_not set_'}`])}`
  })
  const docs = config.docsNote ? `${config.docsNote}\n\n${docsBody}` : docsBody
  const presets = Object.entries(config.presets ?? {}).map(([id, p]) => `### Preset \`${id}\` (opt-in, from ${p.from})\n${bullets(p.rules)}`).join('\n\n')

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
    for (const key of ['name', 'layers', 'detect', 'toolchain', 'validate', 'security', 'sandboxImage', 'docs']) if (!(key in (entry ?? {}))) problems.push(`language ${entry?.id}: missing ${key}`)
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
export const GITIGNORE_LINES = [
  '.devops/thoughts/*',
  '!.devops/thoughts/non-finalized/',
  '.devops/thoughts/non-finalized/*',
  '!.devops/thoughts/non-finalized/.gitkeep',
  '_scratch/',
  '*.scratch*',
  'codeql-*.sarif',
  '.codeql-db-*',
]
const GITIGNORE_BLOCK = [GITIGNORE_BEGIN, ...GITIGNORE_LINES, GITIGNORE_END].join('\n')
const LEGACY_MARKER = '# devops-multi-agent-team'

function copyTree(from, to, opts, report) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target, opts, report)
    else if (entry.isFile()) copyFile(source, target, opts, report)
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

export function ensureGitignore(root, opts, report) {
  const target = path.join(root, '.gitignore')
  const current = lexists(target) ? fs.readFileSync(target, 'utf8') : ''
  const begin = current.indexOf(GITIGNORE_BEGIN)
  const end = current.indexOf(GITIGNORE_END)
  let next
  if (begin !== -1 && end > begin) {
    next = current.slice(0, begin) + GITIGNORE_BLOCK + current.slice(end + GITIGNORE_END.length)
  } else {
    let base = current
    const legacy = base.search(new RegExp(`^${LEGACY_MARKER}\\s*$`, 'm'))
    if (legacy !== -1) {
      const blank = base.indexOf('\n\n', legacy)
      base = base.slice(0, legacy) + (blank === -1 ? '' : base.slice(blank + 2))
    }
    next = base + (base && !base.endsWith('\n') ? '\n' : '') + (base ? '\n' : '') + GITIGNORE_BLOCK + '\n'
  }
  const outside = next.replace(GITIGNORE_BLOCK, '')
  if (/^\/?\.devops\/?\*?\s*$/m.test(outside)) {
    report.warnings.push('.gitignore has another rule that ignores .devops/, which would also hide the committed profile .devops/project.md; remove it')
  }
  if (next === current) return report.same.push(target)
  report[current ? 'replaced' : 'created'].push(target)
  if (opts.dryRun) return
  assertInside(root, target)
  fs.writeFileSync(target, next)
}

export function gitignoreOk(root) {
  const target = path.join(root, '.gitignore')
  if (!lexists(target)) return false
  return fs.readFileSync(target, 'utf8').includes(GITIGNORE_BLOCK)
}

export function install({ dest: destInput, roots, target = 'both', lang = 'auto', services = 'auto', sandbox = true, skipRules = [], force = false, dryRun = false }) {
  const dest = resolveDest(destInput, roots)
  const report = { dest, created: [], replaced: [], skipped: [], same: [], warnings: [], languages: [], services: [], dryRun }
  const opts = { force, dryRun, root: dest }
  const config = loadLanguages(dest)
  const servicesConfig = loadServices(dest)
  const found = walk(dest)
  const selected = resolveSelected(config, lang, detectLanguages(dest, config, found))
  const chosenServices = resolveServices(servicesConfig, services, detectServices(dest, servicesConfig, found))
  report.languages = selected.map(l => l.id)
  report.services = chosenServices.map(s => s.id)

  const hosts = { cursor: ['.cursor'], claude: ['.claude'], both: ['.cursor', '.claude'] }[target]
  if (!hosts) throw new Error(`--target must be cursor, claude or both (got ${target})`)
  for (const host of hosts) {
    copyTree(path.join(PACKAGE_ROOT, 'skills', 'devops-multi-agent-team'), path.join(dest, host, 'skills', 'devops-multi-agent-team'), opts, report)
    copyTree(path.join(PACKAGE_ROOT, 'agents'), path.join(dest, host, 'agents'), opts, report)
    copyTree(path.join(PACKAGE_ROOT, 'commands'), path.join(dest, host, 'commands'), opts, report)
  }
  for (const host of hosts) {
    for (const rule of fs.readdirSync(path.join(PACKAGE_ROOT, 'rules')).filter(f => f.endsWith('.md'))) {
      const body = fs.readFileSync(path.join(PACKAGE_ROOT, 'rules', rule), 'utf8')
      const name = rule.replace(/\.md$/, '')
      if (skipRules.includes(name)) continue
      if (host === '.cursor') writeText(path.join(dest, host, 'rules', `${name}.mdc`), `---\ndescription: ${body.split('\n')[0].replace(/^#\s*/, '')}\nglobs:\n  - "**/*"\nalwaysApply: true\n---\n\n${body}`, opts, report)
      else writeText(path.join(dest, host, 'rules', rule), body, opts, report)
    }
  }
  for (const name of ['languages.json', 'services.json', 'LANGUAGES.md', 'SERVICES.md']) {
    copyFile(path.join(PACKAGE_ROOT, name), path.join(dest, '.devops', name), opts, report)
  }
  writeText(path.join(dest, '.devops', 'languages.local.json'), '{\n  "languages": []\n}\n', { ...opts, force: false }, report)
  writeText(path.join(dest, '.devops', 'project.md'), renderProfile(config, selected, dest, { servicesConfig, services: chosenServices, sandbox }), opts, report)
  if (sandbox) writeText(path.join(dest, '.devops', 'sandbox.md'), renderSandboxDoc(servicesConfig, selected), opts, report)
  writeText(path.join(dest, '.devops', 'thoughts', 'non-finalized', '.gitkeep'), '', { ...opts, force: false }, report)
  ensureGitignore(dest, opts, report)
  return report
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
    languageData: has('.devops/languages.json'),
    thoughtsKeepFile: has('.devops/thoughts/non-finalized/.gitkeep'),
    gitignoreOk: gitignoreOk(dest),
    detectedLanguages: detectLanguages(dest).map(d => d.id),
    detectedServices: detectServices(dest).map(d => d.id),
  }
}

function parseArgs(argv) {
  const args = { _: [], dest: process.cwd(), target: 'both', lang: 'auto', services: 'auto', phase: 'test', sandbox: true, force: false, dryRun: false, json: false, withServices: false, image: undefined }
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
  install                    copy the skill, agents, commands, profile and sandbox doc into --dest
  status                     what is installed in --dest
  check <id,id,...>          is the tool for each language/service id installed? (runs only "<tool> --version")
  sandbox --lang ID [--phase deps|build|test|scan|browser] -- <cmd...>
                             print the sandboxed container command (runs nothing)

options: --dest DIR (default: cwd)  --target cursor|claude|both (default both)
         --lang auto|id,id (default auto)  --services auto|none|id,id (default auto)
         --skip-rules name,name (do not install those rule files; use when the project already has an equivalent)
         --no-sandbox  --force  --dry-run  --json
`

function main(argv) {
  const args = parseArgs(argv)
  const command = args._[0] ?? 'help'
  if (command === 'help') return console.log(HELP)
  const config = loadLanguages(args.dest)
  if (command === 'list') {
    for (const l of config.languages) console.log(`${l.id.padEnd(14)} ${l.layers.join(',').padEnd(22)} ${l.name}`)
    if (args.withServices) for (const s of loadServices(args.dest).services) console.log(`${s.id.padEnd(14)} ${s.category.padEnd(22)} ${s.name}`)
    return
  }
  if (command === 'detect') {
    const found = { languages: detectLanguages(args.dest, config), services: detectServices(args.dest) }
    if (args.json) return console.log(JSON.stringify(args.withServices ? found : found.languages))
    if (found.languages.length === 0) console.log('No known language found.')
    for (const f of found.languages) console.log(`${f.id.padEnd(14)} ${f.layers.join(',').padEnd(22)} ${f.evidence.join('; ')}`)
    for (const f of found.services) console.log(`${f.id.padEnd(14)} ${'service'.padEnd(22)} ${f.evidence.join('; ')}`)
    return
  }
  if (command === 'profile') {
    const servicesConfig = loadServices(args.dest)
    const selected = resolveSelected(config, args.lang, detectLanguages(args.dest, config))
    const chosen = resolveServices(servicesConfig, args.services, detectServices(args.dest, servicesConfig))
    return console.log(renderProfile(config, selected, args.dest, { servicesConfig, services: chosen, sandbox: args.sandbox }))
  }
  if (command === 'install') {
    const report = install(args)
    if (args.json) return console.log(JSON.stringify(report))
    const verb = args.dryRun ? 'would be' : 'were'
    console.log(`Languages: ${report.languages.join(', ') || '(none)'}   Services: ${report.services.join(', ') || '(none)'}`)
    for (const key of ['created', 'replaced', 'skipped']) {
      if (report[key].length > 0) console.log(`${report[key].length} file(s) ${verb} ${key}${key === 'skipped' ? ' (exist and differ; use --force)' : ''}`)
    }
    for (const w of report.warnings) console.log(`warning: ${w}`)
    console.log('Next: open .devops/project.md and fill the "Fill in by hand" section; commit it.')
    return
  }
  if (command === 'status') return console.log(JSON.stringify(status(args.dest), null, 2))
  if (command === 'check') {
    const ids = (args._[1] ?? '').split(',').filter(Boolean)
    return console.log(JSON.stringify(checkToolchain(args.dest, ids), null, 2))
  }
  if (command === 'sandbox') {
    const [id] = args.lang.split(',')
    const lang = config.languages.find(l => l.id === id)
    if (!lang) throw new Error(`unknown language id: ${id}`)
    if (!lang.sandboxImage) throw new Error(`${id} has no sandbox image; run on the host only with the human's OK`)
    const out = sandboxArgv(loadServices(args.dest).sandboxPolicy, { phase: args.phase, image: lang.sandboxImage, cmd: args.cmd, worktree: resolveDest(args.dest) })
    return console.log(args.json ? JSON.stringify(out) : out.shell)
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
