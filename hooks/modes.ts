import { shellWords } from './guard'

/** A /devops skill mode: structured orchestration, not a plain-text dump. */
export type SkillMode = {
  word: string
  mode: string
  rest: string
}

type ModeSpec = {
  word: string
  aliases: string[]
  modes: string[]
  defaultMode: string
  skill: string
  tools: string[]
  behavior: string[]
  command?: string
}

const SPECS: ModeSpec[] = [
  {
    word: 'question',
    aliases: ['ask', 'q'],
    modes: ['overview', 'tree', 'symbol', 'search', 'file', 'module', 'library'],
    defaultMode: 'search',
    skill: 'project-mindmap (plain chat; no team)',
    tools: ['mindmap_overview', 'mindmap_query', 'mindmap_tree'],
    behavior: [
      'Answer from the mind map; do not spawn seats.',
      'Call the MCP tools (or scripts/devops-mindmap.mjs); do not dump the tree as prose.',
      'Open files only at the line ranges the map returns.',
    ],
  },
  {
    word: 'mind-map',
    aliases: ['mindmap', 'map'],
    modes: ['overview', 'build', 'status', 'tree', 'query', 'note'],
    defaultMode: 'overview',
    skill: 'project-mindmap; Researcher owns the map in a team run',
    tools: [
      'mindmap_overview', 'mindmap_build', 'mindmap_status',
      'mindmap_tree', 'mindmap_query', 'mindmap_note',
    ],
    behavior: [
      'Use mindmap_* tools (or scripts/devops-mindmap.mjs) for every lookup.',
      'build saves only .devops/mindmap/; note plans first, apply after yes.',
      'In a /goal run, hand map facts to the Researcher brief; other seats read ranges only.',
    ],
  },
  {
    word: 'clean',
    aliases: ['cleanup', 'tidy'],
    modes: ['brief', 'scan', 'plan', 'run'],
    defaultMode: 'brief',
    skill: 'devops-cleanup (+ /cleanup)',
    tools: ['cleanup_brief', 'cleanup_scan', 'reuse_search'],
    behavior: [
      'Turn the statement into cleanup_brief; ask about unrecognized parts.',
      'Baseline validation green, then cleanup_scan (save); plan before edits.',
      'run: spawn cleaner seats one step at a time; Reviewers check structure only.',
      'Nobody pushes before QA PASS and the human go.',
    ],
    command: 'commands/cleanup.md',
  },
  {
    word: 'goal',
    aliases: [],
    modes: ['loop', 'status'],
    defaultMode: 'loop',
    skill: 'devops-multi-agent-team (+ /goal)',
    tools: ['detect_project', 'status', 'mindmap_overview', 'reuse_search'],
    behavior: [
      'Write goal-agent-<hex>.md; loop the DevOps cycle until X is met.',
      'Spawn seats asynchronously with team/agent/job hashes; do not stop at a plan.',
      'Default publish: QA PASS then human push; human push-ok is final.',
    ],
    command: 'commands/goal.md',
  },
  {
    word: 'story',
    aliases: [],
    modes: ['research', 'create', 'check', 'graph'],
    defaultMode: 'research',
    skill: 'devops-multi-agent-team stories',
    tools: [
      'story_graph', 'story_new', 'story_link', 'story_check',
      'story_parse', 'story_guidance', 'module_map',
    ],
    behavior: [
      'Research organizes first; Coders write OLD then NEW; Reviewers then QA/Security.',
      'Use story_* MCP tools; do not invent catalog rows in free prose.',
    ],
    command: 'commands/story.md',
  },
  {
    word: 'repro',
    aliases: ['reproduce'],
    modes: ['run'],
    defaultMode: 'run',
    skill: 'devops-multi-agent-team (+ /repro)',
    tools: ['sandbox_plan', 'check_toolchain'],
    behavior: [
      'Recreate with exact commands and exit codes; write repro-<topic>.md.',
      'Prefer a throwaway clone; never claim a cause before the repro ran.',
    ],
    command: 'commands/repro.md',
  },
  {
    word: 'triage',
    aliases: [],
    modes: ['open'],
    defaultMode: 'open',
    skill: 'devops-multi-agent-team (+ /triage)',
    tools: ['comment_audit'],
    behavior: [
      'QA owns triage; copy triage-template.md to triage-<seat-id>.md.',
      'Handoff To: Coder; department Researcher joins the Coder who picks it up.',
    ],
    command: 'commands/triage.md',
  },
  {
    word: 'review',
    aliases: ['code-review'],
    modes: ['inspect'],
    defaultMode: 'inspect',
    skill: 'devops-multi-agent-team (+ /code-review)',
    tools: ['comment_audit', 'mindmap_query'],
    behavior: [
      'QA inspects only; confirm Push JSON; write review-<seat-id>.md.',
      'Do not edit product code; use the virtual PR and side-work rules.',
    ],
    command: 'commands/code-review.md',
  },
  {
    word: 'reuse',
    aliases: [],
    modes: ['search'],
    defaultMode: 'search',
    skill: 'research-and-reuse',
    tools: ['reuse_search', 'module_map', 'mindmap_query'],
    behavior: [
      'Search before writing; if a name exists, extend it and say so.',
      'Prefer reuse_search / mindmap_query over grepping the whole tree into chat.',
    ],
  },
  {
    word: 'tags',
    aliases: ['tag'],
    modes: ['history', 'plan', 'create'],
    defaultMode: 'history',
    skill: 'version-tags',
    tools: ['tag_history', 'tag_plan', 'tag_create'],
    behavior: [
      'Use tag_* tools for version history and bumps; plan before create.',
    ],
  },
]

