import type { EngineInterface, Register } from 'claude-code'

import type { Found } from '../types'
import {
  branchNameOf, chatAuthorizesPush, classify, classifySegments, commitInfo, interpretDevopsIntent,
  isSingleCommand, namesPush, securityVerdictOf, shellWords, splitArgs, treeOf, verdictOf,
} from './guard'
import {
  helpCatalog, interpretSkillIntent, isGateWord, isSkillWord, orchestrationCard, parseSkillMode,
  scriptArgsFor, scriptNameFor, skillWords, type SkillMode,
} from './modes'
import { BRIEF_SPEC, BRIEF_TOOL, briefFor, card, readStandards, setupClaude } from './orchestrate'

const PLUGIN = 'devops-multi-agent-team'
const SCRIPT_TIMEOUT_MS = 20000
const THOUGHT_DIRS = ['devops-skill/thoughts/non-final', 'devops-skill/thoughts/final']
const LANGUAGES_REF = { plugin: 'devops-multi-agent-team', key: 'languages' } as const
const GATES_REF = { plugin: 'devops-multi-agent-team', key: 'gates' } as const

// Words that change what may be pushed, or switch a check off. Only the
// person may run them.
const HUMAN_ONLY_WORDS = new Set([
  'on', 'off', 'enable', 'disable', 'skill', 'skills',
  'push-ok', 'push-reset', 'gates', 'allow-branch', 'comments', 'monitor', 'bug', 'load',
  'satisfied', 'continue', 'answer', 'vision',
])
const ACTIVE_REF = { plugin: 'devops-multi-agent-team', key: 'active' } as const
const SETTINGS_SCRIPT = 'scripts/devops-claude-settings.mjs'

/** The skill is on unless the person typed `/devops off` / `disable`. */
async function skillActive($: EngineInterface): Promise<boolean> {
  return (await $.state.get(ACTIVE_REF)).value !== false
}

/** Run devops-claude-settings.mjs against the session root; returns its printout. */
async function runClaudeSettings(
  $: EngineInterface,
  args: string[],
): Promise<string> {
  const root = await $.session.root()
  const script = `${$.plugin.root}/${SETTINGS_SCRIPT}`
  const command = ['node', script, ...args, '--dest', root]
  const ran = await $.process
    .run(command, { timeoutMs: SCRIPT_TIMEOUT_MS })
    .catch(() => undefined)
  if (ran === undefined) return 'devops-claude-settings could not run.'
  return `${ran.stdout}${ran.stderr}`.trim() || 'devops-claude-settings printed nothing.'
}

// `config` reads are open to every seat; these subcommands write.
const CONFIG_WRITES = new Set(['set', 'unset', 'add', 'remove', 'rule'])

function isPersonOnly(word: string, rest: string): boolean {
  if (HUMAN_ONLY_WORDS.has(word)) return true
  if (word === 'config') return CONFIG_WRITES.has(shellWords(rest)[0] ?? '')
  return word === 'setup' && rest.split(/\s+/)[0] === 'claude'
}

function personOnlyText(word: string): string {
  return `/devops ${word} changes a gate, so only the person can run it by typing it; `
    + 'an agent cannot.'
}

// The Done chain's words. A seat types them for its own step: the hook runs
// them on the board as the seat bound in DEVOPS_SEAT and grants nothing.
// Typed by the person (composer origin), they answer the merge report.
const CHAIN_WORDS = new Set(['merge-ok', 'merge-deny', 'done', 'raise'])
const CHAIN_SCRIPT = 'devops-chain.mjs'
const PUSH_REPORTS = { plugin: 'devops-multi-agent-team', key: 'pushReports' } as const

const REPORT_ID = /^report-[0-9a-f]{6}$/
const GOAL_ID = /^goal-[0-9a-f]{6}$/

/** The merge report ids named in typed words, and the words left over. */
function reportIds(rest: string): { ids: string[]; words: string[] } {
  const all = shellWords(rest)
  const isReport = (w: string) => REPORT_ID.test(w)
  return { ids: all.filter(isReport), words: all.filter(w => !isReport(w)) }
}

