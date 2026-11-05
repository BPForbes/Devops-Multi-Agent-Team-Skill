#!/usr/bin/env node
// The server's own sandbox: it touches only folders it is allowed
// (DEVOPS_MCP_ROOTS, else the client's roots, else its working directory),
// writes only what a tool names and only after a plan, runs only fixed
// `<tool> --version` and read-only `git` lists (no shell, bare environment;
// DEVOPS_MCP_NO_GIT=1 disables git), makes no network request, returns no
// secret.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  PACKAGE_ROOT, addLocalLanguage, checkToolchain, detectLanguages, detectServices, ensureGitignore, install,
  loadLanguages, loadServices, renderProfile, resolveDest, sandboxArgv, status,
} from '../scripts/devops-setup.mjs'
import { commentAudit } from '../scripts/devops-comments.mjs'
import { parseStatement, scanProject, snapshot } from '../scripts/devops-cleanup.mjs'
import { ghasPlan } from '../scripts/devops-ghas.mjs'
import { buildGraph, checkStory, guidance, linkStories, loadCatalog, newStory, parseStory } from '../scripts/devops-stories.mjs'
import { moduleMap, reuseSearch } from '../scripts/devops-research.mjs'
import { tagCreate, tagHistory, tagPlan } from '../scripts/devops-tags.mjs'

const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_LINE = 2 * 1024 * 1024
const ID = /^[a-z][a-z0-9-]*$/

const SETUP_SCRIPT = fs.readFileSync(path.join(PACKAGE_ROOT, 'mcp', 'setup-script.md'), 'utf8').trim()

