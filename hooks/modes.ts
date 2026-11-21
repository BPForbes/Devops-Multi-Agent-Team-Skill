import { shellWords, splitArgs } from './guard'

/** A /devops skill mode with an optional --mode and trailing input. */
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

const STAGE_ROLES: Record<string, string> = {
  research: 'Planner, Researcher, Ticket Lead',
  implement: 'Coder (department Researcher joins)',
  review: '2–3 Reviewers (independent team hashes)',
  security: 'Security Engineer',
  qa: 'QA, CI Engineer, Verifier',
  docs: 'Documentation, Communicator',
  full: 'all pods until Security Clear + QA PASS, then notify human for push',
  loop: 'all pods until Security Clear + QA PASS, then notify human for push',
}

const SPECS: ModeSpec[] = [
  {
    word: 'help',
    aliases: ['?', 'modes'],
    modes: ['all', 'gates', 'skills', 'stage'],
    defaultMode: 'all',
    skill: 'devops command catalog',
    tools: [],
    behavior: [
      'Print the catalog for the chosen slice (all, gates, skills, or stage).',
      'Point the next action at a named mode; keep the development loop running.',
    ],
  },
  {
    word: 'question',
    aliases: ['ask', 'q'],
    modes: ['overview', 'tree', 'symbol', 'search', 'file', 'module', 'library'],
    defaultMode: 'search',
    skill: 'project-mindmap (plain chat; no team)',
    tools: ['mindmap_overview', 'mindmap_query', 'mindmap_tree'],
    behavior: [
      'Answer from the mind map; do not spawn seats.',
      'Call the MCP tools (or scripts/devops-mindmap.mjs); keep the tree out of chat.',
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
    modes: ['loop', 'status', 'allocate'],
    defaultMode: 'loop',
    skill: 'devops-multi-agent-team (+ /goal)',
    tools: ['detect_project', 'status', 'mindmap_overview', 'reuse_search'],
    behavior: [
      'loop: run every stage (research→implement→review→security→qa→docs) until X.',
      'Stop the loop only when Security is Clear and QA records Publish gate: PASS.',
      'Then the Orchestrator notifies the human and waits; do not push until they say push.',
      'allocate: mint team/agent hashes, write per-pod and per-agent goals, set current_job.',
      'On send-back or BLOCKED, re-enter the needed stage and continue the loop.',
    ],
    command: 'commands/goal.md',
  },
  {
    word: 'stage',
    aliases: ['ci', 'pipeline', 'cicd'],
    modes: [
      'research', 'implement', 'review', 'security', 'qa', 'docs', 'full', 'loop',
    ],
    defaultMode: 'full',
    skill: 'devops-multi-agent-team loop stage',
    tools: [
      'mindmap_overview', 'reuse_search', 'module_map', 'detect_project',
      'comment_audit', 'sandbox_plan',
    ],
    behavior: [
      'One mode: spawn only that CI/CD pod. full|loop: run all pods in order.',
      'Allocate goals first; mint team/agent hashes; set initial_job/current_job.',
      'full|loop: research→implement→review→security→qa→docs until Clear + PASS.',
      'When QA PASS and Security Clear: Orchestrator notifies the human for push;',
      'do not push until they say push or /devops push-ok.',
      'Seats use /devops question|mind-map|reuse|review|repro the same way humans do.',
    ],
    command: 'commands/stage.md',
  },
  {
    word: 'allocate',
    aliases: ['assign'],
    modes: ['pod', 'agent', 'job', 'board'],
    defaultMode: 'pod',
    skill: 'orchestrator goal allocation',
    tools: [],
    behavior: [
      'pod: one goal file per team hash (goal-team-<hex>.md) from the parent goal.',
      'agent: one goal-agent-<hex>.md per seat with acceptance criteria for that job.',
      'job: use devops-ids free --initial JOB; set current_job; prefer initial_job match.',
      'board: update seat-registry.md and team-board.md with the allocation rows.',
      'Scripts: node scripts/devops-ids.mjs mint team|agent and free --registry …',
    ],
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
      'Use story_* MCP tools; keep catalog rows out of free prose.',
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
      'Use a throwaway clone when possible; claim a cause only after the repro ran.',
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
      'Leave product code unchanged; use the virtual PR and side-work rules.',
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
      'Call reuse_search / mindmap_query; keep whole-tree greps out of chat.',
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
  'allow-branch', 'comments', 'config', 'monitor', 'gates',
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
  if (/^(run|trigger|start)\s+(research|implement|review|security|qa|docs)\b/.test(lower)) {
    const stage = /research|implement|review|security|qa|docs/.exec(lower)?.[0] ?? 'full'
    return parseSkillMode('stage', `--mode ${stage} ${trimmed}`)
  }
  if (/^(run|start|do)\s+(the\s+)?(full\s+)?(loop|pipeline|ci\/?cd)\b/.test(lower)
    || /^(keep going|loop)\s+until\b/.test(lower)
    || /^full\s+(loop|pipeline)\b/.test(lower)) {
    return parseSkillMode('stage', `--mode loop ${trimmed}`)
  }
  if (/^(allocate|assign)\s+(pods?|agents?|jobs?)\b/.test(lower)) {
    const which = /pods?|agents?|jobs?/.exec(lower)?.[0] ?? 'pod'
    const mode = which.startsWith('agent') ? 'agent' : which.startsWith('job') ? 'job' : 'pod'
    return parseSkillMode('allocate', `--mode ${mode} ${trimmed}`)
  }
  const first = splitArgs(trimmed)
  return parseSkillMode(first.word, first.rest)
}

/** Catalog text for /devops help [--mode all|gates|skills|stage]. */
export function helpCatalog(mode: string): string {
  const gates = [
    'status, languages, setup, setup claude, brief, push-ok, push-reset,',
    'allow-branch NAME, gates on|off, monitor on|off, comments warn|strict|off, config …',
  ].join(' ')
  const skills = SPECS.map(s => {
    const alias = s.aliases.length > 0 ? ` (${s.aliases.join(', ')})` : ''
    return `/devops ${s.word}${alias} --mode ${s.modes.join('|')}  [text]`
  })
  const stages = Object.entries(STAGE_ROLES).map(
    ([name, roles]) => `- ${name}: ${roles}`,
  )
  const parts: string[] = ['## /devops help', `mode: ${mode}`]
  if (mode === 'gates' || mode === 'all') {
    parts.push('### Gates', gates)
  }
  if (mode === 'skills' || mode === 'all') {
    parts.push('### Skill modes (text after the command is the input)', ...skills)
  }
  if (mode === 'stage' || mode === 'all') {
    parts.push(
      '### CI/CD stages (`/devops stage|ci|pipeline --mode … [goal text]`)',
      ...stages,
      'Allocate pod and agent goals before spawning (`/devops allocate` or goal --mode allocate).',
    )
  }
  parts.push('Keep development running. Human wording is final.')
  return parts.join('\n')
}

/** Build the skill-mode card: mode, tools, behavior, and input. */
export function orchestrationCard(skill: SkillMode): string {
  if (skill.word === 'help') return helpCatalog(skill.mode)
  const spec = BY_ALIAS.get(skill.word)
  if (spec === undefined) return `Unknown skill mode: ${skill.word}`
  const input = skill.rest === '' ? '(none — ask if needed)' : skill.rest
  const stageNote = spec.word === 'stage' && STAGE_ROLES[skill.mode] !== undefined
    ? [`seats: ${STAGE_ROLES[skill.mode]}`]
    : []
  return [
    `## /devops ${spec.word}`,
    `mode: ${skill.mode} (allowed: ${spec.modes.join('|')})`,
    `skill: ${spec.skill}`,
    ...(spec.command !== undefined ? [`command: ${spec.command}`] : []),
    ...stageNote,
    `tools: ${spec.tools.join(', ') || '(none — follow behavior)'}`,
    'behavior:',
    ...spec.behavior.map(line => `- ${line}`),
    `input: ${input}`,
    'Keep development running. Call the tools above; keep large file bodies out of chat.',
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