/** `--risk REASON` and `--goal` hashes in the words left after report ids. */
function riskOverride(words: string[]): { risk?: string; goals: string[]; error?: string } {
  const goals: string[] = []
  let risk: string | undefined
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === '--goal') {
      const goal = words[i + 1]
      if (!GOAL_ID.test(goal ?? '')) {
        return { goals, error: 'Usage: /devops push-ok --risk REASON --goal goal-<hex>' }
      }
      goals.push(goal)
      i += 1
      continue
    }
    if (words[i] !== '--risk') continue
    const reason = words[i + 1]
    if (reason === undefined || reason.startsWith('--') || reason.trim() === '') {
      return {
        goals,
        error: 'a risk override needs a reason: /devops push-ok REPORT... --risk REASON',
      }
    }
    risk = reason
    i += 1
  }
  return { risk, goals }
}

function approveArgs(ids: string[], goals: string[], risk?: string): string[] {
  return [
    'approve', ...ids,
    ...goals.flatMap(goal => ['--goal', goal]),
    ...(risk === undefined ? [] : ['--risk', risk]),
  ]
}

/**
 * The person's approval of the current tree: grants one push (PUSH_KEY). A
 * push-ok naming merge reports first approves them on the board; if the
 * board refuses one (a dependency not approved, and no --risk reason),
 * nothing is granted. `--risk` is the client's reason for skipping a check
 * or dependency; a goal-only risk records that and does not grant a push.
 * Returns what happened.
 */
async function grantPush(
  $: EngineInterface,
  ids: string[] = [],
  risk?: string,
  goals: string[] = [],
): Promise<string> {
  const tree = await headTree($)
  if (tree === undefined) return `The tree cannot be read; no push is allowed. ${NO_CHECKOUT_HINT}`
  const boardCall = ids.length > 0 || goals.length > 0
  const ran = boardCall
    ? await runPluginScript($, CHAIN_SCRIPT, approveArgs(ids, goals, risk))
    : await waitingRefusal($)
  if (!ran.ok) return `No push granted: ${ran.out ?? 'the board could not be updated'}`
  if (goals.length > 0 && ids.length === 0) {
    return `${ran.out ?? 'Risk recorded.'}\nNo push is granted until a merge report is approved.`
  }
  await $.state.set(PUSH_KEY, tree)
  await $.state.set(PUSH_REPORTS, ids)
  const board = ids.length > 0 ? `\n${ran.out ?? ''}`
    : '\nNo merge report waits for you, so this push approves none.'
  return `One push is allowed on tree ${tree.slice(0, 12)} (human word is final; `
    + 'same as saying "push" in chat). A missing QA PASS or Security CLEAR is '
    + 'recorded as an override, not a refusal. A new commit voids the grant. '
    + 'It is consumed by that push. Keep development running.' + board
}

/**
 * A push-ok naming no report is refused while merge reports wait for the
 * person: it must name the ones it approves. With none waiting, the
 * person's word still grants the push (the client override).
 */
async function waitingRefusal($: EngineInterface): Promise<{ out?: string; ok: boolean }> {
  const ran = await runPluginScript($, CHAIN_SCRIPT, ['waiting'])
  const waiting = reportIds(ran.out ?? '').ids
  if (waiting.length === 0) return { ok: true }
  return {
    ok: false,
    out: `merge reports wait for you (${waiting.join(', ')}); name the ones you `
      + `approve: /devops push-ok ${waiting[0]}`,
  }
}

/** Consumes the push grant; the merge reports it named are recorded as pushed. */
async function consumeGrant($: EngineInterface): Promise<void> {
  const tree = (await $.state.get(PUSH_KEY)).value
  const ids = (await $.state.get(PUSH_REPORTS)).value ?? []
  await $.state.set(PUSH_KEY, false)
  await $.state.set(PUSH_REPORTS, [])
  if (typeof tree === 'string' && ids.length > 0) {
    await runPluginScript($, CHAIN_SCRIPT, ['pushed', '--tree', tree, ...ids])
  }
}

