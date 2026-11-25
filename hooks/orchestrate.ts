import type { EngineInterface } from 'claude-code'

import { type Doc, findSection, indexOf, roleBrief } from './brief'

export const BRIEF_TOOL = 'devops_brief'
const TIMEOUT = 20000

/** Where the skill's Markdown lives in the plugin, and the short name each file is shown under. */
const DOC_DIRS: [string, string][] = [
  ['skills/devops-multi-agent-team', ''],
  ['skills/devops-multi-agent-team/references', 'references/'],
  ['skills/devops-cleanup', 'cleanup/'],
  ['skills/devops-cleanup/references', 'cleanup/references/'],
  ['agents', 'agents/'],
  ['rules', 'rules/'],
]

export const BRIEF_SPEC = {
  name: BRIEF_TOOL,
  description: [
    'Read the devops-multi-agent-team skill in pieces instead of whole files (the skill is about',
    '230 KB). No input: an index of every file and its sections. topic: the one section that',
    'matches, e.g. "lint gate", "comment gate", "push json lint", "magic numbers", "virtual pr".',
    'role: one seat\'s brief, e.g. reviewer, coder, researcher, cleaner, quality-engineer.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Words naming the section you need.' },
      part: { type: 'number', description: 'Which part of a long section (1 for the first).' },
      role: { type: 'string', description: 'A seat: reviewer, coder, researcher, cleaner, ...' },
    },
    additionalProperties: false,
  },
  isDeferred: false,
} as const

let docsCache: Doc[] | undefined

async function readDir($: EngineInterface, dir: string, shown: string): Promise<Doc[]> {
  const entries = await $.fs.list(`${$.plugin.root}/${dir}`).catch(() => [])
  const names = entries.filter(e => e.kind === 'file' && e.name.endsWith('.md'))
    .map(e => e.name).sort()
  const docs: Doc[] = []
  for (const name of names) {
    const text = await $.fs.read(`${$.plugin.root}/${dir}/${name}`).catch(() => '')
    if (typeof text === 'string' && text !== '') docs.push({ file: `${shown}${name}`, text })
  }
  return docs
}