const BY_ALIAS = new Map<string, ModeSpec>()
for (const spec of SPECS) {
  BY_ALIAS.set(spec.word, spec)
  for (const alias of spec.aliases) BY_ALIAS.set(alias, spec)
}

const MODE_FLAG = /(?:^|\s)--mode\s+(\S+)/i

/** Known gate subcommands (not skill modes). */
export const GATE_WORDS = [
  '', 'status', 'languages', 'setup', 'brief', 'push-ok', 'push-reset',
  'allow-branch', 'comments', 'config', 'monitor', 'gates', 'help',
] as const

export function skillWords(): string[] {
  return SPECS.map(s => s.word)
}

export function isGateWord(word: string): boolean {
  return (GATE_WORDS as readonly string[]).includes(word)
}

export function isSkillWord(word: string): boolean {
  return BY_ALIAS.has(word.toLowerCase())
}

/** Pull --mode NAME from args; returns the remaining text. */
export function takeModeFlag(
  args: string,
  allowed: string[],
  fallback: string,
): { mode: string; rest: string } {
  const match = MODE_FLAG.exec(args)
  if (match === null) return { mode: fallback, rest: args.trim() }
  const wanted = match[1].toLowerCase()
  const mode = allowed.includes(wanted) ? wanted : fallback
  const rest = `${args.slice(0, match.index)} ${args.slice(match.index + match[0].length)}`
    .replace(/\s+/g, ' ')
    .trim()
  return { mode, rest }
}

/** Map a first word (or alias) onto a skill mode with optional --mode. */
export function parseSkillMode(word: string, rest: string): SkillMode | undefined {
  const spec = BY_ALIAS.get(word.toLowerCase())
  if (spec === undefined) return undefined
  const taken = takeModeFlag(rest, spec.modes, spec.defaultMode)
  return { word: spec.word, mode: taken.mode, rest: taken.rest }
}