/** A seat's typed chain word: its own step on the board, never a push grant. */
async function seatChainWord($: EngineInterface, word: string, rest: string): Promise<string> {
  const [goal = '', ...words] = shellWords(rest)
  const says = word === 'merge-deny' || word === 'raise'
  const reason = says && !words.includes('--reason')
    ? ['--reason', words.join(' ')] : words
  const ran = await runPluginScript($, CHAIN_SCRIPT, [word, goal, ...reason])
  return `Seat ${word} (routed to the board as DEVOPS_SEAT; no push is granted): `
    + (ran.out ?? 'the board could not be updated')
}

const BUG_USAGE = 'Usage: /devops bug REPORT fine | fix N | fix YOUR ALTERNATIVE'

/**
 * The person's answer to the BA's bug report: the behavior is fine, or fix
 * it with proposal N or with an alternative in the person's own words.
 */
async function bugAnswer($: EngineInterface, rest: string): Promise<string> {
  const { ids, words } = reportIds(rest)
  const [decision, ...how] = words
  if (ids.length !== 1 || (decision !== 'fine' && decision !== 'fix')) return BUG_USAGE
  if (decision === 'fix' && how.length === 0) return BUG_USAGE
  const picked = /^[0-9]+$/.test(how.join(' ')) ? ['--proposal', how[0]]
    : ['--alternative', how.join(' ')]
  const args = ['bug', ids[0], decision, ...(decision === 'fix' ? picked : [])]
  const ran = await runPluginScript($, CHAIN_SCRIPT, args)
  return ran.out ?? 'the board could not be updated'
}

const LOOP_SCRIPT = 'devops-loop.mjs'
const VISION_SCRIPT = 'devops-vision.mjs'

/** The client's words: a vision note on a goal, or the answer to a deadlock's question. */
async function visionWords($: EngineInterface, word: string, rest: string): Promise<string> {
  const [target = '', ...words] = shellWords(rest)
  const ran = await runPluginScript($, VISION_SCRIPT, [word, target, ...words])
  return ran.out ?? 'the board could not be updated'
}

/**
 * The person's sign-off on the latest sprint report: satisfied ends the
 * sprint loop; continue keeps it going, answering the BA's question with the
 * words typed, and `--more N` allows N more sprints past the limit.
 */
async function loopDecision($: EngineInterface, decision: string, rest: string): Promise<string> {
  const words = shellWords(rest)
  const at = words.indexOf('--more')
  const more = at === -1 ? [] : ['--more', words[at + 1] ?? '']
  const note = words.filter((_, i) => at === -1 || (i !== at && i !== at + 1)).join(' ')
  const args = ['decide', decision, ...(note === '' ? [] : ['--note', note]), ...more]
  const ran = await runPluginScript($, LOOP_SCRIPT, args)
  return ran.out ?? 'the sprint loop could not be updated'
}

const LOAD_USAGE = 'Usage: /devops load REPORT approve|decline [REASON]'

/**
 * The person's answer to the BA's load report: give the held work to the
 * seat past its open-work limit, or decline it.
 */
async function loadAnswer($: EngineInterface, rest: string): Promise<string> {
  const { ids, words } = reportIds(rest)
  const [decision, ...why] = words
  if (ids.length !== 1 || (decision !== 'approve' && decision !== 'decline')) return LOAD_USAGE
  const reason = why.length > 0 ? ['--reason', why.join(' ')] : []
  const ran = await runPluginScript($, CHAIN_SCRIPT, ['load', ids[0], decision, ...reason])
  return ran.out ?? 'the board could not be updated'
}

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
 * write tools). The person's push-ok (or chat "push") on this exact tree is
 * required and is final: it authorizes one push even when QA PASS or Security
 * CLEAR is missing, so human orders do not deadlock development. A missing or
 * mismatched seat verdict is recorded as an override. Returns the refusal, or
 * undefined. (Skipped entirely while `/devops off` has the skill inactive.)
 */