/** The skill's Markdown, read once per load of the mod. */
async function skillDocs($: EngineInterface): Promise<Doc[]> {
  if (docsCache) return docsCache
  const all: Doc[] = []
  for (const [dir, shown] of DOC_DIRS) all.push(...await readDir($, dir, shown))
  docsCache = all
  return all
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The answer to devops_brief: a role's brief, one section, or the index. */
export async function briefFor(
  $: EngineInterface,
  input: { topic?: unknown; role?: unknown; part?: unknown },
): Promise<string> {
  const docs = await skillDocs($)
  if (text(input.role) !== '') return roleBrief(docs, text(input.role))
  const part = typeof input.part === 'number' ? input.part : 1
  if (text(input.topic) !== '') return findSection(docs, text(input.topic), part)
  return indexOf(docs)
}

type Standards = {
  lineLength: { comment: number; code: number }
  function: { maxLines: number; maxNesting: number; maxParams: number }
  magicLiterals: { allowed: number[] }
}

/** One line of the limits in effect, so no config_get call is needed to know them. */
export function standardsSummary(value: Standards): string {
  const { lineLength, function: fn, magicLiterals } = value
  return [
    `code ≤ ${lineLength.code} columns, comments ≤ ${lineLength.comment}`,
    `functions ≤ ${fn.maxLines} lines, nesting ≤ ${fn.maxNesting}, parameters ≤ ${fn.maxParams}`,
    `numbers allowed in code: ${magicLiterals.allowed.join(', ')}`,
  ].join('; ')
}

/** The project's standards, summed up, or undefined when the project has none or they do not load. */
export async function readStandards($: EngineInterface, root: string): Promise<string | undefined> {
  if (!(await $.fs.exists(`${root}/.devops`).catch(() => false))) return undefined
  const script = `${$.plugin.root}/scripts/devops-config.mjs`
  const ran = await $.process
    .run(['node', script, 'get', 'defaults', '--dest', root, '--json'], { timeoutMs: TIMEOUT })
    .catch(() => undefined)
  if (ran === undefined || ran.stdout === '') return undefined
  try {
    return standardsSummary((JSON.parse(ran.stdout) as { value: Standards }).value)
  } catch {
    return undefined
  }
}

export type CardState = {
  languages: string[]
  hasProfile: boolean
  gates: boolean
  lintMode: string
  standards?: string
}

/** The short session section that replaces reading the skill to learn how to work here. */
export function card(state: CardState): string {
  const languages = state.languages.length > 0 ? ` Languages: ${state.languages.join(', ')}.` : ''
  const profile = state.hasProfile
    ? 'Project profile: .devops/project.md; read only the section your step needs.'
    : 'This project is not set up yet; the person can run /devops setup claude.'
  const gate = state.gates
    ? 'Push gate on: QA PASS + Security CLEAR + typed /devops push-ok (one-shot). Agents never'
      + ' run gate words. Prefer skill modes with --mode; do not stop development. Human orders'
      + ' beat skill contingencies. /devops off turns the skill off. New branch:'
      + ' /devops allow-branch NAME.'
    : 'Branch gate is off. Human development orders beat skill contingencies.'
  return [
    `The devops-multi-agent-team skill is active.${languages}`,
    `Read it in pieces: call ${BRIEF_TOOL} (no input: the index; topic: one section; role: your`
      + ' seat\'s brief). Do not read SKILL.md or its references whole.',
    profile,
    'Before handoff: lint_check (any finding is a hard DENY) and every lint_commands linter in the'
      + ' sandbox; read or change settings with config_get / config_set.',
    ...(state.standards ? [`Standards in effect: ${state.standards}.`] : []),
    `${gate} Lint on git commit: ${state.lintMode}.`,
  ].join('\n')
}

type SetupReport = {
  installed: {
    created: string[]
    languages: string[]
    warnings: string[]
    commands: string[]
    dryRun: boolean
    shareConfig: boolean
  }
}

function describeSetup(report: SetupReport): string {
  const { created, languages, warnings, commands, dryRun, shareConfig } = report.installed
  const kept = shareConfig
    ? 'devops-skill/ is in .git/info/exclude; .devops/ is shared, so commit it.'
    : 'Nothing is committed: both are in .git/info/exclude.'
  return [
    `${dryRun ? 'Would create' : 'Created'} ${created.length} files (.devops/ and devops-skill/)`
      + ` for ${languages.join(', ') || 'no detected language'}.`,
    `${kept} The plugin supplies the skill, agents,`,
    'commands and MCP server, so nothing is copied into .claude/ or .cursor/.',
    ...warnings.map(w => `Warning: ${w}`),
    ...commands.map(c => `Run yourself if you agree: ${c}`),
    dryRun
      ? 'Run /devops setup claude without --dry-run to write.'
      : 'Next: fill in the "Fill in by hand" section of .devops/project.md.',
  ].join('\n')
}

/** The plugin-mode install: only the project's own files, through the plugin's setup script. */
export async function setupClaude($: EngineInterface, flags: string[]): Promise<string> {
  const root = await $.session.root()
  const script = `${$.plugin.root}/scripts/devops-setup.mjs`
  const wanted = flags.filter(f => f === '--share-config' || f === '--dry-run')
  const command = ['node', script, 'init', '--plugin', '--dest', root, ...wanted, '--json']
  const ran = await $.process.run(command, { timeoutMs: TIMEOUT }).catch(() => undefined)
  if (ran === undefined) return 'The setup script could not run.'
  try {
    return describeSetup(JSON.parse(ran.stdout) as SetupReport)
  } catch {
    return `${ran.stdout}${ran.stderr}`.trim() || 'The setup script printed nothing.'
  }
}
