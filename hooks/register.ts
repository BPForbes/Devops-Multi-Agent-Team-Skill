import type { EngineInterface, Register } from 'claude-code'

import type { Found } from '../types'
import { branchNameOf, classify, classifySegments, commitInfo, splitArgs, verdictOf } from './guard'

const PLUGIN = 'devops-multi-agent-team'
const THOUGHT_DIRS = ['devops-skill/thoughts/non-final', 'devops-skill/thoughts/final']


const HELP = [
  '/devops              status: languages, gates, QA verdict',
  '/devops languages    what was detected and in which layer',
  '/devops setup        how to install the skill and profile in this project',
  '/devops push-ok      (you) allow ONE push once QA has recorded PASS',
  '/devops push-reset   (you) withdraw that permission',
  '/devops allow-branch NAME   (you) allow creating that git branch',
  '/devops gates on|off (you) turn the push and branch gates on or off',
  '/devops monitor on|off (you) turn the failed-check monitor on or off',
  '/devops comments warn|strict|off (you) comment audit on git commit: warn (default), refuse a commit with blocking findings, or off',
].join('\n')

async function detect($: EngineInterface): Promise<Found[]> {
  const root = await $.session.root()
  const ran = await $.process
    .run(['node', `${$.plugin.root}/scripts/devops-setup.mjs`, 'detect', '--json', '--dest', root], { timeoutMs: 20000 })
    .catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) return []
  try {
    return JSON.parse(ran.stdout) as Found[]
  } catch {
    return []
  }
}

async function latestQaVerdict($: EngineInterface): Promise<{ verdict: 'PASS' | 'BLOCKED' | undefined; file?: string }> {
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
  return { verdict: verdictOf(text), file: newest.path }
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
  const ran = await $.process
    .run(['node', `${$.plugin.root}/scripts/devops-comments.mjs`, 'audit', '--dest', root, ...(stagesAll ? [] : ['--staged']), '--json'], { timeoutMs: 20000 })
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
  return `${PLUGIN} comment audit: ${audit.blocking} blocking, ${audit.nonBlocking} non-blocking. Delete the comment, or rename or extract so the code says it; keep one only for a reason the code cannot show, and list it in the Push JSON comments. Questions and notes to a person go to the PR Q&A, never into code. ${first}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devops',
      description: 'DevOps multi-agent team: languages, gates, QA verdict',
      argumentHint: '[languages|setup|push-ok|push-reset|allow-branch NAME|gates on|off|monitor on|off|comments warn|strict|off]',
    })
    const found = await detect($)
    await $.state.set({ plugin: 'devops-multi-agent-team', key: 'languages' } as const, found.map(f => f.id))
    $.ui.status(found.length === 0 ? undefined : `devops: ${found.slice(0, 4).map(f => f.id).join('+')}`)

    return next(e)
  })

  on('command.run', { command: 'devops' }, async ($, e) => {
    const { word, rest } = splitArgs(e.args)
    const isPerson = e.origin.kind === 'composer'
    const personOnly = (): { text: string } | undefined =>
      isPerson ? undefined : { text: `/devops ${word} changes a gate, so only you can run it by typing it; an agent cannot.` }

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
          `push authorized by you: ${authorized ? 'yes (one push)' : 'no'}`,
          `branches you allowed: ${branches.length === 0 ? 'none' : branches.join(', ')}`,
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
    if (word === 'setup') {
      return {
        text: [
          'Easiest: ask me "set up the DevOps team in this project" (MCP server devops-multi-agent-team; I plan first and write only after you agree).',
          'Or from a shell:',
          `  node ${$.plugin.root}/scripts/devops-setup.mjs install --dest . --target claude`,
          'Add --target cursor or both for Cursor; --dry-run to preview; --lang rust,typescript to choose.',
          'Then fill in the "Fill in by hand" section of .devops/project.md and commit it.',
        ].join('\n'),
      }
    }
    if (word === 'push-ok') {
      const refused = personOnly()
      if (refused) return refused
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, true)
      return { text: 'One push is allowed once the latest QA note says "Publish gate: PASS". It is consumed by that push.' }
    }
    if (word === 'push-reset') {
      const refused = personOnly()
      if (refused) return refused
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, false)
      return { text: 'Push permission withdrawn.' }
    }
    if (word === 'allow-branch') {
      const refused = personOnly()
      if (refused) return refused
      const name = branchNameOf(rest)
      if (name === undefined) return { text: 'Usage: /devops allow-branch NAME (letters, digits, . _ / -).' }
      const current = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const, [...new Set([...current, name])])
      return { text: `Creating the git branch "${name}" is allowed.` }
    }
    if (word === 'comments') {
      const refused = personOnly()
      if (refused) return refused
      if (rest !== 'warn' && rest !== 'strict' && rest !== 'off') return { text: 'Usage: /devops comments warn|strict|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'commentAudit' } as const, rest)
      return { text: `Comment audit on commit: ${rest}.` }
    }
    if (word === 'monitor') {
      const refused = personOnly()
      if (refused) return refused
      if (rest !== 'on' && rest !== 'off') return { text: 'Usage: /devops monitor on|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'monitor' } as const, rest === 'on')
      return { text: `Check monitor ${rest}.` }
    }
    if (word === 'gates') {
      const refused = personOnly()
      if (refused) return refused
      if (rest !== 'on' && rest !== 'off') return { text: 'Usage: /devops gates on|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'gates' } as const, rest === 'on')
      return { text: `Gates ${rest}.` }
    }
    return { text: HELP }
  })

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
      const authorized = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const)).value ?? false
      const qa = await latestQaVerdict($)
      if (qa.verdict !== 'PASS') {
        return { deny: `${PLUGIN}: ${actions.find(a => a.kind === 'publish')?.what} is refused. Only QA may give the OK to push: no qa-*.md note under devops-skill/thoughts says "Publish gate: PASS" (latest: ${qa.verdict ?? 'none'}).` }
      }
      if (!authorized) {
        return { deny: `${PLUGIN}: QA recorded PASS, but the person has not authorized a push. Ask them to type /devops push-ok.` }
      }
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

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const languages = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'languages' } as const)).value ?? []
    const hasProfile = await $.fs.exists(`${await $.session.root()}/.devops/project.md`).catch(() => false)
    if (languages.length === 0 && !hasProfile) return composed

    const text = [
      'The devops-multi-agent-team skill is available in this project.',
      languages.length > 0 ? `Detected languages: ${languages.join(', ')}.` : undefined,
      hasProfile
        ? 'Read .devops/project.md before planning: it lists the validation and security commands per language.'
        : 'No .devops/project.md yet: /devops setup shows how to create it.',
      'Only QA may give the OK to push; git push, gh pr create|merge and creating a git branch are refused until QA records "Publish gate: PASS" and the person runs /devops push-ok.',
    ].filter(Boolean).join(' ')

    return { sections: [...composed.sections, { id: `${PLUGIN}:context`, text, scope: 'session' as const }] }
  })
}