async function publishDenial($: EngineInterface, what: string): Promise<string | undefined> {
  const tree = await headTree($)
  if (tree === undefined) {
    return `${PLUGIN}: ${what} is refused: the tree cannot be read. ${NO_CHECKOUT_HINT}`
  }
  const granted = (await $.state.get(PUSH_KEY)).value
  if (granted !== tree) {
    return `${PLUGIN}: ${what} is refused until the person authorizes it `
      + '(/devops push-ok, or "push" in chat) on the current tree. '
      + 'Their word is final and overrides seat gates for that one push.'
  }
  const qa = await latestQaVerdict($)
  const security = await latestSecurityVerdict($)
  const rules: { rule: string; subject: string }[] = []
  if (qa.verdict !== 'PASS' || qa.tree !== tree) {
    rules.push({ rule: 'qa-pass', subject: qa.verdict ?? 'none' })
  }
  if (security.verdict !== 'CLEAR' || security.tree !== tree) {
    rules.push({ rule: 'security-clear', subject: security.verdict ?? 'none' })
  }
  if (rules.length > 0) {
    const past = (await $.state.get(OVERRIDES_KEY)).value ?? []
    const stamped = new Date().toISOString()
    const recorded = rules.map(({ rule, subject }) => ({
      tree, rule, verdict: subject, what, at: stamped,
    }))
    await $.state.set(OVERRIDES_KEY, [...past, ...recorded])
    await $.state.set(
      { plugin: 'devops-multi-agent-team', key: 'lastOverride' } as const,
      recorded[recorded.length - 1],
    )
  }
  return undefined
}

/** GitHub tools that only read; every other GitHub tool is a write and is gated. */
const GITHUB_READ = /^(?:get_|list_|search_)|_read$|^run_secret_scanning$/
/** GitHub write tools publish too: they need the same push-ok and QA check. */
const GITHUB_WRITES = [
  'create_pull_request', 'merge_pull_request', 'push_files', 'create_or_update_file', 'delete_file',
  'update_pull_request_branch', 'enable_pr_auto_merge', 'create_branch',
] as const

/**
 * GitHub tools refused outright: they write file content that is not the
 * checked HEAD, or merge, which is the person's to do on GitHub.
 */
const GITHUB_REFUSED = new Set([
  'push_files', 'create_or_update_file', 'delete_file',
  'merge_pull_request', 'enable_pr_auto_merge', 'update_pull_request_branch',
])

/** Any GitHub MCP server's tools, whatever the server is named. */
const GITHUB_TOOL = /^mcp__.*github.*__.+$/i

/** `owner/repo` of a remote URL (https, ssh or a proxy path), lower-cased. */
function repoOf(url: string): string | undefined {
  const match = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return match === null ? undefined : `${match[1]}/${match[2]}`.toLowerCase()
}

/** Refuses a GitHub tool that writes content, or one aimed at another repository than origin. */
async function githubTargetDenial(
  $: EngineInterface, tool: string, owner: unknown, repo: unknown,
): Promise<string | undefined> {
  if (GITHUB_REFUSED.has(tool)) {
    return `${PLUGIN}: GitHub ${tool} is refused: it writes files that are not the checked HEAD, `
      + 'or merges. Push HEAD with git push <remote> HEAD; the person merges on GitHub.'
  }
  return repoDenial($, `GitHub ${tool}`, `${String(owner ?? '')}/${String(repo ?? '')}`)
}

/** Refuses a write aimed at another repository than this checkout's origin. */
async function repoDenial(
  $: EngineInterface, what: string, target: string,
): Promise<string | undefined> {
  const checkout = await checkoutRoot($)
  const origin = checkout === undefined
    ? undefined
    : await gitOut($, checkout, ['remote', 'get-url', 'origin'])
  const home = origin === undefined ? undefined : repoOf(origin)
  if (home !== undefined && home === target.toLowerCase()) return undefined
  return `${PLUGIN}: ${what} is refused: it names ${target}, `
    + `not this checkout's origin (${home ?? 'none'}).`
}