const INSTRUCTIONS = [
  'Sets up the DevOps multi-agent team (skill, agents, commands, per-language profile, services, sandbox) in a project.',
  'Flow: detect_project, then install_devops_team with apply=false and show the plan, then apply=true only after the user agrees.',
  'Any language can be used for any purpose; layers are only sorting tags. Use list_languages / get_language / add_language for languages not yet defined.',
  'The server only writes .cursor/, .claude/, .devops/, devops-skill/ (thought files and cleanup snapshots), .gitignore and (ghas_plan with apply) the .github security files and SECURITY.md inside the project, and never runs project commands; sandbox_plan only prints a container command; tag tools never push, move or delete a tag.',
  'Researchers: read documentation first, then module_map and reuse_search before any code is written.',
].join(' ') + '\n\n' + SETUP_SCRIPT

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
    description: 'Install the DevOps multi-agent team into a project: skill, agents, commands (Cursor and/or Claude), .devops/ language and service data, the project profile, the sandbox doc, and the .gitignore block that keeps devops-skill/thoughts/ out of git. With apply=false (default) it only reports the plan. Existing files that differ are kept unless force=true.',
    inputSchema: {
      type: 'object',
      properties: {
        dest,
        target: { type: 'string', enum: ['auto', 'cursor', 'claude', 'both'], description: 'Which host folders to install into. Default auto: the ones the project already has, else both.' },
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
      target: ['auto', 'cursor', 'claude', 'both'].includes(args.target) ? args.target : 'auto',
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
    description: 'Add or repair the managed .gitignore block that keeps devops-skill/thoughts/ (research notes, review threads, QA notes, scratch) out of git while keeping its .gitkeep and the committed .devops/project.md. Plan only unless apply=true.',
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
    name: 'comment_audit',
    description: 'Audit the comments a change adds (staged, working tree vs HEAD, or base...head) and return ready-to-paste Conventional Comments remarks: comments that restate the code, commented-out code, questions or notes to a person left in code, process notes, bare TODO/FIXME, signature-only doc lines, over-commented files, long prose. Coders run it before handoff; Reviewers use the findings as line remarks on the virtual PR. Pass `listed` (the Push JSON `comments` array) to also flag comments the Coder did not justify. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        dest, base: { type: 'string' }, head: { type: 'string' }, staged: { type: 'boolean' },
        listed: { type: 'array', maxItems: 500, items: { type: 'object', properties: { file: { type: 'string' }, line: { type: ['string', 'number'] }, why: { type: 'string' } }, required: ['file'] } },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: args => {
      gitAllowed()
      return commentAudit(projectDir(args), { base: args.base, head: args.head, staged: optionalBool(args, 'staged', false), listed: args.listed, roots: allowedRoots() })
    },
  },
  {
    name: 'cleanup_brief',
    description: 'Turn a plain-English cleanup statement (for example "reduce the comments in src/api, call one function instead of the repeated code, split functions over 40 lines, do not touch vendor") into a brief: goals (comments, duplicates, split, dead code, naming), scope (paths named that exist, and exclusions), thresholds, constraints (the standing ones plus your own sentences) and any sentence not understood. Show it to the person and ask about `unrecognized` before scanning. Read-only.',
    inputSchema: { type: 'object', properties: { dest, statement: { type: 'string', maxLength: 2000 } }, required: ['statement'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => parseStatement(args.statement, projectDir(args), allowedRoots()),
  },
  {
    name: 'cleanup_scan',
    description: 'Find cleanup candidates in the project: duplicated blocks (with every location and the number of lines), functions over the length, nesting or parameter limits, flag arguments, magic numbers, vague names, and noisy or commented-out code, ranked by payoff, with a suggested refactor for each. Give `statement` to scan what a plain-English statement asks for, or `goals`/`paths`/`exclude`/`thresholds` directly. `save` stores the summary under a name in devops-skill/thoughts/non-final/; `compare` shows the change against a saved one (use it after the cleanup to prove the numbers improved and nothing got worse). Heuristic and read-only apart from `save`; it runs no program.',
    inputSchema: {
      type: 'object',
      properties: {
        dest, statement: { type: 'string', maxLength: 2000 },
        goals: { type: 'array', items: { type: 'string', enum: ['comments', 'duplicates', 'split', 'dead', 'constants', 'naming'] } },
        paths: { type: 'array', items: { type: 'string' }, maxItems: 40 }, exclude: { type: 'array', items: { type: 'string' }, maxItems: 40 },
        thresholds: { type: 'object', properties: { maxFunctionLines: { type: 'integer' }, maxNesting: { type: 'integer' }, maxParams: { type: 'integer' }, minDuplicateLines: { type: 'integer' } }, additionalProperties: false },
        limit: { type: 'integer', minimum: 1, maximum: 200 }, save: { type: 'string', description: 'Snapshot name to save (lower-case letters, digits, hyphens).' }, compare: { type: 'string', description: 'Snapshot name to compare with.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => {
      const dest = projectDir(args)
      const brief = typeof args.statement === 'string' ? parseStatement(args.statement, dest, allowedRoots()) : undefined
      const safePaths = list => (Array.isArray(list) ? list : []).filter(p => typeof p === 'string' && /^[A-Za-z0-9._\/-]+$/.test(p) && !p.includes('..') && !p.startsWith('/'))
      const result = scanProject(dest, {
        goals: args.goals ?? brief?.goals ?? ['comments', 'duplicates', 'split', 'constants', 'naming'],
        paths: [...(brief?.scope.paths ?? []), ...safePaths(args.paths)], exclude: [...(brief?.scope.exclude ?? []), ...safePaths(args.exclude)],
        thresholds: { ...(brief?.thresholds ?? {}), ...(args.thresholds ?? {}) }, limit: Number.isInteger(args.limit) ? args.limit : 40, roots: allowedRoots(),
      })
      if (typeof args.save === 'string') result.snapshot = snapshot(dest, args.save, result, { save: true })
      if (typeof args.compare === 'string') result.compare = snapshot(dest, args.compare, result)
      return result
    },
  },
  {
    name: 'story_parse',
    description: 'Parse a story written in the catalog format (a GitHub issue body or a story file) into structure: catalog id, project, baseline sha, status, depends on, needed by, files, OLD blocks (path, lines, text) and NEW blocks (compiled or not), and which sections are present. Pass the text you read from the issue. Pure; reads nothing from the project.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 300000 }, title: { type: 'string', maxLength: 300 } }, required: ['text'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => parseStory(args.text, { title: args.title }),
  },
  {
    name: 'story_graph',
    description: 'Link the stories of one or more catalogs (.devops/stories/catalog.json; pass several `dests` to tie two projects together, for example a server and its client). Returns the dependency order by level, what is ready to start, the longest chain, cross-project edges, the pattern index, a Mermaid graph, and every problem: unknown ids, missing inverse links, cycles, bad statuses, SUPERSEDED without a successor; plus warnings such as DONE before its dependency. Read-only.',
    inputSchema: { type: 'object', properties: { dest, dests: { type: 'array', items: { type: 'string' }, maxItems: 8 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      const paths = Array.isArray(args.dests) && args.dests.length > 0 ? args.dests : [projectDir(args)]
      return buildGraph(paths.map(p => loadCatalog(p, allowedRoots()).catalog))
    },
  },
  {
    name: 'story_new',
    description: 'Create a story from the template and add it to the catalog (plan unless apply=true). Fills the id, project, baseline, status, dependency graph and the Depends on / Needed by table; the Coder writes OLD and NEW. Refuses a duplicate id or a bad id.',
    inputSchema: {
      type: 'object',
      properties: {
        dest, id: { type: 'string', description: 'For example SRV-17.' }, title: { type: 'string', maxLength: 160 },
        status: { type: 'string', enum: ['PROPOSED', 'DECIDED', 'REVISED', 'IN-PROGRESS', 'DONE', 'SUPERSEDED', 'DROPPED'] }, statusNote: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' } }, neededBy: { type: 'array', items: { type: 'string' } },
        absorbs: { type: 'array', items: { type: 'string' } }, supersedes: { type: 'array', items: { type: 'string' } }, refines: { type: 'array', items: { type: 'string' } }, sharesContract: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } }, change: { type: 'string' }, issue: { type: 'integer' }, patterns: { type: 'array', items: { type: 'string' } }, apply: { type: 'boolean' },
      },
      required: ['id', 'title'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: args => {
      const { dest: _dest, apply, ...spec } = args
      return newStory(projectDir(args), spec, { apply: optionalBool(args, 'apply', false), roots: allowedRoots() })
    },
  },
  {
    name: 'story_link',
    description: 'Relate two stories (depends-on, absorbs, supersedes, refines, shares-contract). Both sides are kept in step (depends-on also fills Needed by) and a link that would create a cycle is refused. The other story may live in another project\'s catalog. Plan unless apply=true.',
    inputSchema: { type: 'object', properties: { dest, from: { type: 'string' }, to: { type: 'string' }, relation: { type: 'string', enum: ['depends-on', 'absorbs', 'supersedes', 'refines', 'shares-contract'] }, apply: { type: 'boolean' } }, required: ['from', 'to', 'relation'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => linkStories(projectDir(args), { from: args.from, to: args.to, relation: args.relation }, { apply: optionalBool(args, 'apply', false), roots: allowedRoots() }),
  },
  {
    name: 'story_check',
    description: 'QA check of one story file: every OLD block must be verbatim (character for character, trailing spaces ignored) from the baseline commit the story names, at the file and lines it names; reports changed, missing or out-of-range blocks with the first differing line. Also requires a NEW block that says whether it was compiled, a Dependencies section, a Why section and a Not verified statement. `ref` overrides the baseline (use it to see drift against the current head).',
    inputSchema: { type: 'object', properties: { dest, id: { type: 'string', description: 'Story id (for example SRV-22).' }, ref: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: args => {
      gitAllowed()
      return checkStory(projectDir(args), args.id, { ref: args.ref, roots: allowedRoots() })
    },
  },
  {
    name: 'story_guidance',
    description: 'Build the guidance index for future work from the catalog: dependency order, what is ready, the longest chain, the reusable patterns each story established (with the stories that share them), recorded decisions, cross-project links and the Mermaid graph. Writes .devops/stories/guidance.md only with apply=true.',
    inputSchema: { type: 'object', properties: { dest, apply: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: args => guidance(projectDir(args), { apply: optionalBool(args, 'apply', false), roots: allowedRoots() }),
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
  { uri: 'devops://setup', name: 'setup-script.md', mimeType: 'text/markdown', file: 'mcp/setup-script.md' },
  { uri: 'devops://skill', name: 'SKILL.md', mimeType: 'text/markdown', file: 'skills/devops-multi-agent-team/SKILL.md' },
]

const PROMPTS = [
  {
    name: 'setup_project',
    description: 'Set up the DevOps multi-agent team in this project, step by step, asking before anything is written.',
    arguments: [{ name: 'languages', description: 'Optional: comma-separated language ids; default is to detect.', required: false }, { name: 'services', description: 'Optional: comma-separated service ids, e.g. docker,ollama.', required: false }],
    build: a => `${SETUP_SCRIPT}\n\nStart now.${a.languages ? ` Use these languages: ${a.languages}.` : ''}${a.services ? ` Also set up these services: ${a.services}.` : ''}`,
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
