#!/usr/bin/env node
// The server's own sandbox: it touches only the folders it is allowed (DEVOPS_MCP_ROOTS, else the
// client's MCP roots, else its working directory), writes only what the tool names, plans before it
// writes, runs only fixed `<tool> --version` and read-only `git` argument lists (no shell, bare
// environment, DEVOPS_MCP_NO_GIT=1 turns the git tools off), makes no network request and never
// returns a secret.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  PACKAGE_ROOT, addLocalLanguage, checkToolchain, detectLanguages, detectServices, ensureGitignore, install,
  loadLanguages, loadServices, renderProfile, resolveDest, sandboxArgv, status,
} from '../scripts/devops-setup.mjs'
import { ghasPlan } from '../scripts/devops-ghas.mjs'
import { moduleMap, reuseSearch } from '../scripts/devops-research.mjs'
import { tagCreate, tagHistory, tagPlan } from '../scripts/devops-tags.mjs'

const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_LINE = 2 * 1024 * 1024
const ID = /^[a-z][a-z0-9-]*$/

const INSTRUCTIONS = [
  'Sets up the DevOps multi-agent team (skill, agents, commands, per-language profile, services, sandbox) in a project.',
  'Flow: detect_project, then install_devops_team with apply=false and show the plan, then apply=true only after the user agrees.',
  'Any language can be used for any purpose; layers are only sorting tags. Use list_languages / get_language / add_language for languages not yet defined.',
  'The server only writes .cursor/, .claude/, .devops/, .gitignore and (ghas_plan with apply) the .github security files and SECURITY.md inside the project, and never runs project commands; sandbox_plan only prints a container command; tag tools never push, move or delete a tag.',
  'Researchers: read documentation first, then module_map and reuse_search before any code is written.',
].join(' ')

let clientRoots = []

function allowedRoots() {
  const fromEnv = (process.env.DEVOPS_MCP_ROOTS ?? '').split(path.delimiter).filter(Boolean)
  const candidates = fromEnv.length > 0 ? fromEnv : clientRoots.length > 0 ? clientRoots : [process.cwd()]
  const roots = []
  for (const candidate of candidates) {
    try {
      roots.push(fs.realpathSync(candidate))
    } catch { /* a root that does not exist allows nothing */ }
  }
  return roots
}

function projectDir(args) {
  const roots = allowedRoots()
  if (roots.length === 0) throw new Error('no usable project folder: set DEVOPS_MCP_ROOTS or open a folder in the client')
  return resolveDest(typeof args.dest === 'string' && args.dest !== '' ? args.dest : roots[0], roots)
}

function idList(value, name, { allow = ['auto'] } = {}) {
  if (value === undefined) return 'auto'
  if (typeof value === 'string' && allow.includes(value)) return value
  if (Array.isArray(value) && value.length <= 64 && value.every(v => typeof v === 'string' && ID.test(v))) return value
  throw new Error(`${name} must be ${allow.map(a => `"${a}"`).join(', ')} or a list of ids`)
}
const optionalBool = (args, key, fallback) => (args[key] === undefined ? fallback : args[key] === true)

const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(typeof value === 'object' ? { structuredContent: value } : {}) })

const dest = { type: 'string', description: 'Project folder. Defaults to the first folder the client opened (or DEVOPS_MCP_ROOTS).' }
const langs = { description: '"auto" (detect) or a list of language ids from list_languages. Layers do not restrict: any id works anywhere.', anyOf: [{ type: 'string', enum: ['auto'] }, { type: 'array', items: { type: 'string' } }] }
const svcs = { description: '"auto" (detect), "none", or a list of service ids from list_services (docker, ollama, aws, ...).', anyOf: [{ type: 'string', enum: ['auto', 'none'] }, { type: 'array', items: { type: 'string' } }] }

