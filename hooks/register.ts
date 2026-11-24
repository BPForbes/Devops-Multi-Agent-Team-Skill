import type { EngineInterface, Register } from 'claude-code'

import type { Found } from '../types'
import {
  branchNameOf, classify, classifySegments, commitInfo, interpretDevopsIntent, shellWords, treeOf,
  splitArgs, verdictOf,
} from './guard'
import {
  interpretSkillIntent, isGateWord, isSkillWord, orchestrationCard, parseSkillMode,
  scriptArgsFor, scriptNameFor, skillWords, type SkillMode,
} from './modes'
import { BRIEF_SPEC, BRIEF_TOOL, briefFor, card, readStandards, setupClaude } from './orchestrate'

const PLUGIN = 'devops-multi-agent-team'
const SCRIPT_TIMEOUT_MS = 20000
const THOUGHT_DIRS = ['devops-skill/thoughts/non-final', 'devops-skill/thoughts/final']
const LANGUAGES_REF = { plugin: 'devops-multi-agent-team', key: 'languages' } as const
const GATES_REF = { plugin: 'devops-multi-agent-team', key: 'gates' } as const

// Words that change what may be pushed. Only the person may run them.
const HUMAN_ONLY_WORDS = new Set(['push-ok', 'push-reset', 'gates', 'allow-branch'])

function isHuman(e: unknown): boolean {
  return (e as { origin?: { kind?: unknown } }).origin?.kind === 'composer'
}
const LINT_MODE_REF = { plugin: 'devops-multi-agent-team', key: 'commentAudit' } as const
const BRIEFED_REF = { plugin: 'devops-multi-agent-team', key: 'briefed' } as const
const STANDARDS_REF = { plugin: 'devops-multi-agent-team', key: 'standards' } as const
const STANDARDS_FILE_REF = { plugin: 'devops-multi-agent-team', key: 'standardsFile' } as const

/** The standards summary, read again only when .devops/standards.json changed since the last read. */
async function currentStandards($: EngineInterface, root: string): Promise<string> {
  const text = await $.fs.read(`${root}/.devops/standards.json`).catch(() => '')
  const seen = await $.state.get(STANDARDS_FILE_REF)
  const cached = await $.state.get(STANDARDS_REF)
  if (seen.value === text && cached.value !== undefined) return cached.value
  const summary = (await readStandards($, root)) ?? ''
  await $.state.set(STANDARDS_REF, summary)
  await $.state.set(STANDARDS_FILE_REF, text)
  return summary
}
const MINDMAP_OVERVIEW = '.devops/mindmap/OVERVIEW.md'
/** The mind map's wording: the package defaults, then the project's own file, key by key. */
const MINDMAP_TEXT_OVERRIDE = '.devops/mindmap/text.json'
/** Keeps the session prompt small: the overview is about forty lines, this is a guard against a huge README summary. */
const MAX_OVERVIEW_CHARS = 4000