/** Free-form phrases that mean a skill mode without the canonical word first. */
export function interpretSkillIntent(args: string): SkillMode | undefined {
  const trimmed = args.trim()
  if (trimmed === '') return undefined
  const lower = trimmed.toLowerCase()
  const first = splitFirst(trimmed)
  const direct = parseSkillMode(first.word, first.rest)
  if (direct !== undefined) return direct
  if (/^(how does|where is|what (is|does)|who (calls|uses)|explain)\b/.test(lower)) {
    return parseSkillMode('question', trimmed)
  }
  if (/^(map this|refresh (the )?map|build (the )?mind.?map)\b/.test(lower)) {
    return parseSkillMode('mind-map', `--mode build ${trimmed}`)
  }
  if (/^(clean\s*up|tidy|reduce comments|remove duplicates?|split (big|large) functions)\b/
    .test(lower)) {
    return parseSkillMode('clean', trimmed)
  }
  if (/^(do until|keep going until|set a goal)\b/.test(lower)) {
    return parseSkillMode('goal', trimmed)
  }
  return undefined
}

function splitFirst(args: string): { word: string; rest: string } {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  return space === -1
    ? { word: trimmed, rest: '' }
    : { word: trimmed.slice(0, space), rest: trimmed.slice(space).trim() }
}

/** Structured card the agent follows instead of re-interpreting plain text. */
export function orchestrationCard(skill: SkillMode): string {
  const spec = BY_ALIAS.get(skill.word)
  if (spec === undefined) return `Unknown skill mode: ${skill.word}`
  const input = skill.rest === '' ? '(none — ask if needed)' : skill.rest
  return [
    `## /devops ${spec.word}`,
    `mode: ${skill.mode} (allowed: ${spec.modes.join('|')})`,
    `skill: ${spec.skill}`,
    ...(spec.command !== undefined ? [`command: ${spec.command}`] : []),
    `tools: ${spec.tools.join(', ')}`,
    'behavior:',
    ...spec.behavior.map(line => `- ${line}`),
    `input: ${input}`,
    'Do not stop development. Prefer the tools above over pasting large file bodies.',
  ].join('\n')
}

/** CLI argv for a skill mode that can shell out (mind-map / clean / question). */
export function scriptArgsFor(skill: SkillMode): string[] | undefined {
  if (skill.word === 'mind-map' || skill.word === 'question') return mindmapArgs(skill)
  if (skill.word === 'clean' && (skill.mode === 'brief' || skill.mode === 'scan')) {
    const statement = skill.rest || 'follow clean code principles'
    return [skill.mode, '--statement', statement]
  }
  return undefined
}

function mindmapArgs(skill: SkillMode): string[] | undefined {
  const mode = skill.word === 'question' ? questionAsMindmap(skill.mode) : skill.mode
  if (mode === 'overview') return ['overview']
  if (mode === 'status') return ['status']
  if (mode === 'build') return ['build', '--save']
  if (mode === 'tree') {
    const node = shellWords(skill.rest)[0]
    return node !== undefined ? ['tree', '--node', node] : ['tree']
  }
  if (mode === 'query' || mode === 'search' || mode === 'symbol'
    || mode === 'file' || mode === 'module' || mode === 'library') {
    return queryArgs(mode === 'query' ? 'search' : mode, skill.rest)
  }
  return undefined
}

function questionAsMindmap(mode: string): string {
  if (mode === 'overview') return 'overview'
  if (mode === 'tree') return 'tree'
  return mode === 'search' || mode === 'symbol' || mode === 'file'
    || mode === 'module' || mode === 'library'
    ? mode
    : 'search'
}

function queryArgs(kind: string, rest: string): string[] | undefined {
  const text = rest.trim()
  if (text === '') return undefined
  if (kind === 'symbol') return ['query', '--symbol', text]
  if (kind === 'file') return ['query', '--file', text]
  if (kind === 'module') return ['query', '--module', text]
  if (kind === 'library') return ['query', '--library', text]
  return ['query', '--search', text]
}

export function scriptNameFor(skill: SkillMode): string | undefined {
  if (skill.word === 'mind-map' || skill.word === 'question') return 'devops-mindmap.mjs'
  if (skill.word === 'clean') return 'devops-cleanup.mjs'
  return undefined
}