const TOOLS = [
  {
    name: 'list_languages',
    description: 'List the languages this package can set up, with their layer tags. Layers only sort the list.',
    inputSchema: { type: 'object', properties: { layer: { type: 'string', description: 'Optional layer tag to filter by (web, backend, systems, game, scripting, infra, data, science).' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      const config = loadLanguages(projectDirOrPackage(args))
      return config.languages.filter(l => args.layer === undefined || l.layers.includes(args.layer)).map(l => ({ id: l.id, name: l.name, layers: l.layers, sandboxImage: l.sandboxImage }))
    },
  },
  {
    name: 'get_language',
    description: 'Full setup entry for one language: install steps, validation, security tools, style, how it interacts with other languages.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      const found = loadLanguages(projectDirOrPackage(args)).languages.find(l => l.id === args.id)
      if (!found) throw new Error(`unknown language id: ${args.id} (use list_languages, or add_language to define it)`)
      return found
    },
  },
  {
    name: 'list_services',
    description: 'List supporting services the team can set up and manage: containers (Docker, Podman, devcontainers), Kubernetes, cloud (AWS, GCP, Azure, Cloudflare), AI (Claude, GPT, Gemini, Ollama), VMs (Multipass, Lima, Vagrant, QEMU).',
    inputSchema: { type: 'object', properties: { category: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => loadServices(projectDirOrPackage(args)).services.filter(s => args.category === undefined || s.category === args.category).map(s => ({ id: s.id, name: s.name, category: s.category })),
  },
  {
    name: 'get_service',
    description: 'Full entry for one service: install, setup steps, sandbox role, what only the human may run, security rules, interactions.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      const found = loadServices(projectDirOrPackage(args)).services.find(s => s.id === args.id)
      if (!found) throw new Error(`unknown service id: ${args.id} (use list_services)`)
      return found
    },
  },
  {
    name: 'detect_project',
    description: 'Look at a project folder and report the languages and services its files show, and what is already installed.',
    inputSchema: { type: 'object', properties: { dest }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      const d = projectDir(args)
      return { ...status(d, allowedRoots()), languages: detectLanguages(d), services: detectServices(d) }
    },
  },
  {
    name: 'status',
    description: 'What is installed in the project: skill for Cursor/Claude, profile, sandbox doc, .gitignore block.',
    inputSchema: { type: 'object', properties: { dest }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => status(projectDir(args), allowedRoots()),
  },
  {
    name: 'install_devops_team',
    description: 'Install the DevOps multi-agent team into a project: skill, agents, commands (Cursor and/or Claude), .devops/ language and service data, the project profile, the sandbox doc, and the .gitignore block that keeps .devops/thoughts/ out of git. With apply=false (default) it only reports the plan. Existing files that differ are kept unless force=true.',
    inputSchema: {
      type: 'object',
      properties: {
        dest,
        target: { type: 'string', enum: ['cursor', 'claude', 'both'], description: 'Which host folders to install into. Default both.' },
        languages: langs,
        services: svcs,
        sandbox: { type: 'boolean', description: 'Write .devops/sandbox.md (default true).' },
        skipRules: { type: 'array', items: { type: 'string' }, description: 'Rule files not to install (reuse-before-implement, comments) because the project already has an equivalent.' },
        force: { type: 'boolean', description: 'Overwrite files that differ (default false).' },
        apply: { type: 'boolean', description: 'false (default) = plan only; true = write.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => install({
      dest: projectDir(args), roots: allowedRoots(),
      target: ['cursor', 'claude', 'both'].includes(args.target) ? args.target : 'both',
      lang: idList(args.languages, 'languages'),
      services: idList(args.services, 'services', { allow: ['auto', 'none'] }),
      sandbox: optionalBool(args, 'sandbox', true), skipRules: idList(args.skipRules ?? [], 'skipRules', { allow: [] }), force: optionalBool(args, 'force', false), dryRun: !optionalBool(args, 'apply', false),
    }),
  },
  {
    name: 'get_profile',
    description: 'Render the .devops/project.md the installer would write for these languages and services, without writing anything.',
    inputSchema: { type: 'object', properties: { dest, languages: langs, services: svcs }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      const d = projectDir(args)
      const report = install({ dest: d, roots: allowedRoots(), lang: idList(args.languages, 'languages'), services: idList(args.services, 'services', { allow: ['auto', 'none'] }), dryRun: true })
      const config = loadLanguages(d)
      const servicesConfig = loadServices(d)
      return renderProfile(config, config.languages.filter(l => report.languages.includes(l.id)), d, { servicesConfig, services: servicesConfig.services.filter(s => report.services.includes(s.id)), sandbox: true })
    },
  },
  {
    name: 'ensure_gitignore',
    description: 'Add or repair the managed .gitignore block that keeps .devops/thoughts/ (research notes, review threads, QA notes, scratch) out of git while keeping its .gitkeep and the committed .devops/project.md. Plan only unless apply=true.',
    inputSchema: { type: 'object', properties: { dest, apply: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => {
      const d = projectDir(args)
      const report = { created: [], replaced: [], same: [], skipped: [], warnings: [] }
      ensureGitignore(d, { dryRun: !optionalBool(args, 'apply', false), root: d }, report)
      return { dest: d, applied: optionalBool(args, 'apply', false), ...report }
    },
  },
  {
    name: 'add_language',
    description: 'Define a language that is not in the list (or override one) by chat. The entry is validated against the same rules as the built-in ones and, with apply=true, saved to .devops/languages.local.json. Commands in the entry are guidance for the team; the server never runs them. toolchain.verify must be "<tool> --version" style.',
    inputSchema: {
      type: 'object',
      properties: { dest, entry: { type: 'object', description: 'A language entry (see get_language for the shape). For an existing id only the fields you give are replaced.' }, apply: { type: 'boolean' } },
      required: ['entry'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => {
      if (typeof args.entry !== 'object' || args.entry === null || JSON.stringify(args.entry).length > 65536) throw new Error('entry must be an object under 64 KB')
      return addLocalLanguage(projectDir(args), args.entry, { apply: optionalBool(args, 'apply', false) })
    },
  },
  {
    name: 'check_toolchain',
    description: 'Is the tool for each language or service id installed on this machine? Runs only "<tool> --version". Environment variables a service needs are reported by name as set or unset, never by value.',
    inputSchema: { type: 'object', properties: { dest, ids: { type: 'array', items: { type: 'string' }, maxItems: 64 } }, required: ['ids'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      if (!Array.isArray(args.ids) || !args.ids.every(id => typeof id === 'string' && ID.test(id))) throw new Error('ids must be a list of language/service ids')
      return checkToolchain(projectDir(args), args.ids)
    },
  },
  {
    name: 'sandbox_plan',
    description: 'Print the container command that runs a command for a language inside the sandbox (network off except the deps phase, read-only root, no capabilities, no host secrets). Runs nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        dest, language: { type: 'string' }, phase: { type: 'string', enum: ['deps', 'build', 'test', 'scan', 'browser'] },
        command: { type: 'array', items: { type: 'string' }, description: 'The command as a list of words, e.g. ["cargo","test","--locked"].' },
        worktree: { type: 'string', description: 'Absolute path of the worktree to mount read-write. Defaults to the project folder.' },
        engine: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['language', 'command'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: args => {
      const d = projectDir(args)
      const lang = loadLanguages(d).languages.find(l => l.id === args.language)
      if (!lang) throw new Error(`unknown language id: ${args.language}`)
      if (!lang.sandboxImage) throw new Error(`${lang.id} has no sandbox image: run on the host only with the human's OK, and say so in the report`)
      const worktree = typeof args.worktree === 'string' ? resolveDest(args.worktree, allowedRoots()) : d
      return sandboxArgv(loadServices(d).sandboxPolicy, { phase: args.phase ?? 'test', image: lang.sandboxImage, cmd: args.command, worktree, project: d, engine: args.engine })
    },
  },
  {
    name: 'module_map',
    description: 'Research aid: the project\'s modules, their languages and the imports between them, as data and a Mermaid mind map. Use it to find extension points before writing new code. Read-only.',
    inputSchema: { type: 'object', properties: { dest }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => moduleMap(projectDir(args), allowedRoots()),
  },
  {
    name: 'reuse_search',
    description: 'Research aid: where each term (or a spelling variant) already appears in code, comments and documentation (Markdown, LaTeX, ...), grouped as definition, doc or use. Run it for every noun and verb of a new concept before writing code. Secret-looking files are skipped and values redacted. Read-only.',
    inputSchema: { type: 'object', properties: { dest, terms: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 } }, required: ['terms'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => reuseSearch(projectDir(args), args.terms, allowedRoots()),
  },
  {
    name: 'tag_history',
    description: 'Version tracking: read the git tags and report, between consecutive semver tags, commits, files, lines, top directories, languages and commit types, flag releases whose version step does not fit what changed, and show what is unreleased with a suggested bump. With save=true writes .devops/tags/history.json and reports tags new, moved or removed since the last snapshot. Local tags only (run git fetch --tags first, with the human\'s OK, for remote ones).',
    inputSchema: { type: 'object', properties: { dest, limit: { type: 'integer', minimum: 1, maximum: 200 }, save: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => {
      gitAllowed()
      return tagHistory(projectDir(args), { limit: Number.isInteger(args.limit) ? args.limit : 30, save: optionalBool(args, 'save', false), roots: allowedRoots() })
    },
  },
  {
    name: 'tag_plan',
    description: 'Plan the next release tag from the latest semver tag and a bump (major, minor, patch) or an explicit version. Prints the commands; changes nothing. Pushing the tag is publishing and needs QA PASS and the human\'s go.',
    inputSchema: { type: 'object', properties: { dest, bump: { type: 'string', enum: ['major', 'minor', 'patch'] }, version: { type: 'string' }, ref: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      gitAllowed()
      return tagPlan(projectDir(args), { bump: args.bump, version: args.version, ref: args.ref, roots: allowedRoots() })
    },
  },
  {
    name: 'tag_create',
    description: 'Create one annotated LOCAL tag at a commit (apply=true). Refuses an existing name, a non-semver name and any move or delete; never pushes.',
    inputSchema: { type: 'object', properties: { dest, version: { type: 'string' }, message: { type: 'string', maxLength: 500 }, ref: { type: 'string' }, apply: { type: 'boolean' } }, required: ['version'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: args => {
      gitAllowed()
      return tagCreate(projectDir(args), { version: args.version, message: args.message, ref: args.ref, apply: optionalBool(args, 'apply', false), roots: allowedRoots() })
    },
  },
  {
    name: 'ghas_plan',
    description: 'Set up GitHub Advanced Security for this project: plan (and with apply=true write) .github/workflows/codeql.yml for the detected languages, dependency-review.yml, .github/dependabot.yml for the package managers found, SECURITY.md, plus .devops/ghas/commands.md (repository settings as gh commands for the HUMAN to run) and a ruleset template. Existing files are kept unless force=true. Changes nothing on GitHub.',
    inputSchema: { type: 'object', properties: { dest, branch: { type: 'string', description: 'Default branch name (default main).' }, apply: { type: 'boolean' }, force: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => ghasPlan(projectDir(args), { branch: typeof args.branch === 'string' ? args.branch : 'main', apply: optionalBool(args, 'apply', false), force: optionalBool(args, 'force', false), roots: allowedRoots() }),
  },
]

function gitAllowed() {
  if (process.env.DEVOPS_MCP_NO_GIT === '1') throw new Error('the tag tools are disabled (DEVOPS_MCP_NO_GIT=1)')
}

/** Catalog reads work with no project open. */
function projectDirOrPackage(args) {
  try {
    return projectDir(args)
  } catch {
    return PACKAGE_ROOT
  }
}

const RESOURCES = [
  { uri: 'devops://languages', name: 'languages.json', mimeType: 'application/json', file: 'languages.json' },
  { uri: 'devops://languages.md', name: 'LANGUAGES.md', mimeType: 'text/markdown', file: 'LANGUAGES.md' },
  { uri: 'devops://services', name: 'services.json', mimeType: 'application/json', file: 'services.json' },
  { uri: 'devops://services.md', name: 'SERVICES.md', mimeType: 'text/markdown', file: 'SERVICES.md' },
  { uri: 'devops://skill', name: 'SKILL.md', mimeType: 'text/markdown', file: 'skills/devops-multi-agent-team/SKILL.md' },
]

const PROMPTS = [
  {
    name: 'setup_project',
    description: 'Set up the DevOps multi-agent team in this project, step by step, asking before anything is written.',
    arguments: [{ name: 'languages', description: 'Optional: comma-separated language ids; default is to detect.', required: false }, { name: 'services', description: 'Optional: comma-separated service ids, e.g. docker,ollama.', required: false }],
    build: a => `Set up the DevOps multi-agent team in this project using the devops-multi-agent-team MCP tools.
1. Call detect_project and tell me which languages and services you found and what is already installed.
2. ${a.languages ? `Use these languages: ${a.languages}.` : 'Use the detected languages; ask me about any I may want to add or drop.'} ${a.services ? `Also set up these services: ${a.services}.` : 'Ask whether I want Docker, a cloud, an AI service (Claude, GPT, Ollama) or a VM set up.'}
3. Call install_devops_team with apply=false and show me the plan: files, languages, services, warnings.
4. Only after I agree, call it again with apply=true, then ensure_gitignore (apply=true) if status shows gitignoreOk is false.
5. Call check_toolchain for the chosen ids and list which tools I still need to install, with the install lines from get_language / get_service.
6. Remind me to fill in the "Fill in by hand" section of .devops/project.md and commit it.
Never run the project's own build or deploy commands yourself; use sandbox_plan to show how they would run in the sandbox.`,
  },
  {
    name: 'add_language',
    description: 'Define a language that is not in the list.',
    arguments: [{ name: 'name', description: 'The language, e.g. Elm.', required: true }],
    build: a => `Define the language "${a.name ?? '(name it)'}" for this project. Call get_language on a similar one to see the entry shape, draft a complete entry (detect markers, install lines, validate commands, security tools or null with unanalysed, style, interactsWith, sandboxImage or null; toolchain.verify must be "<tool> --version"), call add_language with apply=false and show me the result, and save it with apply=true only after I agree.`,
  },
]

const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const reply = (id, result) => send({ id, result })
const fail = (id, code, message) => send({ id, error: { code, message } })
let nextRequestId = 1
const pending = new Map()

function handle(message) {
  const { id, method, params = {} } = message
  const isRequest = id !== undefined && typeof method === 'string'
  if (typeof method !== 'string') {
    if (id !== undefined && pending.has(id)) pending.get(id)(message)
    return
  }
  try {
    if (method === 'initialize') {
      const wanted = params.protocolVersion
      reply(id, {
        protocolVersion: SUPPORTED.includes(wanted) ? wanted : SUPPORTED[0],
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: PKG.name, version: PKG.version },
        instructions: INSTRUCTIONS,
      })
      handle.clientHasRoots = params.capabilities?.roots !== undefined
    } else if (method === 'notifications/initialized') {
      if (handle.clientHasRoots) requestRoots()
    } else if (method === 'notifications/roots/list_changed') {
      requestRoots()
    } else if (method === 'ping') {
      reply(id, {})
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS.map(({ run, ...tool }) => tool) })
    } else if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === params.name)
      if (!tool) return fail(id, -32602, `unknown tool: ${params.name}`)
      try {
        const args = params.arguments ?? {}
        if (typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object')
        reply(id, text(tool.run(args)))
      } catch (error) {
        reply(id, { isError: true, content: [{ type: 'text', text: error.message }] })
      }
    } else if (method === 'resources/list') {
      reply(id, { resources: RESOURCES.map(({ file, ...r }) => r) })
    } else if (method === 'resources/read') {
      const resource = RESOURCES.find(r => r.uri === params.uri)
      if (!resource) return fail(id, -32002, `unknown resource: ${params.uri}`)
      reply(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: fs.readFileSync(path.join(PACKAGE_ROOT, resource.file), 'utf8') }] })
    } else if (method === 'prompts/list') {
      reply(id, { prompts: PROMPTS.map(({ build, ...p }) => p) })
    } else if (method === 'prompts/get') {
      const prompt = PROMPTS.find(p => p.name === params.name)
      if (!prompt) return fail(id, -32602, `unknown prompt: ${params.name}`)
      reply(id, { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.build(params.arguments ?? {}) } }] })
    } else if (isRequest) {
      fail(id, -32601, `method not found: ${method}`)
    }
  } catch (error) {
    if (isRequest) fail(id, -32603, error.message)
  }
}

function requestRoots() {
  const id = `r${nextRequestId++}`
  pending.set(id, response => {
    pending.delete(id)
    clientRoots = (response.result?.roots ?? [])
      .map(root => { try { return fileURLToPath(root.uri) } catch { return undefined } })
      .filter(Boolean)
  })
  send({ id, method: 'roots/list' })
}

export function serve(input = process.stdin) {
  let buffer = ''
  input.setEncoding('utf8')
  input.on('data', chunk => {
    buffer += chunk
    if (buffer.length > MAX_LINE && !buffer.includes('\n')) {
      buffer = ''
      return fail(null, -32600, 'message too large')
    }
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line === '') continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        fail(null, -32700, 'parse error')
        continue
      }
      handle(message)
    }
  })
  input.on('end', () => process.exit(0))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) serve()