const HELP = [
  '/devops              status: languages, gates, QA verdict',
  '/devops languages    what was detected and in which layer',
  '/devops setup        how to install the skill and profile in this project',
  '/devops setup claude [--dry-run] [--share-config]  set this project up for Claude Code:',
  '                     only .devops/ and the thought folders; the plugin supplies the rest',
  '/devops brief [TOPIC | role NAME]  one section of the skill, or a seat\'s brief',
  '/devops push-ok | push | go | publish | ship   allow ONE push (human word is final;',
  '                     same as saying "push" in chat; does not require QA PASS)',
  '/devops push-reset | withdraw   withdraw that permission',
  '/devops allow-branch NAME   allow creating that git branch',
  '/devops gates on|off   turn the push and branch gates on or off',
  '/devops monitor on|off   turn the failed-check monitor on or off',
  '/devops comments warn|strict|off   lint gate on git commit (comment and code rules): ' +
    'warn (default), refuse a commit with blocking findings, or off',
  '/devops config [show|get PATH] read the project standards (line length, limits, lint rules)',
  '/devops config set|unset|add|remove PATH [VALUE] | rule RULE error|off   change ' +
    '.devops/standards.json; checked before it is written',
  '/devops help [--mode all|gates|skills|stage]   catalog of gates and skill modes',
  '/devops question [--mode overview|tree|symbol|search|…] QUERY',
  '                     answer from mindmap_* (project-mindmap); no team',
  '/devops mind-map [--mode overview|build|status|tree|query|note] …',
  '                     repository mind map via mindmap_* / devops-mindmap.mjs',
  '/devops clean [--mode brief|scan|plan|run] STATEMENT',
  '                     cleanup_brief / cleanup_scan + devops-cleanup skill',
  '/devops stage|ci|pipeline [--mode research|…|qa|docs|full|loop] [GOAL]',
  '                     one CI/CD pod, or full loop until Clear+PASS then notify human',
  '/devops allocate [--mode pod|agent|job|board] [GOAL]',
  '                     Orchestrator assigns goals to pods and each agent',
  '/devops goal|story|repro|triage|review|reuse|tags [--mode …] …',
  '                     skill modes: structured tools + orchestration card',
  'Chat aliases and free-form phrases map onto these modes. Call the named',
  'tools; keep large file bodies out of chat. Keep development running.',
].join('\n')

async function mindmapText($: EngineInterface, root: string): Promise<Record<string, string>> {
  const parse = (raw: unknown): Record<string, string> => {
    try {
      const text = (JSON.parse(typeof raw === 'string' ? raw : '') as { text?: Record<string, unknown> }).text ?? {}
      return Object.fromEntries(Object.entries(text).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    } catch {
      return {}
    }
  }
  const defaults = parse(await $.fs.read(`${$.plugin.root}/mindmap-text.json`).catch(() => ''))
  const project = parse(await $.fs.read(`${root}/${MINDMAP_TEXT_OVERRIDE}`).catch(() => ''))
  return { ...defaults, ...project }
}

async function detect($: EngineInterface): Promise<Found[]> {
  const root = await $.session.root()
  const ran = await $.process
    .run(
      ['node', `${$.plugin.root}/scripts/devops-setup.mjs`, 'detect', '--json', '--dest', root],
      { timeoutMs: SCRIPT_TIMEOUT_MS },
    )
    .catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) return []
  try {
    return JSON.parse(ran.stdout) as Found[]
  } catch {
    return []
  }
}