/** The newest note whose name starts with `prefix`, read from the thought folders. */
async function newestNote(
  $: EngineInterface, prefix: string,
): Promise<{ text: string; file: string } | undefined> {
  const root = await $.session.root()
  const notes: { path: string; mtimeMs: number }[] = []
  for (const dir of THOUGHT_DIRS) {
    const entries = await $.fs.list(`${root}/${dir}`).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.startsWith(prefix) && entry.name.endsWith('.md')) {
        notes.push({ path: `${root}/${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })
      }
    }
  }
  const newest = notes.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (newest === undefined) return undefined
  return { text: await $.fs.read(newest.path).catch(() => ''), file: newest.path }
}

async function latestQaVerdict($: EngineInterface): Promise<{
  verdict: 'PASS' | 'BLOCKED' | undefined; tree?: string; file?: string
}> {
  const note = await newestNote($, 'qa-')
  if (note === undefined) return { verdict: undefined }
  return { verdict: verdictOf(note.text), tree: treeOf(note.text), file: note.file }
}

async function latestSecurityVerdict($: EngineInterface): Promise<{
  verdict: 'CLEAR' | 'BLOCKED' | undefined; tree?: string
}> {
  const note = await newestNote($, 'security-')
  if (note === undefined) return { verdict: undefined }
  return { verdict: securityVerdictOf(note.text), tree: treeOf(note.text) }
}

const GIT_TIMEOUT_MS = 10000

/** How the status line shows the grant: it counts only for the current tree. */
function grantText(granted: string | false, tree: string | undefined): string {
  if (granted === false) return 'no'
  return granted === tree ? 'yes (one push)' : 'no (the grant is for another tree)'
}

/** git's output in `dir`, trimmed, or undefined when git fails. */
async function gitOut(
  $: EngineInterface, dir: string, args: string[],
): Promise<string | undefined> {
  const argv = ['git', '-C', dir, ...args]
  const ran = await $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  return ran?.exitCode === 0 ? ran.stdout.trim() : undefined
}

/** What to do when no checkout can be found, said with every refusal for that reason. */
const NO_CHECKOUT_HINT = 'The session root is not in a git repository and the shell is not '
  + 'in one under it: cd into the repository, then try again.'

/** True when `dir` is `root` or lies below it. */
const isWithin = (dir: string, root: string): boolean => {
  const base = root.replace(/\/+$/, '')
  return dir === base || dir.startsWith(`${base}/`)
}

/**
 * The checkout the gate reads and pushes from: the repository holding the
 * session root, or, when the root is not in one (a session opened above its
 * repositories), the repository holding the shell's directory if that lies
 * under the root. Without the fallback such a session can never push.
 */
async function checkoutRoot($: EngineInterface): Promise<string | undefined> {
  const root = await $.session.root()
  const home = await gitOut($, root, ['rev-parse', '--show-toplevel'])
  if (home !== undefined) return home
  const cwd = await $.session.cwd().catch(() => undefined)
  if (cwd === undefined) return undefined
  const shell = await gitOut($, cwd, ['rev-parse', '--show-toplevel'])
  return shell !== undefined && isWithin(shell, root) ? shell : undefined
}

/** The tree the push would send: HEAD^{tree}, or undefined when git cannot say. */
async function headTree($: EngineInterface): Promise<string | undefined> {
  const checkout = await checkoutRoot($)
  if (checkout === undefined) return undefined
  const hash = await gitOut($, checkout, ['rev-parse', 'HEAD^{tree}']) ?? ''
  return /^[0-9a-f]{40}$/.test(hash) ? hash : undefined
}

/** Settings that make `git push <remote> HEAD` send tags, submodules or every ref as well. */
const WIDENING_SETTINGS = '^(push\\.followtags|push\\.recursesubmodules|remote\\..*\\.mirror)$'

/** True for a `key value` line of a setting that widens a push. */
function widens(line: string): boolean {
  const [key = '', value = ''] = line.toLowerCase().split(/ (.*)/)
  if (key === 'push.recursesubmodules') return !['no', 'false', 'off', '0', 'check'].includes(value)
  return ['true', 'yes', 'on', '1'].includes(value)
}

/**
 * Refuses a push the gate cannot match to the checked tree: the shell is in
 * another checkout than the session's (the tree is read in the session's), or
 * a git setting would send more than HEAD.
 */
async function pushSetupDenial($: EngineInterface, what: string): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const home = await checkoutRoot($)
  if (home === undefined) return `${PLUGIN}: ${what} is refused. ${NO_CHECKOUT_HINT}`
  if (await gitOut($, cwd, ['rev-parse', '--show-toplevel']) !== home) {
    return `${PLUGIN}: ${what} is refused: run it from the session's checkout (${home}); `
      + `the shell is in ${cwd}.`
  }
  const settings = (await gitOut($, home, ['config', '--get-regexp', WIDENING_SETTINGS]) ?? '')
    .split('\n').filter(widens)
  if (settings.length > 0) {
    return `${PLUGIN}: ${what} is refused: ${settings.join(', ')} would send more than HEAD.`
  }
  return undefined
}

/**
 * The git aliases this command uses whose body pushes or runs a shell
 * command, directly or through another alias. git matches alias names
 * without regard to case, and so does this.
 */
async function pushAliasesIn($: EngineInterface, command: string): Promise<string[]> {
  const words = command.replace(/[\\'"]/g, '').toLowerCase().split(/[^\w.-]+/)
  if (!words.includes('git')) return []
  const cwd = await $.session.cwd()
  const config = await gitOut($, cwd, ['config', '--get-regexp', '^alias\\.']) ?? ''
  const aliases = new Map(config.split('\n').flatMap(line => {
    const match = /^alias\.(\S+) (.*)$/.exec(line)
    return match === null ? [] : [[match[1].toLowerCase(), match[2]] as const]
  }))
  const pushes = (name: string, seen: Set<string>): boolean => {
    const body = aliases.get(name)
    if (body === undefined || seen.has(name)) return false
    seen.add(name)
    if (body.startsWith('!') || namesPush(body)) return true
    return pushes(body.trim().split(/\s+/)[0]?.toLowerCase() ?? '', seen)
  }
  return [...new Set(words.filter(word => pushes(word, new Set())))]
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

/** Runs a plugin script on the session root: its printout and whether it exited 0. */
async function runPluginScript(
  $: EngineInterface,
  script: string,
  args: string[],
): Promise<{ out: string | undefined; ok: boolean }> {
  const root = await $.session.root()
  const command = ['node', `${$.plugin.root}/scripts/${script}`, ...args, '--dest', root]
  const ran = await $.process
    .run(command, { timeoutMs: SCRIPT_TIMEOUT_MS })
    .catch(() => undefined)
  if (ran === undefined) return { out: undefined, ok: false }
  const out = `${ran.stdout}${ran.stderr}`.trim()
  return { out: out === '' ? undefined : out, ok: ran.exitCode === 0 }
}

async function runSkillMode($: EngineInterface, skill: SkillMode): Promise<string> {
  const cardText = orchestrationCard(skill)
  const script = scriptNameFor(skill)
  const args = scriptArgsFor(skill)
  if (script === undefined || args === undefined) return cardText
  const { out } = await runPluginScript($, script, args)
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

  // The person's chat message "push" (or "push it") authorizes one push on
  // the current tree, as /devops push-ok does. Other messages pass unchanged.
  on('prompt.submit', async ($, e, next) => {
    const message = e as { text?: unknown; origin?: { kind?: unknown } }
    const kind = typeof message.origin?.kind === 'string' ? message.origin.kind : undefined
    if (typeof message.text === 'string' && chatAuthorizesPush(message.text, kind)) {
      await grantPush($)
    }
    return next(e)
  })

  on('command.run', { command: 'devops' }, async ($, e) => {
    const split = splitArgs(e.args)
    if (isPersonOnly(split.word, split.rest) && !isHuman(e)) {
      return { text: personOnlyText(split.word) }
    }
    if (CHAIN_WORDS.has(split.word) && !isHuman(e)) {
      return { text: await seatChainWord($, split.word, split.rest) }
    }

    const mappedEarly = isGateWord(split.word)
      ? split
      : (interpretDevopsIntent(e.args) ?? split)
    const turnOn = mappedEarly.word === 'on' || mappedEarly.word === 'enable'
    const turnOff = mappedEarly.word === 'off' || mappedEarly.word === 'disable'
    if (turnOn || turnOff) {
      if (!isHuman(e)) return { text: personOnlyText(mappedEarly.word) }
      await $.state.set(ACTIVE_REF, turnOn)
      const persist = await runClaudeSettings($, [turnOn ? 'enable' : 'disable'])
      return {
        text: turnOn
          ? 'DevOps skill on. Gates, publish checks, lint-on-commit, the monitor and the '
            + 'session card are active again.\n'
            + persist
          : 'DevOps skill off. Gates, publish checks, lint-on-commit, the monitor and the '
            + 'session card are inactive in this session. Type /devops on (or enable) to '
            + 'restore before reload; after unload, edit .claude/settings.json or run '
            + '`claude plugin enable devops-multi-agent-team@devops-multi-agent-team`.\n'
            + persist,
      }
    }
    if (mappedEarly.word === 'skills') {
      if (!isHuman(e)) return { text: personOnlyText('skills') }
      return { text: await runClaudeSettings($, ['skills']) }
    }
    if (mappedEarly.word === 'skill') {
      if (!isHuman(e)) return { text: personOnlyText('skill') }
      const parts = shellWords(mappedEarly.rest)
      const action = parts[0]
      const name = parts[1]
      if ((action !== 'on' && action !== 'off') || !name) {
        return { text: 'Usage: /devops skill on|off NAME' }
      }
      return { text: await runClaudeSettings($, ['skill', action, name]) }
    }

    const active = await skillActive($)
    const mapped = isGateWord(split.word)
      ? split
      : (interpretDevopsIntent(e.args) ?? split)
    const { word, rest } = mapped
    // Aliases such as "push" map onto person-only gates.
    if (isPersonOnly(word, rest) && !isHuman(e)) return { text: personOnlyText(word) }

    if (word === '' || word === 'status') {
      if (!active) {
        return {
          text: 'skill: OFF\nGates, publish checks, lint-on-commit, the monitor and the '
            + 'session card are inactive. Type /devops on (or enable) to restore.',
        }
      }
      const gates = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'gates' } as const)).value ?? true
      const authorized = (await $.state.get(PUSH_KEY)).value ?? false
      const tree = await headTree($)
      const security = await latestSecurityVerdict($)
      const branches = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
      const languages = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'languages' } as const)).value ?? []
      const qa = await latestQaVerdict($)
      return {
        text: [
          `skill: on`,
          `languages: ${languages.length === 0 ? '(none detected)' : languages.join(', ')}`,
          `branch gate: ${gates ? 'on' : 'OFF'}; push check: push-ok (human final)`,
          `check monitor: ${((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'monitor' } as const)).value ?? true) ? 'on' : 'OFF'}; failing checks now: ${Object.entries((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'checkFailures' } as const)).value ?? {}).map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}`,
          `latest QA note: ${qa.verdict ?? 'none'}${qa.file ? ` (${qa.file.split('/').pop()})` : ''}`,
          `latest security note: ${security.verdict ?? 'none'}`,
          `push authorized (push-ok or chat "push", this tree): ${grantText(authorized, tree)}`,
          `branches allowed: ${branches.length === 0 ? 'none' : branches.join(', ')}`,
        ].join('\n'),
      }
    }

    if (!active) {
      return {
        text: 'DevOps skill is off. Type /devops on (or enable) to restore it '
          + '(status, skills, and skill on|off still work while off).',
      }
    }

    if (isPersonOnly(word, rest) && !isHuman(e)) return { text: personOnlyText(word) }

    const skill = resolveSkill(split.word, split.rest, e.args)
    if (skill !== undefined) return { text: await runSkillMode($, skill) }
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
    if (word === 'push-ok' || word === 'merge-ok' || word === 'done') {
      // The grant names the tree it was given for: a later commit voids it.
      const { ids, words } = reportIds(rest)
      const parsed = riskOverride(words)
      if (parsed.error !== undefined) return { text: parsed.error }
      return { text: await grantPush($, ids, parsed.risk, parsed.goals) }
    }
    if (word === 'merge-deny') {
      const { ids, words } = reportIds(rest)
      const reason = words.join(' ')
      if (reason === '') {
        return { text: 'Usage: /devops merge-deny [REPORT...] REASON (the BA follows up).' }
      }
      await $.state.set(PUSH_KEY, false)
      await $.state.set(PUSH_REPORTS, [])
      const ran = await runPluginScript($, CHAIN_SCRIPT, ['deny', ...ids, '--reason', reason])
      return {
        text: 'Merge denied; push permission withdrawn. The merge report goes back to the '
          + 'Business Analyst with your reason.' + (ran.out === undefined ? '' : `\n${ran.out}`),
      }
    }
    if (word === 'bug') return { text: await bugAnswer($, rest) }
    if (word === 'answer' || word === 'vision') return { text: await visionWords($, word, rest) }
    if (word === 'satisfied' || word === 'continue') {
      return { text: await loopDecision($, word, rest) }
    }
    if (word === 'load') return { text: await loadAnswer($, rest) }
    if (word === 'push-reset') {
      await $.state.set(PUSH_KEY, false)
      await $.state.set(PUSH_REPORTS, [])
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
      return { text: `Branch gate ${rest}. The push check stays on while the skill is on.` }
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
        'Free-form wording never changes a gate: map it to a skill mode and keep working.',
        helpCatalog('all'),
      ].join('\n'),
    }
  })

  on('tool.call', { tool: GITHUB_TOOL }, async ($, e, next) => {
    if (!(await skillActive($))) return next(e)
    const tool = e.tool.split('__').pop() ?? e.tool
    if (GITHUB_READ.test(tool)) return next(e)
    const input = e as { owner?: unknown; repo?: unknown }
    const denied = await githubTargetDenial($, tool, input.owner, input.repo)
      ?? await publishDenial($, `GitHub ${tool}`)
    if (denied !== undefined) return { deny: denied }
    const ran = await next(e)
    if (ran.deny === undefined) await consumeGrant($)
    return ran
  })

  for (const tool of GITHUB_WRITES) {
    on('tool.call', { tool: `mcp__github__${tool}` }, async ($, e, next) => {
      if (!(await skillActive($))) return next(e)
      const denied = await publishDenial($, `GitHub ${tool}`)
      if (denied !== undefined) return { deny: denied }
      const ran = await next(e)
      if (ran.deny === undefined) await consumeGrant($)
      return ran
    })
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await skillActive($))) return next(e)
    const gatesOn = ((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'gates' } as const)).value ?? true) !== false
    const actions = classify(e.command)
    let consumeAuthorization = false

    for (const action of gatesOn ? actions : []) {
      if (action.kind === 'branch') {
        const allowed = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
        if (action.name !== undefined && allowed.includes(action.name)) continue
        return {
          deny: `${PLUGIN}: ${action.what}${action.name ? ` ${action.name}` : ''} is refused. Stay on the current branch and use a detached worktree (git worktree add --detach) for side work; the person can allow a branch with /devops allow-branch NAME.`,
        }
      }
    }
    const aliases = await pushAliasesIn($, e.command)
    if (aliases.length > 0) {
      const names = aliases.join(', ')
      return { deny: `${PLUGIN}: git alias ${names} is refused: it pushes or runs a shell.` }
    }
    const publish = actions.filter(action => action.kind === 'publish')
    if (publish.length > 0) {
      // The specific reason goes first: a read-only command with a `$`
      // expansion is refused for that expansion, not told to "run the push"
      // it never had.
      const scoped = publish.find(a => a.kind === 'publish' && a.problem !== undefined)
      if (scoped?.kind === 'publish') {
        return { deny: `${PLUGIN}: ${scoped.what} is refused: ${scoped.problem}.` }
      }
      if (!isSingleCommand(e.command)) {
        return {
          deny: `${PLUGIN}: run the push as a command of its own. A step before it in the same `
            + 'command could move HEAD to a tree that QA and Security never checked.',
        }
      }
      const first = publish[0].kind === 'publish' ? publish[0] : undefined
      const what = first?.what ?? 'push'
      const target = first?.repo
      const denied = await pushSetupDenial($, what)
        ?? (target === undefined ? undefined : await repoDenial($, what, target))
        ?? await publishDenial($, what)
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
    if (consumeAuthorization && ran.deny === undefined) await consumeGrant($)
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
    if (!(await skillActive($))) return composed
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