const PUSH_KEY = { plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const
const OVERRIDES_KEY = { plugin: 'devops-multi-agent-team', key: 'overrides' } as const

/**
 * The publish check shared by every path that publishes (git push, GitHub
 * write tools): the person's push-ok, and the latest QA note. A BLOCKED note
 * refuses and cannot be overridden. A missing or stale PASS is recorded as the
 * human override. Returns the refusal, or undefined when the publish may go on.
 */
async function publishDenial($: EngineInterface, what: string): Promise<string | undefined> {
  if (!((await $.state.get(PUSH_KEY)).value ?? false)) {
    return `${PLUGIN}: ${what} is refused until the person types /devops push-ok.`
  }
  const qa = await latestQaVerdict($)
  if (qa.verdict === 'BLOCKED') {
    return `${PLUGIN}: ${what} is refused: the latest QA note is BLOCKED.\n` +
      'Fix the findings. BLOCKED cannot be overridden.'
  }
  const tree = await headTree($)
  if (qa.verdict !== 'PASS' || tree === undefined || qa.tree !== tree) {
    const override = {
      tree: tree ?? 'unknown', rule: 'qa-pass', qa: qa.verdict ?? 'none', what,
      at: new Date().toISOString(),
    }
    await $.state.set({ plugin: 'devops-multi-agent-team', key: 'lastOverride' } as const, override)
    // Every override is kept, not only the latest, for audit.
    const past = (await $.state.get(OVERRIDES_KEY)).value ?? []
    await $.state.set(OVERRIDES_KEY, [...past, override])
  }
  return undefined
}

/** GitHub write tools publish too: they need the same push-ok and QA check. */
const GITHUB_WRITES = [
  'create_pull_request', 'merge_pull_request', 'push_files', 'create_or_update_file', 'delete_file',
  'update_pull_request_branch', 'enable_pr_auto_merge', 'create_branch',
] as const

async function latestQaVerdict($: EngineInterface): Promise<{
  verdict: 'PASS' | 'BLOCKED' | undefined; tree?: string; file?: string
}> {
  const root = await $.session.root()
  const notes: { path: string; mtimeMs: number }[] = []
  for (const dir of THOUGHT_DIRS) {
    const entries = await $.fs.list(`${root}/${dir}`).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.startsWith('qa-') && entry.name.endsWith('.md')) {
        notes.push({ path: `${root}/${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })
      }
    }
  }
  const newest = notes.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (newest === undefined) return { verdict: undefined }
  const text = await $.fs.read(newest.path).catch(() => '')
  return { verdict: verdictOf(text), tree: treeOf(text), file: newest.path }
}

/** The tree the push would send: HEAD^{tree}, or undefined when git cannot say. */
const GIT_TIMEOUT_MS = 10000

async function headTree($: EngineInterface): Promise<string | undefined> {
  const root = await $.session.root()
  const argv = ['git', '-C', root, 'rev-parse', 'HEAD^{tree}']
  const ran = await $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  const hash = ran?.stdout.trim() ?? ''
  return ran?.exitCode === 0 && /^[0-9a-f]{40}$/.test(hash) ? hash : undefined
}


const CHECK_BINARIES = new Set([
  'make', 'cmake', 'ctest', 'npm', 'npx', 'pnpm', 'yarn', 'pytest', 'ruff', 'mypy', 'pyright', 'bundle', 'rubocop', 'composer',
  'mix', 'rebar3', 'cabal', 'stack', 'dune', 'opam', 'sbt', 'gradle', './gradlew', 'mvn', './mvnw', 'fpm', 'eslint', 'tsc', 'prettier',
  'jest', 'vitest', 'phpunit', 'hlint', 'shfmt', 'shellcheck', 'hadolint', 'tflint', 'checkov', 'trivy', 'gitleaks', 'actionlint',
  'cargo', 'go', 'dotnet', 'python', 'python3', 'node', 'dart', 'flutter', 'swift', 'zig', 'terraform', 'clj-kondo', 'clojure', 'lein',
  'luacheck', 'busted', 'stylua', 'gdformat', 'gdlint', 'Rscript', 'julia', 'sqlfluff', 'stylelint', 'html-validate', 'ormolu', 'bandit',
  'pip-audit', 'govulncheck', 'staticcheck', 'clippy-driver', 'cppcheck', 'clang-tidy', 'codeql',
])
const DEFAULT_RETRY_CAP = 3

/** "cargo test --locked" -> "cargo test"; "pytest -q" -> "pytest". Words that are flags or placeholders are not part of the key. */
function checkKeyOf(words: string[]): string | undefined {
  const first = words[0]
  if (first === undefined || !CHECK_BINARIES.has(first)) return undefined
  const second = words[1]
  return second !== undefined && /^[a-z][a-z0-9:_-]*$/.test(second) ? `${first} ${second}` : first
}

async function knownChecks($: EngineInterface): Promise<Set<string>> {
  const root = await $.session.root()
  const text = await $.fs.read(`${root}/.devops/languages.json`).catch(() => $.fs.read(`${$.plugin.root}/languages.json`)).catch(() => '')
  const keys = new Set<string>()
  try {
    const data = JSON.parse(typeof text === 'string' ? text : '') as { languages?: { validate?: string[] }[] }
    for (const language of data.languages ?? []) {
      for (const line of language.validate ?? []) {
        const key = checkKeyOf(line.trim().split(/\s+/))
        if (key !== undefined) keys.add(key)
      }
    }
  } catch { /* no data file: nothing is monitored */ }
  return keys
}

async function checkRunBy($: EngineInterface, command: string): Promise<string | undefined> {
  const known = await knownChecks($)
  for (const segment of classifySegments(command)) {
    const words = segment.split(/\s+/).filter(Boolean)
    while (words.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || ['sudo', 'time', 'exec'].includes(words[0]))) words.shift()
    const key = checkKeyOf(words)
    if (key !== undefined && (known.has(key) || known.has(words[0]))) return key
  }
  return undefined
}

async function retryCap($: EngineInterface): Promise<number> {
  const root = await $.session.root()
  const text = await $.fs.read(`${root}/.devops/project.md`).catch(() => '')
  const m = /check retry cap\*\* for auto-correction: `(\d+)`/.exec(typeof text === 'string' ? text : '')
  const cap = m ? Number(m[1]) : DEFAULT_RETRY_CAP
  return cap >= 1 && cap <= 10 ? cap : DEFAULT_RETRY_CAP
}

async function appendLedger($: EngineInterface, row: string): Promise<void> {
  const root = await $.session.root()
  if (!(await $.fs.exists(`${root}/.devops`).catch(() => false))) return
  const file = `${root}/devops-skill/thoughts/non-final/check-ledger.md`
  const current = await $.fs.read(file).catch(() => '')
  const header = 'time (UTC) | check | where | exit/conclusion | attempt | class | first failing line | status\n'
  await $.fs.write(file, (typeof current === 'string' && current !== '' ? current : header) + row + '\n')
}

type AuditSummary = { blocking: number; nonBlocking: number; findings: { file: string; line: number; remark: string }[] }

async function auditCommit($: EngineInterface, stagesAll: boolean): Promise<AuditSummary | undefined> {
  const root = await $.session.root()
  const scope = stagesAll ? [] : ['--staged']
  const script = `${$.plugin.root}/scripts/devops-lint.mjs`
  const lintArgs = ['node', script, 'check', '--dest', root, ...scope, '--json']
  const ran = await $.process
    .run(lintArgs, { timeoutMs: SCRIPT_TIMEOUT_MS })
    .catch(() => undefined)
  if (ran === undefined || ran.stdout === '') return undefined
  try {
    return JSON.parse(ran.stdout) as AuditSummary
  } catch {
    return undefined
  }
}

function auditContext(audit: AuditSummary): string {
  const first = audit.findings.slice(0, 6).map(f => `${f.file}:${f.line} ${f.remark}`).join(' | ')
  const counts = `${audit.blocking} blocking, ${audit.nonBlocking} non-blocking`
  const advice = 'Each finding names its rule and its fix; fix them all before handoff, ' +
    'then run the open-source linters (lint_commands) in the sandbox.'
  return `${PLUGIN} lint: ${counts}. ${advice} ${first}`
}

function resolveSkill(word: string, rest: string, raw: string): SkillMode | undefined {
  if (isSkillWord(word)) return parseSkillMode(word, rest)
  if (isGateWord(word) || interpretDevopsIntent(raw) !== undefined) return undefined
  return interpretSkillIntent(raw)
}

async function runPluginScript(
  $: EngineInterface,
  script: string,
  args: string[],
): Promise<string | undefined> {
  const root = await $.session.root()
  const command = ['node', `${$.plugin.root}/scripts/${script}`, ...args, '--dest', root]
  const ran = await $.process
    .run(command, { timeoutMs: SCRIPT_TIMEOUT_MS })
    .catch(() => undefined)
  if (ran === undefined) return undefined
  const out = `${ran.stdout}${ran.stderr}`.trim()
  return out === '' ? undefined : out
}

async function runSkillMode($: EngineInterface, skill: SkillMode): Promise<string> {
  const cardText = orchestrationCard(skill)
  const script = scriptNameFor(skill)
  const args = scriptArgsFor(skill)
  if (script === undefined || args === undefined) return cardText
  const out = await runPluginScript($, script, args)
  if (out === undefined) return cardText
  return `${cardText}\n\n--- tool output ---\n${out}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devops',
      description: 'DevOps multi-agent team: gates, skill modes (question, mind-map, clean, …)',
      argumentHint: '[status|question|mind-map|clean|goal|story|…|--mode MODE|push-ok|config …]',
    })
    await $.tool.register(BRIEF_SPEC).catch(() => undefined)
    await currentStandards($, await $.session.root())
    const found = await detect($)
    await $.state.set({ plugin: 'devops-multi-agent-team', key: 'languages' } as const, found.map(f => f.id))
    $.ui.status(found.length === 0 ? undefined : `devops: ${found.slice(0, 4).map(f => f.id).join('+')}`)

    return next(e)
  })

  on('command.run', { command: 'devops' }, async ($, e) => {
    const split = splitArgs(e.args)
    const skill = resolveSkill(split.word, split.rest, e.args)
    if (skill !== undefined) return { text: await runSkillMode($, skill) }

    const mapped = isGateWord(split.word)
      ? split
      : (interpretDevopsIntent(e.args) ?? split)
    const { word, rest } = mapped
    if (HUMAN_ONLY_WORDS.has(word) && !isHuman(e)) {
      return { text: `/devops ${word} is the person's alone: an agent cannot run it.` }
    }

    if (word === '' || word === 'status') {
      const gates = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'gates' } as const)).value ?? true
      const authorized = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const)).value ?? false
      const branches = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
      const languages = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'languages' } as const)).value ?? []
      const qa = await latestQaVerdict($)
      return {
        text: [
          `languages: ${languages.length === 0 ? '(none detected)' : languages.join(', ')}`,
          `gates: ${gates ? 'on' : 'OFF'}`,
          `check monitor: ${((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'monitor' } as const)).value ?? true) ? 'on' : 'OFF'}; failing checks now: ${Object.entries((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'checkFailures' } as const)).value ?? {}).map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}`,
          `latest QA note: ${qa.verdict ?? 'none'}${qa.file ? ` (${qa.file.split('/').pop()})` : ''}`,
          `push authorized (human / chat "push"): ${authorized ? 'yes (one push)' : 'no'}`,
          `branches allowed: ${branches.length === 0 ? 'none' : branches.join(', ')}`,
        ].join('\n'),
      }
    }
    if (word === 'languages') {
      const found = await detect($)
      return {
        text: found.length === 0
          ? 'No known language found. See LANGUAGES.md to add one.'
          : found.map(f => `${f.id.padEnd(14)} ${f.layers.join(',').padEnd(18)} ${f.evidence.join('; ')}`).join('\n'),
      }
    }
    if (word === 'setup' && rest.split(/\s+/)[0] === 'claude') {
      return { text: await setupClaude($, rest.split(/\s+/).slice(1)) }
    }
    if (word === 'brief') {
      const [first, ...others] = rest.split(/\s+/).filter(Boolean)
      const input = first === 'role' ? { role: others.join(' ') } : { topic: rest }
      return { text: await briefFor($, input) }
    }
    if (word === 'setup') {
      return {
        text: [
          'Claude Code with this plugin: /devops setup claude (add --dry-run to preview,' +
            ' --share-config to commit .devops/). It writes only .devops/ and the thought folders.',
          'Easiest: ask me "set up the DevOps team in this project" (MCP server devops-multi-agent-team; I plan first and write only after you agree).',
          'Or one command from a shell (installs and connects the MCP server):',
          `  node ${$.plugin.root}/scripts/devops-setup.mjs init --dest .`,
          '--dry-run previews; --lang rust,typescript chooses languages; --target cursor|claude|both overrides the auto-detected host folders.',
          'It copies the tools into devops-skill/kit/ and keeps everything it writes out of git',
          '(.git/info/exclude). --share-config commits .devops/ so the team shares the profile.',
          'Then fill in the "Fill in by hand" section of .devops/project.md.',
        ].join('\n'),
      }
    }
    if (word === 'push-ok') {
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, true)
      return {
        text: 'One push is allowed now (human word is final; same as saying "push" in chat). '
          + 'It is consumed by that push. Keep development running.',
      }
    }
    if (word === 'push-reset') {
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, false)
      return { text: 'Push permission withdrawn.' }
    }
    if (word === 'allow-branch') {
      const name = branchNameOf(rest)
      if (name === undefined) return { text: 'Usage: /devops allow-branch NAME (letters, digits, . _ / -).' }
      const current = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const, [...new Set([...current, name])])
      return { text: `Creating the git branch "${name}" is allowed.` }
    }
    if (word === 'comments') {
      if (rest !== 'warn' && rest !== 'strict' && rest !== 'off') return { text: 'Usage: /devops comments warn|strict|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'commentAudit' } as const, rest)
      return { text: `Comment audit on commit: ${rest}.` }
    }
    if (word === 'config') {
      const args = shellWords(rest)
      const root = await $.session.root()
      const script = `${$.plugin.root}/scripts/devops-config.mjs`
      const command = ['node', script, ...(args.length > 0 ? args : ['show']), '--dest', root]
      const ran = await $.process
        .run(command, { timeoutMs: SCRIPT_TIMEOUT_MS })
        .catch(() => undefined)
      if (ran === undefined) return { text: 'devops-config could not run.' }
      return { text: `${ran.stdout}${ran.stderr}`.trim() || 'devops-config printed nothing.' }
    }
    if (word === 'monitor') {
      if (rest !== 'on' && rest !== 'off') return { text: 'Usage: /devops monitor on|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'monitor' } as const, rest === 'on')
      return { text: `Check monitor ${rest}.` }
    }
    if (word === 'gates') {
      if (rest !== 'on' && rest !== 'off') return { text: 'Usage: /devops gates on|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'gates' } as const, rest === 'on')
      return { text: `Gates ${rest}.` }
    }
    const fallback = interpretSkillIntent(e.args)
    if (fallback !== undefined) return { text: await runSkillMode($, fallback) }
    return {
      text: [
        'Unrecognized /devops wording. Prefer a skill mode so tools run instead of plain text:',
        `  ${skillWords().join(', ')}`,
        'Example: /devops question --mode symbol total',
        '          /devops mind-map --mode build',
        '          /devops clean --mode brief "split functions over 40 lines in src"',
        'Human wording is still final: parse the intent, map it to a mode, and keep working.',
        HELP,
      ].join('\n'),
    }
  })

  for (const tool of GITHUB_WRITES) {
    on('tool.call', { tool: `mcp__github__${tool}` }, async ($, e, next) => {
      const denied = await publishDenial($, `GitHub ${tool}`)
      if (denied !== undefined) return { deny: denied }
      const ran = await next(e)
      if (ran.deny === undefined) await $.state.set(PUSH_KEY, false)
      return ran
    })
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const gatesOn = ((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'gates' } as const)).value ?? true) !== false
    const actions = gatesOn ? classify(e.command) : []
    let consumeAuthorization = false

    for (const action of actions) {
      if (action.kind === 'branch') {
        const allowed = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
        if (action.name !== undefined && allowed.includes(action.name)) continue
        return {
          deny: `${PLUGIN}: ${action.what}${action.name ? ` ${action.name}` : ''} is refused. Stay on the current branch and use a detached worktree (git worktree add --detach) for side work; the person can allow a branch with /devops allow-branch NAME.`,
        }
      }
    }
    if (actions.some(action => action.kind === 'publish')) {
      const what = actions.find(a => a.kind === 'publish')?.what ?? 'push'
      const denied = await publishDenial($, what)
      if (denied !== undefined) return { deny: denied }
      consumeAuthorization = true
    }

    const commit = commitInfo(e.command)
    const auditMode = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'commentAudit' } as const)).value ?? 'warn'
    const audit = commit.isCommit && auditMode !== 'off' ? await auditCommit($, commit.stagesAll) : undefined
    if (audit !== undefined && auditMode === 'strict' && audit.blocking > 0) return { deny: auditContext(audit) }

    const ran = await next(e)
    if (audit !== undefined && ran.deny === undefined && audit.blocking + audit.nonBlocking > 0) {
      return { ...ran, context: [...(ran.context ?? []), auditContext(audit)] }
    }
    if (consumeAuthorization && ran.deny === undefined) await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, false)
    if (ran.deny !== undefined || ((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'monitor' } as const)).value ?? true) === false) return ran

    const check = await checkRunBy($, e.command)
    if (check === undefined) return ran
    const counts = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'checkFailures' } as const)).value ?? {}
    const stamp = new Date().toISOString()
    if (ran.isError !== true) {
      if (counts[check] === undefined) return ran
      const { [check]: _cleared, ...rest } = counts
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'checkFailures' } as const, rest)
      await appendLedger($, `${stamp} | ${check} | local | 0 | ${counts[check]} | - | - | verified`)
      return ran
    }
    const attempt = (counts[check] ?? 0) + 1
    const cap = await retryCap($)
    await $.state.set({ plugin: 'devops-multi-agent-team', key: 'checkFailures' } as const, { ...counts, [check]: attempt })
    await appendLedger($, `${stamp} | ${check} | local | non-zero | ${attempt} | unclassified | see tool output | ${attempt >= cap ? 'escalated' : 'open'}`)
    const context = attempt >= cap
      ? `${PLUGIN} monitor: "${check}" has failed ${attempt} times (cap ${cap}). Stop trying variations. Open triage-<seat-id>.md with the rows in devops-skill/thoughts/non-final/check-ledger.md and ask the person. Never skip, loosen or disable a test, rule or check to get green.`
      : `${PLUGIN} monitor: "${check}" failed (attempt ${attempt} of ${cap}). Correct it per monitoring.md: record, classify (ours, existing, environment, flaky with evidence), reproduce in the sandbox, fix the cause on your side-branch, then re-run this same check. Never skip, loosen or disable a test, rule or check to get green.`
    return { ...ran, context: [...(ran.context ?? []), context] }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: its gate failed to evaluate, so ${e.command.slice(0, 60)} is refused.` },
  )

  on('tool.run', { tool: `mcp__${PLUGIN}__${BRIEF_TOOL}` }, async ($, e) => {
    const input = e as unknown as { topic?: unknown; role?: unknown }
    await $.state.set(BRIEFED_REF, true)
    return { result: await briefFor($, input) }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const root = await $.session.root()
    const languages = (await $.state.get(LANGUAGES_REF)).value ?? []
    const hasProfile = await $.fs.exists(`${root}/.devops/project.md`).catch(() => false)
    const overview = await $.fs.read(`${root}/${MINDMAP_OVERVIEW}`).catch(() => '')
    const wording = await mindmapText($, root)
    const mindmapSection = typeof overview === 'string' && overview.trim() !== ''
      ? [{
          id: `${PLUGIN}:mindmap`,
          text: [
            wording.chatPrompt,
            overview.length > MAX_OVERVIEW_CHARS ? `${overview.slice(0, MAX_OVERVIEW_CHARS)}\n${wording.chatOverviewCut ?? ''}` : overview,
          ].filter(Boolean).join('\n\n'),
          scope: 'session' as const,
        }]
      : []
    const briefed = (await $.state.get(BRIEFED_REF)).value === true
    if (languages.length === 0 && !hasProfile && !briefed) {
      return { sections: [...composed.sections, ...mindmapSection] }
    }
    const gates = await $.state.get(GATES_REF)
    const lint = await $.state.get(LINT_MODE_REF)
    const standards = await currentStandards($, root)
    const text = card({
      languages,
      hasProfile,
      gates: gates.value ?? true,
      lintMode: lint.value ?? 'warn',
      standards: standards || undefined,
    })
    return { sections: [...composed.sections, { id: `${PLUGIN}:context`, text, scope: 'session' as const }, ...mindmapSection] }
  })
}
